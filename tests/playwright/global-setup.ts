import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import {
  parseSupabaseStatus,
  assertLocalUrl,
  runtimePaths,
} from './local-backend';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const EXPO_PORT = 8082;
const EXPO_READY_TIMEOUT_MS = 120_000;
const EXPO_POLL_INTERVAL_MS = 1_500;

export default async function globalSetup(): Promise<void> {
  if (process.env.LOCAL_SUPABASE !== '1') {
    return;
  }

  const paths = runtimePaths(PROJECT_ROOT);
  fs.mkdirSync(paths.runtimeDir, { recursive: true });

  // Always run `supabase start` — it's idempotent and quick when
  // containers are already up, AND it brings the running set into
  // alignment with config.toml. Previously we short-circuited via
  // isSupabaseUp() to save a couple of seconds on KEEP_SUPABASE
  // iterations, but supabase CLI v2.95.4's `db reset` then sees
  // out-of-spec services and stops EVERYTHING (Kong, Auth, Realtime
  // included), leaving `supabase status` with only DB_URL set. The
  // few-second savings aren't worth that footgun.
  log(isSupabaseUp() ? 're-aligning local supabase…' : 'starting local supabase…');
  execSync('supabase start', { stdio: 'inherit', cwd: PROJECT_ROOT });

  // Run `supabase db reset` with one retry. v2.95.4 of the CLI
  // occasionally returns "Error status 502: An invalid response
  // was received from the upstream server" during the
  // `Restarting containers...` phase — Kong responds before the
  // restarted Auth container is healthy. A `supabase start`
  // re-align + retry resolves it; if the second attempt fails too,
  // the error is real and propagates.
  log('applying migrations via supabase db reset…');
  try {
    execSync('supabase db reset --local --no-seed --yes', {
      stdio: 'inherit',
      cwd: PROJECT_ROOT,
    });
  } catch (e: unknown) {
    log(`db reset attempt 1 failed: ${(e as Error).message.slice(0, 200)}`);
    log('re-aligning supabase + retrying db reset…');
    execSync('supabase start', { stdio: 'inherit', cwd: PROJECT_ROOT });
    execSync('supabase db reset --local --no-seed --yes', {
      stdio: 'inherit',
      cwd: PROJECT_ROOT,
    });
  }

  // Belt-and-suspenders: in some CLI versions `db reset` itself stops
  // services that were running but flagged disabled in config.toml,
  // OR essential services if it can't reconcile state. A second
  // `supabase start` brings everything back into the expected shape
  // before we read `supabase status`.
  execSync('supabase start', { stdio: 'inherit', cwd: PROJECT_ROOT });

  const statusJson = execSync('supabase status -o json', {
    cwd: PROJECT_ROOT,
  }).toString();
  const status = parseSupabaseStatus(statusJson);
  assertLocalUrl(status.apiUrl);

  const envTest = [
    `EXPO_PUBLIC_SUPABASE_URL=${status.apiUrl}`,
    `EXPO_PUBLIC_SUPABASE_ANON_KEY=${status.anonKey}`,
    `EXPO_PUBLIC_APP_URL=http://localhost:${EXPO_PORT}`,
    '',
  ].join('\n');
  fs.writeFileSync(paths.envTest, envTest, 'utf8');

  // Expo's Metro bundler inlines EXPO_PUBLIC_* vars from .env.local at
  // build time, overriding any process.env values passed via spawn().
  // The dev's checked-out .env.local points at the prod Supabase
  // project, so without this override the test Expo (:8082) would
  // anonymous-sign-in against prod and create real test rooms there
  // (silent for the SP-only e2e tier — multiplayer e2e exposes it
  // immediately). Back up the dev's .env.local and replace it with
  // the local-Supabase values for the duration of the run. Teardown
  // restores it.
  if (fs.existsSync(paths.envLocal)) {
    log('backing up .env.local → tests/.runtime/.env.local.bak');
    fs.copyFileSync(paths.envLocal, paths.envLocalBackup);
  } else if (fs.existsSync(paths.envLocalBackup)) {
    // A previous run was interrupted before teardown restored the
    // backup. The backup is the source of truth — don't trample it.
    log('stale .env.local.bak found (prior run interrupted) — keeping it');
  }
  fs.writeFileSync(paths.envLocal, envTest, 'utf8');

  log(`spawning expo on :${EXPO_PORT}…`);
  const logFd = fs.openSync(paths.expoLog, 'w');
  const child = spawn('npx', ['expo', 'start', '--port', String(EXPO_PORT)], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      EXPO_PUBLIC_SUPABASE_URL: status.apiUrl,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: status.anonKey,
      EXPO_PUBLIC_APP_URL: `http://localhost:${EXPO_PORT}`,
      CI: '1',
    },
  });
  if (typeof child.pid !== 'number') {
    throw new Error('expo failed to spawn (no pid)');
  }
  fs.writeFileSync(paths.expoPid, String(child.pid), 'utf8');
  child.unref();

  log('waiting for expo to be ready…');
  await waitForHttp(`http://localhost:${EXPO_PORT}`, EXPO_READY_TIMEOUT_MS);
  log('expo ready.');
}

function isSupabaseUp(): boolean {
  try {
    execSync('supabase status', {
      cwd: PROJECT_ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      const req = http.get(url, (res) => {
        res.resume();
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 400) {
          resolve();
        } else if (Date.now() > deadline) {
          reject(new Error(`expo readiness timeout at ${url} (last status ${status})`));
        } else {
          setTimeout(tick, EXPO_POLL_INTERVAL_MS);
        }
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`expo readiness timeout at ${url} (no response)`));
        } else {
          setTimeout(tick, EXPO_POLL_INTERVAL_MS);
        }
      });
      req.setTimeout(EXPO_POLL_INTERVAL_MS, () => req.destroy());
    };
    tick();
  });
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[global-setup] ${msg}`);
}

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { runtimePaths } from './local-backend';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

export default async function globalTeardown(): Promise<void> {
  if (process.env.LOCAL_SUPABASE !== '1') {
    return;
  }

  const paths = runtimePaths(PROJECT_ROOT);

  if (fs.existsSync(paths.expoPid)) {
    const pid = parseInt(fs.readFileSync(paths.expoPid, 'utf8').trim(), 10);
    if (Number.isFinite(pid) && pid > 0) {
      log(`stopping expo (pid ${pid})…`);
      try {
        process.kill(pid, 'SIGTERM');
      } catch (e: unknown) {
        log(`SIGTERM failed (already gone?): ${(e as Error).message}`);
      }
      await sleep(5000);
      try {
        process.kill(pid, 0);
        log('expo still alive, sending SIGKILL');
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* race */
        }
      } catch {
        /* dead already */
      }
    }
    try {
      fs.unlinkSync(paths.expoPid);
    } catch {
      /* fine */
    }
  } else {
    log('no expo pid file — skipping expo kill');
  }

  if (process.env.KEEP_SUPABASE === '1') {
    log('KEEP_SUPABASE=1 — leaving local supabase running');
  } else {
    log('stopping local supabase…');
    try {
      execSync('supabase stop --no-backup', {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
      });
    } catch (e: unknown) {
      log(`supabase stop failed: ${(e as Error).message}`);
    }
  }

  try {
    fs.unlinkSync(paths.envTest);
  } catch {
    /* fine */
  }

  // Restore the dev's real .env.local (we overwrote it with local
  // Supabase values during globalSetup). If the backup is missing,
  // .env.local was absent before the run started — delete the
  // test-version we wrote so the working tree is clean.
  try {
    if (fs.existsSync(paths.envLocalBackup)) {
      log('restoring .env.local from backup');
      fs.copyFileSync(paths.envLocalBackup, paths.envLocal);
      fs.unlinkSync(paths.envLocalBackup);
    } else if (fs.existsSync(paths.envLocal)) {
      // No backup → .env.local didn't exist before; remove our
      // synthetic one to leave the tree as we found it.
      fs.unlinkSync(paths.envLocal);
    }
  } catch (e: unknown) {
    log(`.env.local restore failed (manual cleanup required): ${(e as Error).message}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[global-teardown] ${msg}`);
}

import * as path from 'path';

export interface SupabaseStatus {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  dbUrl: string;
}

/**
 * Parse the JSON emitted by `supabase status -o json`. Throws a clear
 * error when a required field is missing so a future CLI version that
 * renames a key fails loudly instead of silently writing an empty
 * .env.test.
 */
export function parseSupabaseStatus(raw: string): SupabaseStatus {
  const j = JSON.parse(raw) as Record<string, unknown>;
  const need = (k: string): string => {
    const v = j[k];
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(
        `supabase status JSON missing required field "${k}". ` +
          `Got: ${JSON.stringify(j)}`,
      );
    }
    return v;
  };
  return {
    apiUrl: need('API_URL'),
    anonKey: need('ANON_KEY'),
    serviceRoleKey: need('SERVICE_ROLE_KEY'),
    dbUrl: need('DB_URL'),
  };
}

/**
 * Guard against accidentally pointing tests at a remote supabase
 * project. Any deviation from 127.0.0.1 / localhost aborts the run
 * before any seed inserts or migration resets touch real data.
 */
export function assertLocalUrl(url: string): void {
  const isLocal =
    url.startsWith('http://127.0.0.1') ||
    url.startsWith('http://localhost') ||
    url.startsWith('https://127.0.0.1') ||
    url.startsWith('https://localhost');
  if (!isLocal) {
    throw new Error(
      `refusing to run: supabase URL "${url}" is not local. ` +
        `Tests must only touch 127.0.0.1 / localhost backends.`,
    );
  }
}

export interface RuntimePaths {
  envTest: string;
  runtimeDir: string;
  expoPid: string;
  expoLog: string;
}

/**
 * Centralizes path resolution so setup, teardown, and tests all
 * agree on where the runtime scratch files live.
 */
export function runtimePaths(projectRoot: string): RuntimePaths {
  const runtimeDir = path.join(projectRoot, 'tests', '.runtime');
  return {
    envTest: path.join(projectRoot, '.env.test'),
    runtimeDir,
    expoPid: path.join(runtimeDir, 'expo.pid'),
    expoLog: path.join(runtimeDir, 'expo.log'),
  };
}

import {
  parseSupabaseStatus,
  assertLocalUrl,
  runtimePaths,
} from '../local-backend';

describe('parseSupabaseStatus', () => {
  const sample = JSON.stringify({
    API_URL: 'http://127.0.0.1:54321',
    DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    GRAPHQL_URL: 'http://127.0.0.1:54321/graphql/v1',
    ANON_KEY: 'eyJhbGc.test.anon',
    SERVICE_ROLE_KEY: 'eyJhbGc.test.service',
    JWT_SECRET: 'super-secret-jwt-token-with-at-least-32-characters-long',
  });

  it('extracts the four fields we care about', () => {
    const out = parseSupabaseStatus(sample);
    expect(out.apiUrl).toBe('http://127.0.0.1:54321');
    expect(out.anonKey).toBe('eyJhbGc.test.anon');
    expect(out.serviceRoleKey).toBe('eyJhbGc.test.service');
    expect(out.dbUrl).toBe(
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    );
  });

  it('throws a helpful error when a required field is missing', () => {
    const bad = JSON.stringify({ API_URL: 'http://127.0.0.1:54321' });
    expect(() => parseSupabaseStatus(bad)).toThrow(/ANON_KEY/);
  });

  it('throws if the input is not valid JSON', () => {
    expect(() => parseSupabaseStatus('not json')).toThrow();
  });
});

describe('assertLocalUrl', () => {
  it('accepts 127.0.0.1', () => {
    expect(() => assertLocalUrl('http://127.0.0.1:54321')).not.toThrow();
  });

  it('accepts localhost', () => {
    expect(() => assertLocalUrl('http://localhost:54321')).not.toThrow();
  });

  it('rejects a remote supabase host', () => {
    expect(() =>
      assertLocalUrl('https://evcaqgmkdlqesqisjfyh.supabase.co'),
    ).toThrow(/refusing to run/i);
  });

  it('rejects an empty string', () => {
    expect(() => assertLocalUrl('')).toThrow();
  });
});

describe('runtimePaths', () => {
  it('produces absolute paths under the project root', () => {
    const p = runtimePaths('/repo');
    expect(p.envTest).toBe('/repo/.env.test');
    expect(p.runtimeDir).toBe('/repo/tests/.runtime');
    expect(p.expoPid).toBe('/repo/tests/.runtime/expo.pid');
    expect(p.expoLog).toBe('/repo/tests/.runtime/expo.log');
  });
});

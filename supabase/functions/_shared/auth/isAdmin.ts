/**
 * Admin allow-list check. `ADMIN_EMAILS` is read by callers from Deno.env;
 * we keep this function pure for unit-testability.
 */
export function isAdminEmail(
  email: string | null | undefined,
  adminEmailsCsv: string | null | undefined,
): boolean {
  if (!email || !adminEmailsCsv) return false;
  const normalized = email.trim().toLowerCase();
  return adminEmailsCsv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
    .includes(normalized);
}

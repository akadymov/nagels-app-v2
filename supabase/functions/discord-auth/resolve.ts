// Pure resolution: maps (discord profile + lookup results) → an action the
// edge entrypoint executes against the Supabase admin API. No I/O here.

export interface ResolveProfile {
  discord_id: string;
  email: string | null;
  verified: boolean;
  display_name: string;
  avatar_url: string | null;
}

export interface Lookups {
  userByEmail: { id: string } | null;
  userByDiscord: { id: string } | null;
}

export type Resolution =
  | { kind: 'link'; userId: string }     // existing email-user: attach discord_id
  | { kind: 'reuse'; userId: string }    // existing discord-user: just sign in
  | { kind: 'create'; email: string | null };

export function decideResolution(p: ResolveProfile, l: Lookups): Resolution {
  const usableEmail = p.email && p.verified ? p.email : null;
  if (usableEmail && l.userByEmail) return { kind: 'link', userId: l.userByEmail.id };
  if (usableEmail) return { kind: 'create', email: usableEmail };
  if (l.userByDiscord) return { kind: 'reuse', userId: l.userByDiscord.id };
  return { kind: 'create', email: null };
}

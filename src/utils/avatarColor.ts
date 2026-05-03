/**
 * Pseudo-random but deterministic avatar background color picker.
 *
 * Used as the *fallback* when a player hasn't picked an explicit
 * avatar_color in Settings. The hash maps each session_id to one
 * stable slot in AVATAR_COLORS — looks "random" across players,
 * doesn't flicker between renders, and stays consistent on every
 * surface (lobby, waiting room, table, scoreboard).
 *
 * Matches the AVATAR_COLORS palette used by the Settings/Profile
 * pickers so manual and default avatars draw from the same set.
 */
const AVATAR_COLORS = [
  '#3380CC', '#CC4D80', '#66B366', '#9966CC',
  '#CC9933', '#33AAAA', '#CC6633', '#6666CC',
];

export function avatarColorFor(id: string | null | undefined): string {
  if (!id) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export { AVATAR_COLORS };

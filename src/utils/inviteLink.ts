/**
 * Build an invite link for a room.
 * Always produces a web URL using the current origin (works with Expo tunnel domains).
 */
export function buildInviteLink(roomCode: string): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/join/${roomCode}`;
  }
  // Fallback for SSR / non-web contexts
  return `/join/${roomCode}`;
}

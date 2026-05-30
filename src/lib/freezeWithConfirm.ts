import type { TFunction } from 'i18next';
import { gameClient } from './gameClient';

/**
 * Confirm (anti-misclick + explain) then freeze the game. Mirrors
 * leaveWithConfirm. On web/PWA shows window.confirm; if declined, no-op.
 * Returns true iff the pause request succeeded.
 */
export async function freezeWithConfirm(roomId: string, t: TFunction): Promise<boolean> {
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const accepted = window.confirm(`${t('freeze.confirmTitle')}\n\n${t('freeze.confirmBody')}`);
    if (!accepted) return false;
  }
  const result = await gameClient.pauseGame(roomId);
  return result.ok === true;
}

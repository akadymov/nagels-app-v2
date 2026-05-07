import type { TFunction } from 'i18next';
import { gameClient } from './gameClient';

export async function leaveWithConfirm(
  roomId: string,
  t: TFunction,
): Promise<boolean> {
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const title = t('multiplayer.leaveConfirmTitle');
    const body = t('multiplayer.leaveConfirmBody');
    const accepted = window.confirm(`${title}\n\n${body}`);
    if (!accepted) return false;
  }
  const result = await gameClient.leaveRoom(roomId);
  return result.ok === true;
}

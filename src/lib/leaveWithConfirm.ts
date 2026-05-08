import type { TFunction } from 'i18next';
import { gameClient } from './gameClient';

export async function leaveWithConfirm(
  roomId: string,
  t: TFunction,
  opts: { isHost?: boolean } = {},
): Promise<boolean> {
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const titleKey = opts.isHost ? 'multiplayer.endGameConfirmTitle' : 'multiplayer.leaveConfirmTitle';
    const bodyKey = opts.isHost ? 'multiplayer.endGameConfirmBody' : 'multiplayer.leaveConfirmBody';
    const accepted = window.confirm(`${t(titleKey)}\n\n${t(bodyKey)}`);
    if (!accepted) return false;
  }
  const result = await gameClient.leaveRoom(roomId);
  return result.ok === true;
}

import type { TFunction } from 'i18next';
import { gameClient } from './gameClient';
import { confirm } from './confirmDialog';

type Context = 'game' | 'room';

export async function leaveWithConfirm(
  roomId: string,
  t: TFunction,
  opts: { isHost?: boolean; context?: Context } = {},
): Promise<boolean> {
  const context: Context = opts.context ?? 'game';
  let titleKey: string;
  let bodyKey: string;
  if (context === 'room') {
    titleKey = opts.isHost ? 'multiplayer.leaveRoomHostConfirmTitle' : 'multiplayer.leaveRoomConfirmTitle';
    bodyKey = opts.isHost ? 'multiplayer.leaveRoomHostConfirmBody' : 'multiplayer.leaveRoomConfirmBody';
  } else {
    titleKey = opts.isHost ? 'multiplayer.endGameConfirmTitle' : 'multiplayer.leaveConfirmTitle';
    bodyKey = opts.isHost ? 'multiplayer.endGameConfirmBody' : 'multiplayer.leaveConfirmBody';
  }
  const accepted = await confirm({
    title: t(titleKey),
    body: t(bodyKey),
    confirmLabel: t('common.confirm'),
    cancelLabel: t('common.cancel'),
    danger: true,
  });
  if (!accepted) return false;
  const result = await gameClient.leaveRoom(roomId);
  return result.ok === true;
}

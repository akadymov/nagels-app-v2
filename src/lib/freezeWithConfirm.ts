import type { TFunction } from 'i18next';
import { gameClient } from './gameClient';
import { confirm } from './confirmDialog';

/**
 * Confirm (anti-misclick + explain) via the styled in-app modal, then freeze.
 * Returns true iff the pause request succeeded.
 */
export async function freezeWithConfirm(roomId: string, t: TFunction): Promise<boolean> {
  const accepted = await confirm({
    title: t('freeze.confirmTitle'),
    body: t('freeze.confirmBody'),
    confirmLabel: t('freeze.button'),
    cancelLabel: t('common.cancel'),
  });
  if (!accepted) return false;
  const result = await gameClient.pauseGame(roomId);
  return result.ok === true;
}

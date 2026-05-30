import React from 'react';
import { create } from 'zustand';
import { ConfirmModal } from '../components/ConfirmModal';

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}

interface ConfirmState {
  req: ConfirmOptions | null;
  _resolve: ((v: boolean) => void) | null;
  open: (req: ConfirmOptions, resolve: (v: boolean) => void) => void;
  settle: (v: boolean) => void;
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  req: null,
  _resolve: null,
  open: (req, resolve) => set({ req, _resolve: resolve }),
  settle: (v) => {
    const r = get()._resolve;
    set({ req: null, _resolve: null });
    r?.(v);
  },
}));

/**
 * Styled replacement for window.confirm. Resolves true on confirm, false on
 * cancel/dismiss. A previously-pending request (if any) is resolved false first.
 */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const prev = useConfirmStore.getState()._resolve;
    if (prev) prev(false);
    useConfirmStore.getState().open(opts, resolve);
  });
}

/** Mount once at the app root. Renders the active confirm dialog, if any. */
export const ConfirmRoot: React.FC = () => {
  const req = useConfirmStore((s) => s.req);
  const settle = useConfirmStore((s) => s.settle);
  if (!req) return null;
  return (
    <ConfirmModal
      visible
      title={req.title}
      body={req.body}
      confirmLabel={req.confirmLabel}
      cancelLabel={req.cancelLabel}
      danger={req.danger}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
};

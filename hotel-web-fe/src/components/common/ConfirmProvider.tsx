import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import type { ConfirmOptions } from './ConfirmDialog';

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

/**
 * Mounts the single app-wide confirm dialog and hands `useConfirm()` a
 * promise-based `window.confirm` replacement. Must wrap anything that calls
 * `useConfirm()` — it is mounted once in `App.tsx`.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // The resolver is tracked outside state as well, so settling never happens
  // inside a state updater (React double-invokes those under StrictMode) and so
  // unmounting mid-prompt can still settle the promise rather than leaving the
  // caller awaiting forever.
  const pendingRef = useRef<PendingConfirm | null>(null);

  useEffect(
    () => () => {
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    },
    []
  );

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        const superseded = pendingRef.current;
        const next: PendingConfirm = { options, resolve };
        pendingRef.current = next;
        setPending(next);
        // A second prompt while one is open would otherwise strand the first
        // caller. Treat the earlier one as declined.
        superseded?.resolve(false);
      }),
    []
  );

  const settle = useCallback((confirmed: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(confirmed);
  }, []);

  const handleConfirm = useCallback(() => settle(true), [settle]);
  const handleCancel = useCallback(() => settle(false), [settle]);

  return (
    // `confirm` is stable for the provider's lifetime, so consumers never
    // re-render just because a prompt opened somewhere else in the tree.
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        // Remount per prompt so the confirm button re-takes autoFocus and no
        // stale text flashes on reopen.
        key={pending ? 'open' : 'closed'}
        open={Boolean(pending)}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        message={pending?.options.message ?? ''}
        title={pending?.options.title}
        confirmText={pending?.options.confirmText}
        cancelText={pending?.options.cancelText}
        severity={pending?.options.severity}
      />
    </ConfirmContext.Provider>
  );
}

/**
 * Returns an async `confirm(options)` that resolves `true` when the user
 * accepts. Replaces `window.confirm`, which renders an unstyled
 * "tauri.localhost says" box in the desktop webview:
 *
 * ```ts
 * if (!(await confirm({ message: 'Delete this payment record?', severity: 'error' }))) return;
 * ```
 */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return confirm;
}

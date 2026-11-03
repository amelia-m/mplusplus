/**
 * Which tab autosaves. All tabs share the one autosave slot, so two tabs
 * saving would overwrite each other. The first tab takes a browser lock
 * (Web Locks API) and owns autosave until it closes; a tab opened while
 * the lock is held waits for it and takes over when the owner closes
 * (Amelia, 2026-11-03: option 2, "y"). Where the API is missing, every
 * tab autosaves, as before.
 */

/** Lock name; tabs of the same origin share it. */
export const AUTOSAVE_LOCK = 'mplusplus.autosave';

/** The part of `LockManager` used here, so tests can pass a fake. */
export interface AutosaveLocks {
  request(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<unknown> | unknown,
  ): Promise<unknown>;
  request(name: string, callback: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown>;
}

/**
 * Claim autosave for this tab. `onOwn` runs once, when the tab owns it:
 * at once when the lock is free (or the API is missing), otherwise after
 * `onWait`, when the owning tab closes. The lock is held until the tab
 * closes.
 */
export function claimAutosave(locks: AutosaveLocks | undefined, onOwn: () => void, onWait: () => void): void {
  if (!locks) {
    onOwn();
    return;
  }
  const own = (): Promise<void> => {
    onOwn();
    return new Promise<void>(() => {}); // held until the tab closes
  };
  void locks.request(AUTOSAVE_LOCK, { ifAvailable: true }, (lock) => {
    if (lock) return own();
    onWait();
    void locks.request(AUTOSAVE_LOCK, own);
    return undefined;
  });
}

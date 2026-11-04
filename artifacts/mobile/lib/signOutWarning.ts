// Sign out deletes recordings that haven't uploaded yet (Wave 1 review A10).
// John's call (Nov 4): warn first, with Cancel and Sign out anyway, because
// a lost match recording can't be redone. Pure, so it can be unit tested.

export interface SignOutWarning {
  title: string;
  message: string;
  confirmLabel: string;
}

/** The warning to show before signing out, or null when nothing would be lost. */
export function signOutWarning(waitingCount: number): SignOutWarning | null {
  if (!Number.isFinite(waitingCount) || waitingCount <= 0) return null;
  const message =
    waitingCount === 1
      ? "1 recording hasn't uploaded. Signing out deletes it."
      : `${waitingCount} recordings haven't uploaded. Signing out deletes them.`;
  return { title: "Recordings haven't uploaded", message, confirmLabel: "Sign out anyway" };
}

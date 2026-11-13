import React from "react";

import { DangerLink } from "@/components/DangerLink";

/**
 * Leaving (a league, today): DangerLink with the door icon (decision 184).
 * Kept as a thin wrapper so callers read as what they do.
 */
export function LeaveAction({ label, onPress, busy = false }: { label: string; onPress: () => void; busy?: boolean }) {
  return <DangerLink label={label} icon="door.leave" onPress={onPress} busy={busy} />;
}

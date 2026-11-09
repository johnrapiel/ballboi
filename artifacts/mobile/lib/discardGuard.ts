// "Discard changes?" before leaving an editor. Pure, so it's unit tested; the
// hook is `hooks/useDiscardGuard.ts`.
//
// The guard has to be off before the screen tries to leave. Dispatching the
// saved back action while the guard was still on blocked it again and asked
// "Discard changes?" again, in a loop (John, Nov 7 on sheets; Nov 9 on When
// you can play). So Discard and Save each move the guard to a phase where it's
// off, and only then does the screen leave.

/** editing: asks before leaving if dirty. discarding: Discard was tapped. finished: saved or done. */
export type DiscardPhase = "editing" | "discarding" | "finished";

export type DiscardEvent = "discard" | "finish";

/** Whether leaving should stop and ask. */
export function guardOn(dirty: boolean, phase: DiscardPhase): boolean {
  return dirty && phase === "editing";
}

/** The next phase. Once leaving has started, nothing turns the guard back on. */
export function nextPhase(phase: DiscardPhase, event: DiscardEvent): DiscardPhase {
  if (phase !== "editing") return phase;
  return event === "discard" ? "discarding" : "finished";
}

/** Copy for the alert. Each screen keeps its own words. */
export type DiscardCopy = { title: string; message: string };

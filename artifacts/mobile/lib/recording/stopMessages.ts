// What a stop says (spec: Ball Boi > Recording, Safety cap). Kept free of
// React Native so lib/__tests__ can check it; safety.ts re-exports it.

import { captionFor, type CueId } from "@/lib/coachLines";

export type StopReason = "user" | "battery" | "storage" | "time";

/**
 * The stop message for an auto-stop: the voice coach's caption for it, from
 * the one manifest (G10). Low battery has a recorded line (21); low storage
 * and the 4-hour cap play the chime with this caption.
 */
export const STOP_MESSAGES: Record<Exclude<StopReason, "user">, string> = {
  battery: captionFor("autoStopBattery") ?? "",
  storage: captionFor("autoStopStorage") ?? "",
  time: captionFor("autoStopTime") ?? "",
};

/** The line the coach plays for each stop, after capture ends. */
export const STOP_CUES: Record<StopReason, CueId> = {
  user: "stopped",
  battery: "autoStopBattery",
  storage: "autoStopStorage",
  time: "autoStopTime",
};

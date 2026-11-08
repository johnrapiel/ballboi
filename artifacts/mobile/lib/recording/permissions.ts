// Camera allowed but microphone denied (spec decision list, B-journey "Camera
// and mic prompts"). The camera screen says so in text with Open Settings,
// instead of recording a silent video without a word.

export interface PermissionLike {
  granted: boolean;
  status: "granted" | "denied" | "undetermined" | string;
  canAskAgain: boolean;
}

export type MicState = "ok" | "ask" | "denied";

/** Only meaningful once the camera is allowed. "ask": iOS can still show its prompt. */
export function micState(mic: PermissionLike | null | undefined): MicState {
  if (!mic || mic.granted) return "ok";
  if (mic.status === "undetermined" && mic.canAskAgain) return "ask";
  return "denied";
}

export const MIC_DENIED_TITLE = "Microphone is off";
export const MIC_DENIED_BODY =
  "Ball Boi listens for the sound of the ball being hit to find each shot. Turn on the microphone for Ball Boi in Settings so your match can be fully analyzed.";

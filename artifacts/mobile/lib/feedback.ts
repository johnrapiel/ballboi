// "Something not working?" (spec decision 86, B3). Pure, so the rules are
// tested in Node (lib/__tests__/feedback.test.ts). Server: routes/feedback.ts.

export const FEEDBACK_TITLE = "Something not working?";

export const FEEDBACK_PROBLEMS = [
  { key: "recording_stopped", label: "Recording stopped on its own" },
  { key: "upload_stuck", label: "Upload is stuck" },
  { key: "camera_mic", label: "Camera or mic won't turn on" },
  { key: "match_missing", label: "My match isn't there to record" },
  { key: "score_not_saved", label: "Score didn't save" },
  { key: "app_froze", label: "App froze or closed" },
  { key: "something_else", label: "Something else" },
] as const;

export type FeedbackProblem = (typeof FEEDBACK_PROBLEMS)[number]["key"];
export type FeedbackSource = "settings" | "ready" | "processing" | "replay";

export const MAX_NOTE = 2000;

export function isFeedbackProblem(v: unknown): v is FeedbackProblem {
  return FEEDBACK_PROBLEMS.some((p) => p.key === v);
}

export function isFeedbackSource(v: unknown): v is FeedbackSource {
  return v === "settings" || v === "ready" || v === "processing" || v === "replay";
}

/** The text box's label: required for Something else, optional otherwise. */
export function noteLabel(problem: FeedbackProblem | null): string {
  return problem === "something_else" ? "What's not working? (required)" : "Anything else we should know? (optional)";
}

/** What's wrong with the form, in words, or null when it can be sent. */
export function feedbackError(problem: FeedbackProblem | null, note: string): string | null {
  if (!problem) return "Pick what's not working.";
  if (problem === "something_else" && note.trim() === "") return "Tell us what's not working.";
  if (note.trim().length > MAX_NOTE) return `Keep it under ${MAX_NOTE} characters.`;
  return null;
}

/**
 * The exact iPhone, from expo-device: "iPhone 16 Pro (iPhone17,1)". Falls
 * back to the screen size (deviceLabel) when the model isn't known, such as
 * in a simulator.
 */
export function exactDevice(modelName: string | null | undefined, modelId: string | null | undefined, fallback: string): string {
  const name = modelName?.trim();
  const id = modelId?.trim();
  if (name && id && id !== name) return `${name} (${id})`;
  return name || id || fallback;
}

/**
 * The phone, as best the app can tell from the screen alone:
 * "iPhone · 393×852 pt @3x". The screen size narrows it to a model family.
 */
export function deviceLabel(idiom: string | undefined, width: number, height: number, scale: number): string {
  const kind = idiom === "pad" ? "iPad" : "iPhone";
  const w = Math.round(Math.min(width, height));
  const h = Math.round(Math.max(width, height));
  return `${kind} · ${w}×${h} pt @${Math.round(scale)}x`;
}

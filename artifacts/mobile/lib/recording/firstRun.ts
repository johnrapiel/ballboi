// The first-run carousel before a recording (spec decisions 90 to 92; B7 to B9).
// Pure, so the rules are tested in Node (lib/__tests__/firstRun.test.ts).
//
// First recording: 1) What Ball Boi records, 2) Your choices (the training
// toggle, plus the Beta Footage Release checkbox while the beta backend asks
// for it), 3) Set up your phone, ending in Open camera.
// Later recordings: page 3 alone, unless "Don't show this again" was checked.
// A new release version: page 2 again, unchecked, then page 3.

/** Spec wording for the training toggle. Keep word for word. */
export const TRAINING_COPY =
  "We use match video to train our shot tracking. Your personal information is never shared or sold. Turn this off anytime in Settings.";

export const RELEASE_TITLE = "Ball Boi Beta Footage Release";
/** The release checkbox (section 3 copy). Unchecked by default. */
export const RELEASE_CHECKBOX = "I agree to the Ball Boi Beta Footage Release";
/** Under the disabled Next button on page 2. */
export const RELEASE_BLOCKED = "Check the box above to continue.";
/** The setup page's checkbox. */
export const HIDE_SETUP = "Don't show this again";

export type FirstRunPage = "records" | "choices" | "setup";

export interface ConsentState {
  consented: boolean;
  release?: { needed: boolean } | null;
}

/** The pages to show before the camera opens, in order. Empty: straight to the camera. */
export function firstRunPages(consent: ConsentState, hideSetup: boolean): FirstRunPage[] {
  const pages: FirstRunPage[] = [];
  if (!consent.consented) pages.push("records");
  if (!consent.consented || consent.release?.needed) pages.push("choices");
  // The setup page always follows the choices, so the first run ends in Open camera.
  if (!hideSetup || pages.length > 0) pages.push("setup");
  return pages;
}

/** "Page 2 of 3", read by VoiceOver on every page change. */
export function pageLabel(index: number, count: number): string {
  return `Page ${index + 1} of ${count}`;
}

/** Can the person move past this page? Page 2 needs the release box while it's asked for. */
export function canLeavePage(page: FirstRunPage, releaseNeeded: boolean, releaseChecked: boolean): boolean {
  return page !== "choices" || !releaseNeeded || releaseChecked;
}

/** The phone setup checklist (B7). Real text, so VoiceOver and Dynamic Type get it. */
export const SETUP_CHECKLIST: { title: string; detail: string }[] = [
  {
    title: "On the fence behind the baseline",
    detail: "Centered and up high, turned sideways, back camera to the court and screen to the fence. Both baselines in view.",
  },
  { title: "10% battery or plugged in", detail: "Ball Boi won't start recording below 10% unless the phone is charging." },
  { title: "2 GB free", detail: "Ball Boi needs at least 2 GB of space to start recording." },
  { title: "Do Not Disturb on", detail: "So a call or notification doesn't interrupt the video." },
];

/** Text alternative for the setup graphic. */
export const SETUP_GRAPHIC_LABEL =
  "Diagram of a tennis court from above. The phone is on the fence behind one baseline, centered, turned sideways, with its back camera facing the court so both baselines are in view.";

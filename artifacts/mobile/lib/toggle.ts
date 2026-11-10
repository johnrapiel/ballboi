// The switch's look (John, Nov 9: the "Help Ball Boi get smarter" switch was
// an ivory track with a white knob at night, so on and off looked the same).
//
// iOS 26 draws its own white knob on a native switch whatever color the app
// asks for, and a native switch can't take a border. So Ball Boi's one switch
// (components/Toggle.tsx) is drawn from the design system tokens instead, in
// the shape and size of the iOS switch:
//
// - On: `ink` track and border, knob in `on-ink`, knob on the right.
//   Day: navy track, white knob. Night: ivory track, charcoal knob.
// - Off: no fill (the card or page shows through), a `hairline-strong`
//   border, and a solid `ink-muted` knob on the left.
// - The knob's side and its fill tell on from off, never color alone.
//   Increase Contrast swaps in the -hc hairline and muted ink (useColors).
//
// Pure TypeScript: tested in lib/__tests__/toggle.test.ts. The pairs are in
// scripts/check-contrast.mjs.

/** iOS switch size. */
export const TOGGLE_WIDTH = 51;
export const TOGGLE_HEIGHT = 31;
/** A control border (3:1, WCAG 1.4.11), thick enough to see. */
export const TOGGLE_BORDER = 1.5;
const INSET = 2;
export const KNOB_SIZE = TOGGLE_HEIGHT - 2 * TOGGLE_BORDER - 2 * INSET;
/** How far the knob moves from off to on. */
export const KNOB_TRAVEL = TOGGLE_WIDTH - 2 * TOGGLE_BORDER - 2 * INSET - KNOB_SIZE;

export interface ToggleColors {
  ink: string;
  inkMuted: string;
  onInk: string;
  hairlineStrong: string;
}

export interface ToggleLook {
  track: string;
  border: string;
  knob: string;
}

export function toggleLook(c: ToggleColors, on: boolean): ToggleLook {
  return on
    ? { track: c.ink, border: c.ink, knob: c.onInk }
    : { track: "transparent", border: c.hairlineStrong, knob: c.inkMuted };
}

/** What VoiceOver reads after the label and "switch button". */
export function toggleValue(on: boolean): string {
  return on ? "On" : "Off";
}

// One button height across the app (John, Nov 10). Pure math so it can be
// tested in Node; components/ui.tsx applies it to Button and ButtonRow.
//
// - Every button is the button type style's line height plus the standard
//   padding: 22 + 13 + 13 = 48pt at the default text size.
// - Only Dynamic Type changes it, and it grows by the line height alone, so
//   every button grows the same amount at the same setting.
// - Labels stay on one line. Buttons side by side share one height. When a
//   row can't fit its labels on one line, its buttons stack full width.

import { MIN_TAP, spacing, type } from "@/constants/tokens";

/** The button type style's line height at the default text size. */
export const BUTTON_LINE = type.button.lineHeight;
/** Space above and below the label. 22 + 2 × 13 = 48. */
export const BUTTON_PAD_Y = 13;
/** Space either side of the label. */
export const BUTTON_PAD_X = spacing.space6;
/** Every button at the default text size. */
export const BUTTON_HEIGHT = BUTTON_LINE + 2 * BUTTON_PAD_Y;

/** iOS reports fontScale from 0.82 (xSmall) to about 3.1 (the largest accessibility size). */
function safeScale(fontScale: number): number {
  return Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
}

/**
 * The one button height at a Dynamic Type setting. Never smaller than the
 * default 48pt (smaller text settings keep the 48pt target), never under 44.
 */
export function buttonHeight(fontScale: number): number {
  const s = Math.max(1, safeScale(fontScale));
  return Math.max(MIN_TAP, Math.ceil(BUTTON_LINE * s) + 2 * BUTTON_PAD_Y);
}

/**
 * DM Sans SemiBold advance widths, in thousandths of an em, for printable
 * ASCII from space (32) to tilde (126). Read from the font file
 * (@expo-google-fonts/dm-sans 600SemiBold) so the estimate is close to what
 * iOS draws. Anything else (accents, curly quotes) counts as a wide 0.65 em.
 */
const DM_SANS_600 = [
  244, 291, 344, 841, 597, 868, 767, 186, 395, 395, 503, 571, 227, 565, 236, 417, 698, 348, 577, 599, 638, 618, 633, 536,
  625, 633, 239, 263, 571, 571, 571, 534, 1034, 696, 628, 732, 701, 578, 550, 772, 704, 261, 529, 633, 549, 873, 718, 781,
  604, 781, 620, 597, 587, 676, 695, 1003, 650, 618, 567, 358, 417, 358, 661, 706, 228, 574, 646, 596, 646, 592, 362, 585,
  605, 264, 265, 556, 254, 926, 604, 605, 646, 646, 397, 523, 421, 604, 554, 803, 549, 590, 481, 458, 261, 458, 571,
];
const OTHER_CHAR = 650;
/**
 * Room for Bold Text (DM Sans Bold is up to 8% wider) and rounding, so a row
 * stacks a touch early rather than cutting a word.
 */
const SAFETY = 1.08;

/** About how wide a label is set in the button style, padding included. */
export function buttonWidth(label: string, fontScale: number): number {
  const s = safeScale(fontScale);
  let em = 0;
  let chars = 0;
  for (const ch of label) {
    const code = ch.codePointAt(0)!;
    em += (code >= 32 && code <= 126 ? DM_SANS_600[code - 32] : OTHER_CHAR) / 1000;
    chars += 1;
  }
  const text = (em * type.button.fontSize + chars * type.button.letterSpacing) * s * SAFETY;
  return Math.ceil(text) + 2 * BUTTON_PAD_X;
}

/**
 * Whether a row of buttons should stack. Side by side, each button gets an
 * equal share of the row; if any label wouldn't fit its share on one line,
 * the whole row stacks full width. A row of one never stacks. Before the row
 * has been measured (width 0) it stays side by side.
 */
export function shouldStackButtons(labels: readonly string[], rowWidth: number, fontScale: number, gap: number = spacing.space2): boolean {
  if (labels.length < 2 || !(rowWidth > 0)) return false;
  const share = (rowWidth - gap * (labels.length - 1)) / labels.length;
  return labels.some((l) => buttonWidth(l, fontScale) > share);
}

// The height of a full-height sheet (New league). Pure, so it's unit tested.
//
// Native formSheet sheets on iOS 26 show nothing unless their content has a
// definite height: `flex: 1` collapses to zero inside them (the hugging
// sheets hit the same thing in Wave 1 Fix 1b). So the full-height sheet sets
// its height in points instead.
//
// The large iOS sheet starts this far below the top safe area (the status bar
// or the Dynamic Island); the screen behind it shows in that gap.
export const SHEET_TOP_GAP = 10;

/**
 * Height of the full-height sheet's content, in points, and how much of it is
 * left above the keyboard. The sheet's bottom edge sits on the bottom of the
 * screen, where the keyboard rises from, so the keyboard's height comes
 * straight off the bottom. Erring short is safe: the sheet's own background
 * shows under the content.
 */
export function fillSheetHeight({
  windowHeight,
  topInset,
  keyboardHeight = 0,
}: {
  windowHeight: number;
  topInset: number;
  keyboardHeight?: number;
}): number {
  const sheet = windowHeight - Math.max(0, topInset) - SHEET_TOP_GAP;
  return Math.max(0, Math.round(sheet - Math.max(0, keyboardHeight)));
}

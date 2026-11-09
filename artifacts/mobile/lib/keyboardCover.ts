// How much of the screen the keyboard covers. Pure, so it's unit tested.
//
// New league is a full-height page sheet whose bottom edge sits on the bottom
// of the screen, where the keyboard rises from. So the part of the sheet the
// keyboard hides is the distance from the keyboard's top edge to the bottom of
// the window. A floating or split iPad keyboard that sits higher, or a
// keyboard that's off screen, covers nothing at the bottom and counts as 0.

/**
 * Points of the window's bottom the keyboard covers, rounded, never negative
 * and never more than the window. `keyboardTop` is the keyboard's top edge in
 * window coordinates (`endCoordinates.screenY`), or null when it's down.
 */
export function keyboardCover(windowHeight: number, keyboardTop: number | null | undefined): number {
  if (keyboardTop == null || !Number.isFinite(keyboardTop) || !(windowHeight > 0)) return 0;
  return Math.round(Math.min(windowHeight, Math.max(0, windowHeight - keyboardTop)));
}

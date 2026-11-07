// Where a point in the upright still lands on the camera preview, so the
// court overlay draws over the lines the player sees.
//
// The app is portrait only, but the mounted phone is usually on its side. The
// still comes out upright for how the phone is held (expo-camera's responsive
// orientation), while the preview fills the portrait screen. So a sideways
// phone sees the still turned a quarter, then scaled to fill the screen and
// cropped, like the preview's aspect fill.
//
// Pure TypeScript, no React Native: tested in lib/__tests__/courtAim.test.ts.

import type { Point } from "@/lib/court/geometry";

/** expo-camera's onResponsiveOrientationChanged values. */
export type PhoneOrientation = "portrait" | "portraitUpsideDown" | "landscapeLeft" | "landscapeRight";

/**
 * A normalized still point (upright, 0 to 1) as a point on a portrait screen
 * `screenW` x `screenH`, given the still's width over height.
 */
export function stillToScreen(
  p: Point,
  orientation: PhoneOrientation,
  stillAspect: number,
  screenW: number,
  screenH: number,
): Point {
  // Turn the still into screen axes. landscapeLeft: the top of the phone
  // points left, so the screen's x runs up the world and its y runs right.
  let x: number;
  let y: number;
  let contentAspect: number; // width over height on screen
  switch (orientation) {
    case "landscapeLeft":
      x = 1 - p.y;
      y = p.x;
      contentAspect = 1 / stillAspect;
      break;
    case "landscapeRight":
      x = p.y;
      y = 1 - p.x;
      contentAspect = 1 / stillAspect;
      break;
    case "portraitUpsideDown":
      x = 1 - p.x;
      y = 1 - p.y;
      contentAspect = stillAspect;
      break;
    default:
      x = p.x;
      y = p.y;
      contentAspect = stillAspect;
  }
  // Aspect fill: scale until the content covers the screen, centred.
  const screenAspect = screenW / screenH;
  let w: number;
  let h: number;
  if (contentAspect > screenAspect) {
    h = screenH;
    w = screenH * contentAspect;
  } else {
    w = screenW;
    h = screenW / contentAspect;
  }
  return { x: (screenW - w) / 2 + x * w, y: (screenH - h) / 2 + y * h };
}

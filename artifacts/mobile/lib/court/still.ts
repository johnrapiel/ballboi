// Sizing the still frame the phone takes for court detection.
// Pure TypeScript, no React Native: tested in lib/__tests__/court.test.ts.

import type { PhoneOrientation } from "@/lib/court/overlay";

/** The video is 1280 x 720 (lib/recording/settings.ts): 16:9 whichever way the phone is held. */
export const VIDEO_ASPECT = 16 / 9;
/** Detection runs on a frame this wide on its long side. */
export const ANALYSIS_LONG_SIDE = 480;

export interface Rect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * The centered crop of a still that matches the video's frame. A still can
 * come out 4:3 when the video is 16:9, and corners are shares of the frame,
 * so the two have to cover the same view. Null when it already matches.
 */
export function videoAspectCrop(width: number, height: number): Rect | null {
  const landscape = width >= height;
  const target = landscape ? VIDEO_ASPECT : 1 / VIDEO_ASPECT;
  const aspect = width / height;
  if (Math.abs(aspect - target) / target < 0.01) return null;
  if (aspect > target) {
    const w = Math.round(height * target);
    return { originX: Math.round((width - w) / 2), originY: 0, width: w, height };
  }
  const h = Math.round(width / target);
  return { originX: 0, originY: Math.round((height - h) / 2), width, height: h };
}

/** The analysis size for a frame, keeping its shape. */
export function analysisSize(width: number, height: number): { width: number; height: number } {
  const scale = ANALYSIS_LONG_SIDE / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Degrees, clockwise, to turn a still upright before court detection, or 0.
 *
 * With responsiveOrientationWhenOrientationLocked, expo-camera sets the
 * capture to the way the phone is physically held (its accelerometer), so a
 * sideways phone's still comes out landscape, and expo-image-manipulator
 * bakes that orientation into the pixels before it crops or resizes. So this
 * is normally 0. It only turns a still that came out portrait while the
 * phone reports it's on its side: then the picture is the sensor's portrait
 * view, and the court in it lies on its side, where detection finds nothing.
 * landscapeLeft (the top of the phone to the left) turns it a quarter
 * counterclockwise, landscapeRight a quarter clockwise.
 */
export function uprightTurn(orientation: PhoneOrientation, width: number, height: number): 0 | 90 | -90 {
  if (height <= width) return 0;
  if (orientation === "landscapeLeft") return -90;
  if (orientation === "landscapeRight") return 90;
  return 0;
}

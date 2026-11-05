// Sizing the still frame the phone takes for court detection.
// Pure TypeScript, no React Native: tested in lib/__tests__/court.test.ts.

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

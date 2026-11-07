// Tennis court geometry for on-device court detection and the court-line fix.
// Mirrors artifacts/ml-server/services/court_model.py so the phone and the
// server agree on what the four corners mean.
//
// Court coordinates are meters, ITF dimensions: origin at the center of the
// net, +x to the right as seen from the camera behind the near baseline, +y
// toward the far baseline. Image points are normalized: (0, 0) is the
// top-left of the frame, (1, 1) the bottom-right.
//
// Pure TypeScript, no React Native: tested in lib/__tests__/court.test.ts.

export type Point = { x: number; y: number };
/** The four singles-court corners, in calibration order. */
export type Corners = [Point, Point, Point, Point];
/** Row-major 3x3 homography. */
export type Homography = number[];

export const HALF_LENGTH = 11.885;
export const SINGLES_HALF_WIDTH = 4.115;
export const DOUBLES_HALF_WIDTH = 5.485;
export const SERVICE_LINE = 6.4;

/** Corner order the phone, the API and the ML server all use. */
export const CORNER_KEYS = ["nearLeft", "nearRight", "farRight", "farLeft"] as const;
export type CornerKey = (typeof CORNER_KEYS)[number];

/** Labels the API checks (COURT_CALIBRATION_POINT_ORDER in api-server ballBoiUtils.ts). */
export const CALIBRATION_POINT_ORDER = [
  "Near left baseline",
  "Near right baseline",
  "Far right baseline",
  "Far left baseline",
] as const;

/** What each corner is called on screen and to VoiceOver. */
export const CORNER_NAMES: Record<CornerKey, string> = {
  nearLeft: "Near left corner",
  nearRight: "Near right corner",
  farRight: "Far right corner",
  farLeft: "Far left corner",
};

export const SINGLES_CORNERS_M: Corners = [
  { x: -SINGLES_HALF_WIDTH, y: -HALF_LENGTH },
  { x: SINGLES_HALF_WIDTH, y: -HALF_LENGTH },
  { x: SINGLES_HALF_WIDTH, y: HALF_LENGTH },
  { x: -SINGLES_HALF_WIDTH, y: HALF_LENGTH },
];

type Segment = [Point, Point];

/** Singles court, service boxes and the net: what the fix screen draws. */
export const COURT_LINES_M: Segment[] = [
  [{ x: -SINGLES_HALF_WIDTH, y: -HALF_LENGTH }, { x: SINGLES_HALF_WIDTH, y: -HALF_LENGTH }],
  [{ x: -SINGLES_HALF_WIDTH, y: HALF_LENGTH }, { x: SINGLES_HALF_WIDTH, y: HALF_LENGTH }],
  [{ x: -SINGLES_HALF_WIDTH, y: -HALF_LENGTH }, { x: -SINGLES_HALF_WIDTH, y: HALF_LENGTH }],
  [{ x: SINGLES_HALF_WIDTH, y: -HALF_LENGTH }, { x: SINGLES_HALF_WIDTH, y: HALF_LENGTH }],
  [{ x: -SINGLES_HALF_WIDTH, y: -SERVICE_LINE }, { x: SINGLES_HALF_WIDTH, y: -SERVICE_LINE }],
  [{ x: -SINGLES_HALF_WIDTH, y: SERVICE_LINE }, { x: SINGLES_HALF_WIDTH, y: SERVICE_LINE }],
  [{ x: 0, y: -SERVICE_LINE }, { x: 0, y: SERVICE_LINE }],
  [{ x: -DOUBLES_HALF_WIDTH, y: 0 }, { x: DOUBLES_HALF_WIDTH, y: 0 }],
];

/** Every painted line, doubles alleys included: what detection scores a view against. */
export const SCORE_LINES_M: Segment[] = [
  ...COURT_LINES_M.slice(0, -1),
  [{ x: -DOUBLES_HALF_WIDTH, y: -HALF_LENGTH }, { x: -DOUBLES_HALF_WIDTH, y: HALF_LENGTH }],
  [{ x: DOUBLES_HALF_WIDTH, y: -HALF_LENGTH }, { x: DOUBLES_HALF_WIDTH, y: HALF_LENGTH }],
  [{ x: -DOUBLES_HALF_WIDTH, y: -HALF_LENGTH }, { x: DOUBLES_HALF_WIDTH, y: -HALF_LENGTH }],
  [{ x: -DOUBLES_HALF_WIDTH, y: HALF_LENGTH }, { x: DOUBLES_HALF_WIDTH, y: HALF_LENGTH }],
];

/**
 * Exact homography mapping four src points to four dst points, or null when
 * the points are degenerate (three in a line, or repeated).
 */
export function homography(src: readonly Point[], dst: readonly Point[]): Homography | null {
  if (src.length !== 4 || dst.length !== 4) return null;
  // 8 equations, 8 unknowns (h22 = 1), solved by Gaussian elimination.
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const n = 8;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-10) return null;
    if (pivot !== col) [a[pivot], a[col]] = [a[col], a[pivot]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) a[r][c] -= f * a[col][c];
    }
  }
  const h = a.map((row, i) => row[n] / row[i]);
  if (h.some((v) => !Number.isFinite(v))) return null;
  return [...h, 1];
}

export function applyHomography(h: Homography, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

/** Court meters to normalized image points, for corners in calibration order. */
export function courtToImage(corners: readonly Point[]): Homography | null {
  return homography(SINGLES_CORNERS_M, corners);
}

/** Absolute area of a polygon (shoelace). */
export function polygonArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * True when the four corners can be a court seen from behind a baseline:
 * a convex shape the server will accept (same checks as
 * courtCalibrationFromMetadata in api-server), with the far baseline above
 * the near one and left staying left.
 */
export function isCourtShape(c: readonly Point[]): boolean {
  if (c.length !== 4 || c.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  if (polygonArea(c) < 0.01) return false;
  const cross = c.map((p, i) => {
    const q = c[(i + 1) % 4];
    const r = c[(i + 2) % 4];
    return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
  });
  if (cross.some((v) => Math.abs(v) < 0.001)) return false;
  if (cross.some((v) => v > 0) && cross.some((v) => v < 0)) return false;
  const [nl, nr, fr, fl] = c;
  return fl.y < nl.y && fr.y < nr.y && nl.x < nr.x && fl.x < fr.x;
}

/** Court lines as normalized image segments for drawing, or [] when the corners don't make a view. */
export function courtLinesInImage(corners: readonly Point[]): Segment[] {
  const h = courtToImage(corners);
  if (!h) return [];
  return COURT_LINES_M.map(([a, b]) => [applyHomography(h, a), applyHomography(h, b)] as Segment);
}

/** Where the handles start when nothing was found: a typical view from behind the baseline. */
export const DEFAULT_CORNERS: Corners = [
  { x: 0.12, y: 0.9 },
  { x: 0.88, y: 0.9 },
  { x: 0.64, y: 0.38 },
  { x: 0.36, y: 0.38 },
];

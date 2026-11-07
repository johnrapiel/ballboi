// On-device court detection (spec: Ball Boi > Processing, "court detection
// runs on device"). Finds the four singles-court corners in one still frame.
//
// The same method as the ML server's services/pipeline/court.py, so both
// sides agree: pick out the painted lines (thin, bright, unsaturated marks),
// find the long straight ones, then search for the view of a regulation court
// that best explains them (model fitting in the style of Farin et al., 2004).
// No model weights, no native code: plain TypeScript on a small frame
// (about 480 x 270), so it runs in well under a second on a phone.
//
// Pure TypeScript, no React Native: tested in lib/__tests__/court.test.ts.

import {
  applyHomography,
  DOUBLES_HALF_WIDTH,
  HALF_LENGTH,
  homography,
  polygonArea,
  SCORE_LINES_M,
  SERVICE_LINE,
  SINGLES_CORNERS_M,
  SINGLES_HALF_WIDTH,
  type Corners,
  type Homography,
  type Point,
} from "@/lib/court/geometry";

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row by row. */
  data: Uint8Array | Uint8ClampedArray;
}

export interface CourtFit {
  /** Normalized singles corners in calibration order. */
  corners: Corners;
  /** Share of the model's painted lines that land on paint in the frame, 0 to 1. */
  confidence: number;
}

/** Below this, detection doesn't count as a find (court.py's cut-off). */
export const MIN_FIT_SCORE = 0.35;

/** A line in normal form: x cos(theta) + y sin(theta) = rho, with its vote count. */
interface Line {
  rho: number;
  theta: number;
  votes: number;
}

const DEG = Math.PI / 180;
// Lines a camera behind the baseline can see. Across: far to near. Along: left to right.
const ACROSS_M = [HALF_LENGTH, SERVICE_LINE, -SERVICE_LINE, -HALF_LENGTH];
const ALONG_M = [-DOUBLES_HALF_WIDTH, -SINGLES_HALF_WIDTH, 0, SINGLES_HALF_WIDTH, DOUBLES_HALF_WIDTH];
const SAMPLES_PER_LINE = 40;

/** Separable running min or max over a k x k square. */
function rankFilter(src: Uint8Array, w: number, h: number, k: number, max: boolean): Uint8Array {
  const r = k >> 1;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const pick = max ? Math.max : Math.min;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = src[row + x];
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        if (xx >= 0 && xx < w) v = pick(v, src[row + xx]);
      }
      tmp[row + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x];
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        if (yy >= 0 && yy < h) v = pick(v, tmp[yy * w + x]);
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Thin bright marks: court paint, not sky or white clothing blobs (court.py line_mask). */
export function lineMask(px: Pixels): Uint8Array {
  const { width: w, height: h, data } = px;
  const gray = new Uint8Array(w * h);
  const lowSat = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const r = data[j];
    const g = data[j + 1];
    const b = data[j + 2];
    gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    // HSV saturation on a 0 to 255 scale, as OpenCV has it.
    lowSat[i] = mx === 0 || ((mx - mn) * 255) / mx < 90 ? 1 : 0;
  }
  const k = Math.max(5, Math.round(Math.min(w, h) / 60) | 1);
  // White top-hat: the image minus its opening keeps marks thinner than k.
  const opened = rankFilter(rankFilter(gray, w, h, k, false), w, h, k, true);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    mask[i] = gray[i] - opened[i] > 35 && lowSat[i] && gray[i] > 120 ? 1 : 0;
  }
  return mask;
}

/** Long straight lines in the mask, strongest first, each painted line once. */
export function houghLines(mask: Uint8Array, w: number, h: number): Line[] {
  const thetaSteps = 360; // 0.5 degree
  const diag = Math.ceil(Math.hypot(w, h));
  const rhoSize = diag * 2 + 1;
  const cos = new Float64Array(thetaSteps);
  const sin = new Float64Array(thetaSteps);
  for (let t = 0; t < thetaSteps; t++) {
    cos[t] = Math.cos((t * Math.PI) / thetaSteps);
    sin[t] = Math.sin((t * Math.PI) / thetaSteps);
  }
  const acc = new Uint32Array(thetaSteps * rhoSize);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let t = 0; t < thetaSteps; t++) {
        const rho = Math.round(x * cos[t] + y * sin[t]) + diag;
        acc[t * rhoSize + rho]++;
      }
    }
  }

  const minVotes = Math.min(w, h) * 0.12;
  const peaks: Line[] = [];
  const tWin = 4; // 2 degrees each way
  const rWin = 3;
  for (let t = 0; t < thetaSteps; t++) {
    for (let r = 0; r < rhoSize; r++) {
      const v = acc[t * rhoSize + r];
      if (v < minVotes) continue;
      let isPeak = true;
      for (let dt = -tWin; dt <= tWin && isPeak; dt++) {
        const tt = (t + dt + thetaSteps) % thetaSteps;
        // Wrapping past 180 degrees flips the sign of rho.
        const flip = t + dt < 0 || t + dt >= thetaSteps;
        for (let dr = -rWin; dr <= rWin; dr++) {
          if (dt === 0 && dr === 0) continue;
          const rr = flip ? 2 * diag - (r + dr) : r + dr;
          if (rr < 0 || rr >= rhoSize) continue;
          const u = acc[tt * rhoSize + rr];
          // Ties go to the first in scan order, so a flat top gives one peak.
          if (u > v || (u === v && (dt < 0 || (dt === 0 && dr < 0)))) {
            isPeak = false;
            break;
          }
        }
      }
      if (isPeak) peaks.push({ rho: r - diag, theta: (t * Math.PI) / thetaSteps, votes: v });
    }
  }
  peaks.sort((a, b) => b.votes - a.votes);

  // Merge near-duplicates, like court.py does for HoughLinesP segments.
  const merged: Line[] = [];
  const rhoTol = Math.max(w, h) * 0.012;
  for (const p of peaks) {
    const same = merged.find((m) => Math.abs(m.theta - p.theta) < 2.5 * DEG && Math.abs(m.rho - p.rho) < rhoTol);
    if (same) {
      const total = same.votes + p.votes;
      same.rho = (same.rho * same.votes + p.rho * p.votes) / total;
      same.theta = (same.theta * same.votes + p.theta * p.votes) / total;
      same.votes = total;
    } else {
      merged.push({ ...p });
    }
    if (merged.length >= 40) break;
  }
  return merged.sort((a, b) => b.votes - a.votes);
}

function intersect(a: Line, b: Line): Point | null {
  const c1 = Math.cos(a.theta);
  const s1 = Math.sin(a.theta);
  const c2 = Math.cos(b.theta);
  const s2 = Math.sin(b.theta);
  const det = c1 * s2 - s1 * c2;
  if (Math.abs(det) < 1e-6) return null;
  return { x: (a.rho * s2 - s1 * b.rho) / det, y: (c1 * b.rho - a.rho * c2) / det };
}

/** Court-meter sample points along every painted line, made once. */
const SAMPLE_POINTS_M: Point[] = (() => {
  const pts: Point[] = [];
  for (const [a, b] of SCORE_LINES_M) {
    for (let i = 0; i < SAMPLES_PER_LINE; i++) {
      const t = i / (SAMPLES_PER_LINE - 1);
      pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return pts;
})();

function score(h: Homography, dilated: Uint8Array, w: number, ht: number): number {
  let inside = 0;
  let hits = 0;
  for (const p of SAMPLE_POINTS_M) {
    const q = applyHomography(h, p);
    if (!(q.x >= 0 && q.x < w && q.y >= 0 && q.y < ht)) continue;
    inside++;
    if (dilated[(q.y | 0) * w + (q.x | 0)]) hits++;
  }
  if (inside < 60) return 0;
  // Reward explaining many painted pixels, not just a few lines that happen to fit.
  return (hits / inside) * Math.min(1, inside / 300);
}

function plausible(h: Homography, w: number, ht: number): boolean {
  const quad = SINGLES_CORNERS_M.map((p) => applyHomography(h, p));
  if (quad.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  const [nl, nr, fr, fl] = quad;
  // Behind-the-baseline view: far baseline above the near one, left stays left.
  if (!(fl.y < nl.y && fr.y < nr.y && nl.x < nr.x && fl.x < fr.x)) return false;
  const area = polygonArea(quad);
  if (area < 0.03 * w * ht || area > 4 * w * ht) return false;
  // The far half has to be on screen; the near baseline may be cut off.
  const farX = (fl.x + fr.x) / 2;
  const farY = (fl.y + fr.y) / 2;
  return farY > -0.1 * ht && farY < 0.9 * ht && farX > -0.2 * w && farX < 1.2 * w;
}

function pairs<T>(items: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) out.push([items[i], items[j]]);
  return out;
}

/**
 * Finds the court in one frame. Returns the best fit, or null when nothing
 * fits at all. A fit with a low confidence is still returned, so the
 * court-line fix can start its handles from it.
 */
export function detectCourt(px: Pixels, maxLines = 6): CourtFit | null {
  const { width: w, height: h } = px;
  const mask = lineMask(px);
  const lines = houghLines(mask, w, h);
  const across = lines.filter((l) => Math.abs(l.theta - Math.PI / 2) < 25 * DEG).slice(0, maxLines);
  const along = lines.filter((l) => Math.abs(l.theta - Math.PI / 2) >= 25 * DEG).slice(0, maxLines);
  if (across.length < 2 || along.length < 2) return null;
  const dilated = rankFilter(mask, w, h, 5, true);

  const yAtCenter = (l: Line) => (l.rho - (w / 2) * Math.cos(l.theta)) / Math.sin(l.theta);
  const xAt = (l: Line, y: number) =>
    Math.abs(Math.cos(l.theta)) > 1e-6 ? (l.rho - y * Math.sin(l.theta)) / Math.cos(l.theta) : l.rho;
  const acrossPairs = pairs(across).map(([a, b]) => (yAtCenter(a) < yAtCenter(b) ? [a, b] : [b, a]));
  const alongPairs = pairs(along).map(([a, b]) => (xAt(a, h * 0.7) < xAt(b, h * 0.7) ? [a, b] : [b, a]));
  const acrossModel = pairs(ACROSS_M); // [far, near]: ACROSS_M runs far to near
  const alongModel = pairs(ALONG_M); // [left, right]

  let best = 0;
  let bestH: Homography | null = null;
  for (const [upper, lower] of acrossPairs) {
    for (const [left, right] of alongPairs) {
      const img = [intersect(lower, left), intersect(lower, right), intersect(upper, right), intersect(upper, left)];
      if (img.some((p) => p === null)) continue;
      for (const [yFar, yNear] of acrossModel) {
        for (const [xLeft, xRight] of alongModel) {
          const court = [
            { x: xLeft, y: yNear },
            { x: xRight, y: yNear },
            { x: xRight, y: yFar },
            { x: xLeft, y: yFar },
          ];
          const hm = homography(court, img as Point[]);
          if (!hm || !plausible(hm, w, h)) continue;
          const s = score(hm, dilated, w, h);
          if (s > best) {
            best = s;
            bestH = hm;
          }
        }
      }
    }
  }
  if (!bestH) return null;
  const corners = SINGLES_CORNERS_M.map((p) => {
    const q = applyHomography(bestH, p);
    return { x: q.x / w, y: q.y / h };
  }) as Corners;
  return { corners, confidence: Math.round(best * 1000) / 1000 };
}

// On-device court detection (spec: Ball Boi > Processing, "court detection
// runs on device"). Finds the four singles-court corners in one still frame.
//
// The same method as the ML server's services/pipeline/court.py, so both
// sides agree:
//
// 1. Paint: thin, bright, unsaturated marks (a white top-hat), kept only
//    where the marks run in one clear direction. Tree branches against the
//    sky and fence wire make blotches with no single direction, so they drop
//    out here.
// 2. Lines: straight lines through that paint, found one at a time (each
//    found line's pixels are taken out before looking for the next), so one
//    thick painted line is never counted twice. Only these lines count as
//    paint from here on: the scatter of bright bits in a net, a fence or
//    trees lies on no line. Pale yellow lines (pickleball
//    lines painted over a tennis court) are set aside: they never count as
//    court paint. "Yellow" is judged against the frame's own strongest lines,
//    so evening light that warms every line doesn't hide the court.
// 3. Fit: two lines across the court and two along it, matched to every
//    pair of regulation court lines they could be, give a candidate view.
//    Views that can't be a camera behind the baseline (corners on top of
//    each other, a crossed or inside-out shape, the court passing behind the
//    camera, the far baseline wider than the near one, a lens no phone has)
//    are thrown out. The rest are scored by how much of the court's paint, in pixels on screen,
//    lands on painted lines in the frame, minus what lands on bare court.
//    Lines that collapse to a point or fall off the frame earn nothing.
// 4. Refine: the best view is pulled onto the painted lines it explains.
//
// A view where the far baseline is hidden behind the net (a phone at
// standing or fence height) fits from the near baseline, service lines and
// sidelines alone.
//
// No model weights, no native code: plain TypeScript on a small frame
// (about 480 x 270), well under a second on a phone.
//
// Pure TypeScript, no React Native: tested in lib/__tests__/court.test.ts
// and lib/__tests__/courtFrames.test.ts (frames from a real court).

import {
  applyHomography,
  DOUBLES_HALF_WIDTH,
  HALF_LENGTH,
  homography,
  isCourtShape,
  polygonArea,
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
  /** Share of the court's painted lines on screen that land on paint in the frame, 0 to 1. */
  confidence: number;
}

/** Below this, detection doesn't count as a find (court.py's cut-off). */
export const MIN_FIT_SCORE = 0.35;

/** A straight painted line in normal form: x cos(theta) + y sin(theta) = rho. */
export interface Line {
  rho: number;
  theta: number;
  /** Paint pixels on the line. */
  votes: number;
  /** How yellow its paint is: about 0 for white, higher for yellow. */
  yellow: number;
}

const DEG = Math.PI / 180;
const DW = DOUBLES_HALF_WIDTH;
const SW = SINGLES_HALF_WIDTH;
const HL = HALF_LENGTH;
const SL = SERVICE_LINE;

/** A painted court line, in court meters. */
interface PaintLine {
  a: Point;
  b: Point;
}

/** Every painted line once: baselines (doubles width), service lines, centre service line, four sidelines. */
const PAINT: PaintLine[] = [
  { a: { x: -DW, y: -HL }, b: { x: DW, y: -HL } },
  { a: { x: -DW, y: HL }, b: { x: DW, y: HL } },
  { a: { x: -SW, y: -SL }, b: { x: SW, y: -SL } },
  { a: { x: -SW, y: SL }, b: { x: SW, y: SL } },
  { a: { x: 0, y: -SL }, b: { x: 0, y: SL } },
  { a: { x: -SW, y: -HL }, b: { x: -SW, y: HL } },
  { a: { x: SW, y: -HL }, b: { x: SW, y: HL } },
  { a: { x: -DW, y: -HL }, b: { x: -DW, y: HL } },
  { a: { x: DW, y: -HL }, b: { x: DW, y: HL } },
];
const DOUBLES_CORNERS_M: Point[] = [
  { x: -DW, y: -HL },
  { x: DW, y: -HL },
  { x: DW, y: HL },
  { x: -DW, y: HL },
];

// Lines a camera behind the baseline can see. Across: far to near. Along: left to right.
const ACROSS_M = [HL, SL, -SL, -HL];
const ALONG_M = [-DW, -SW, 0, SW, DW];

/**
 * A line this much yellower than the court's main lines is yellow paint, not
 * tennis paint. Measured against the frame's own strongest lines (the
 * baseline and sidelines), so warm evening light, which tints every white
 * line, doesn't count. On the Nov 8 court test's frames (at several sizes and
 * JPEG qualities) white lines measured -0.02 to 0.06 above that level and the
 * pale yellow pickleball lines 0.05 to 0.35. This keeps every white line; the
 * palest stretch of a yellow line can slip through, and the fit then turns it
 * down on shape (pickleball sidelines are 3.05 m from the centre, tennis
 * sidelines 4.115 and 5.485).
 */
export const YELLOW_MARGIN = 0.09;
/** Lines across the court lean less than this from level; lines along it, more than ALONG_MIN. */
const ACROSS_MAX = 22 * DEG;
const ALONG_MIN = 10 * DEG;
/** Candidates tried each way. */
const MAX_ACROSS = 6;
const MAX_ALONG = 8;
/** Coarse scoring keeps this many views for the fine pass. */
const KEEP = 10;
/** A painted pixel off the court's lines costs this much against one on them. */
const MISS_COST = 0.5;

// ---------------------------------------------------------------------------
// Paint

/** Separable running min or max over a k x k square. */
function rankFilter(src: Uint8Array, w: number, h: number, k: number, max: boolean): Uint8Array {
  const r = k >> 1;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = src[row + x];
      const lo = Math.max(0, x - r);
      const hi = Math.min(w - 1, x + r);
      for (let xx = lo; xx <= hi; xx++) {
        const u = src[row + xx];
        if (max ? u > v : u < v) v = u;
      }
      tmp[row + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    const lo = Math.max(0, y - r);
    const hi = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x];
      for (let yy = lo; yy <= hi; yy++) {
        const u = tmp[yy * w + x];
        if (max ? u > v : u < v) v = u;
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

interface Paint {
  /** 1 where there's a thin bright unsaturated mark. */
  mask: Uint8Array;
  width: number;
  height: number;
  /** The frame, RGBA. */
  data: Uint8Array | Uint8ClampedArray;
}

function findPaint(px: Pixels): Paint {
  const { width: w, height: h, data } = px;
  const n = w * h;
  const gray = new Uint8Array(n);
  const lowSat = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
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
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    mask[i] = gray[i] - opened[i] > 25 && lowSat[i] && gray[i] > 120 ? 1 : 0;
  }
  return { mask, width: w, height: h, data };
}

/**
 * How yellow the paint at one pixel of a line is: 0 for white, about 0.5 for
 * strong yellow. A thin line's pixel is part paint, part court, so the court
 * beside the line (3 and 4 pixels out on each side) is taken out first. Each
 * channel's rise toward full brightness is then the same for white paint on
 * any court colour, while blue rises less than red and green for yellow.
 */
function pixelYellow(paint: Paint, x: number, y: number, nx: number, ny: number): number {
  const { width: w, height: h, data } = paint;
  const back = [0, 0, 0];
  let n = 0;
  for (const d of [-4, -3, 3, 4]) {
    const xx = Math.round(x + nx * d);
    const yy = Math.round(y + ny * d);
    if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
    const j = (yy * w + xx) * 4;
    back[0] += data[j];
    back[1] += data[j + 1];
    back[2] += data[j + 2];
    n++;
  }
  if (!n) return 0;
  const j = (y * w + x) * 4;
  const rise = (c: number) => {
    const b = back[c] / n;
    return (data[j + c] - b) / (256 - b);
  };
  const r = rise(0);
  const g = rise(1);
  const b = rise(2);
  const rg = (r + g) / 2;
  return rg > 0.05 ? 1 - b / rg : 0;
}

/**
 * How yellow a line's paint is. Each side of the line is judged on its own
 * (the middle value of its pixels), and the whiter side counts: a white line
 * with a yellow one painted right beside it (a pickleball baseline by the
 * service line) found as one thick line stays white, while a yellow line is
 * yellow on both sides.
 */
function lineYellow(paint: Paint, xs: ArrayLike<number>, ys: ArrayLike<number>, idx: number[], rho: number, theta: number): number {
  const nx = Math.cos(theta);
  const ny = Math.sin(theta);
  const sides: number[][] = [[], []];
  for (const i of idx) {
    const side = xs[i] * nx + ys[i] * ny - rho < 0 ? 0 : 1;
    sides[side].push(pixelYellow(paint, xs[i], ys[i], nx, ny));
  }
  const middle = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1];
  const judged = sides.filter((v) => v.length >= 8).map(middle);
  return judged.length ? Math.min(...judged) : middle(sides[0].concat(sides[1]));
}

/** Thin bright marks: court paint, not sky or white clothing blobs (court.py line_mask). */
export function lineMask(px: Pixels): Uint8Array {
  return findPaint(px).mask;
}

// ---------------------------------------------------------------------------
// Lines

const THETA_STEPS = 360; // 0.5 degree
const VOTE_SPREAD = 8; // each pixel votes within 4 degrees of its own direction
const COS = new Float64Array(THETA_STEPS);
const SIN = new Float64Array(THETA_STEPS);
for (let t = 0; t < THETA_STEPS; t++) {
  COS[t] = Math.cos((t * Math.PI) / THETA_STEPS);
  SIN[t] = Math.sin((t * Math.PI) / THETA_STEPS);
}

/** Paint pixels that sit on a line: a clear single direction in a 9 x 9 window. */
interface Stroke {
  x: Int16Array;
  y: Int16Array;
  /** Normal direction, in Hough steps. */
  t: Int16Array;
  count: number;
}

function strokes(mask: Uint8Array, w: number, h: number): Stroke {
  const r = 4;
  const xs: number[] = [];
  const ys: number[] = [];
  const ts: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      let n = 0;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || !mask[yy * w + xx]) continue;
          n++;
          sx += dx;
          sy += dy;
          sxx += dx * dx;
          syy += dy * dy;
          sxy += dx * dy;
        }
      }
      if (n < 4) continue;
      const cxx = sxx / n - (sx / n) ** 2;
      const cyy = syy / n - (sy / n) ** 2;
      const cxy = sxy / n - (sx / n) * (sy / n);
      const tr = cxx + cyy;
      if (tr <= 0) continue;
      const coherence = Math.sqrt((cxx - cyy) ** 2 + 4 * cxy * cxy) / tr;
      // A line is long one way and thin the other; a blotch is neither.
      if (coherence < 0.6) continue;
      const along = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
      let normal = along + Math.PI / 2;
      normal = ((normal % Math.PI) + Math.PI) % Math.PI;
      xs.push(x);
      ys.push(y);
      ts.push(Math.round((normal / Math.PI) * THETA_STEPS) % THETA_STEPS);
    }
  }
  return { x: Int16Array.from(xs), y: Int16Array.from(ys), t: Int16Array.from(ts), count: xs.length };
}

/** Distance in Hough steps between two directions, wrapping at 180 degrees. */
function stepGap(a: number, b: number): number {
  const d = Math.abs(a - b) % THETA_STEPS;
  return Math.min(d, THETA_STEPS - d);
}

/** Total least squares line through points, in normal form. */
function fitLine(px: ArrayLike<number>, py: ArrayLike<number>, idx: number[]): { rho: number; theta: number } | null {
  const n = idx.length;
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  for (const i of idx) {
    mx += px[i];
    my += py[i];
  }
  mx /= n;
  my /= n;
  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (const i of idx) {
    const dx = px[i] - mx;
    const dy = py[i] - my;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  const along = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  let theta = along + Math.PI / 2;
  theta = ((theta % Math.PI) + Math.PI) % Math.PI;
  return { theta, rho: mx * Math.cos(theta) + my * Math.sin(theta) };
}

interface FoundLine extends Line {
  /** Ends of its paint, along the line. */
  from: Point;
  to: Point;
  /** Its paint pixels, as indexes into the frame (y * width + x). */
  pixels: number[];
}

function lineEnds(line: { rho: number; theta: number }, s: Stroke, idx: number[]): { from: Point; to: Point } {
  const c = Math.cos(line.theta);
  const sn = Math.sin(line.theta);
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of idx) {
    const t = -s.x[i] * sn + s.y[i] * c;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  const at = (t: number) => ({ x: line.rho * c - t * sn, y: line.rho * sn + t * c });
  return { from: at(lo), to: at(hi) };
}

function distanceTo(line: { rho: number; theta: number }, p: Point): number {
  return Math.abs(p.x * Math.cos(line.theta) + p.y * Math.sin(line.theta) - line.rho);
}

/**
 * Long straight lines in the paint, strongest first, each painted line once.
 * Found one at a time: the strongest line's pixels are taken out before
 * looking for the next, so a thick line can't come back as its own twin.
 */
function findLines(paint: Paint, w: number, h: number, minVotes: number, maxLines = 24): FoundLine[] {
  const s = strokes(paint.mask, w, h);
  const diag = Math.ceil(Math.hypot(w, h));
  const rhoSize = diag * 2 + 1;
  const acc = new Int32Array(THETA_STEPS * rhoSize);
  const vote = (i: number, sign: number) => {
    const x = s.x[i];
    const y = s.y[i];
    for (let d = -VOTE_SPREAD; d <= VOTE_SPREAD; d++) {
      let t = s.t[i] + d;
      let flip = 1;
      if (t < 0) {
        t += THETA_STEPS;
        flip = -1;
      } else if (t >= THETA_STEPS) {
        t -= THETA_STEPS;
        flip = -1;
      }
      // Past 180 degrees the same line has the opposite rho.
      const rho = Math.round(flip * (x * COS[t] + y * SIN[t])) + diag;
      acc[t * rhoSize + rho] += sign;
    }
  };
  for (let i = 0; i < s.count; i++) vote(i, 1);
  const used = new Uint8Array(s.count);

  const lines: FoundLine[] = [];
  for (let round = 0; round < maxLines * 2 && lines.length < maxLines; round++) {
    let best = 0;
    let bestCell = -1;
    for (let c = 0; c < acc.length; c++) {
      if (acc[c] > best) {
        best = acc[c];
        bestCell = c;
      }
    }
    if (best < minVotes) break;
    const t0 = Math.floor(bestCell / rhoSize);
    const peak = { theta: (t0 * Math.PI) / THETA_STEPS, rho: (bestCell % rhoSize) - diag };
    const near = (line: { rho: number; theta: number }, tol: number) => {
      const tStep = Math.round((line.theta / Math.PI) * THETA_STEPS) % THETA_STEPS;
      const out: number[] = [];
      const c = Math.cos(line.theta);
      const sn = Math.sin(line.theta);
      for (let i = 0; i < s.count; i++) {
        if (used[i] || stepGap(s.t[i], tStep) > VOTE_SPREAD + 2) continue;
        if (Math.abs(s.x[i] * c + s.y[i] * sn - line.rho) <= tol) out.push(i);
      }
      return out;
    };
    const first = near(peak, 2);
    const refined = fitLine(s.x, s.y, first) ?? peak;
    const support = near(refined, 2);
    // Take out everything the peak was made of, so the search always moves on.
    const taken = new Set([...first, ...support]);
    for (const i of taken) {
      vote(i, -1);
      used[i] = 1;
    }
    if (support.length < minVotes) continue;
    const line = fitLine(s.x, s.y, support) ?? refined;
    const yellow = lineYellow(paint, s.x, s.y, support, line.rho, line.theta);
    const ends = lineEnds(line, s, support);
    // A leftover sliver of a line already found joins it.
    const twin = lines.find(
      (l) =>
        stepGap(Math.round((l.theta / Math.PI) * THETA_STEPS), Math.round((line.theta / Math.PI) * THETA_STEPS)) <= 6 &&
        distanceTo(l, ends.from) < 3.5 &&
        distanceTo(l, ends.to) < 3.5,
    );
    if (twin) {
      twin.votes += support.length;
      for (const i of support) twin.pixels.push(s.y[i] * w + s.x[i]);
      continue;
    }
    lines.push({
      rho: line.rho,
      theta: line.theta,
      votes: support.length,
      yellow,
      ...ends,
      pixels: support.map((i) => s.y[i] * w + s.x[i]),
    });
  }
  return lines.sort((a, b) => b.votes - a.votes);
}

/** Paint pixels a line needs to be a candidate for the fit. */
const minLine = (w: number, h: number) => Math.min(w, h) * 0.12;
/** ...and to count as paint when scoring a view (the centre service line is short). */
const minScoreLine = (w: number, h: number) => Math.min(w, h) * 0.07;

/** How yellow white paint looks in this frame: the middle of its three strongest lines. */
export function whiteLevel(lines: readonly Line[]): number {
  const top = [...lines]
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 3)
    .map((l) => l.yellow)
    .sort((a, b) => a - b);
  return top.length ? top[(top.length - 1) >> 1] : 0;
}

/** Long straight lines in the mask, strongest first, each painted line once. */
export function houghLines(px: Pixels): Line[] {
  const paint = findPaint(px);
  return findLines(paint, px.width, px.height, minLine(px.width, px.height)).map(({ rho, theta, votes, yellow }) => ({ rho, theta, votes, yellow }));
}

// ---------------------------------------------------------------------------
// Views

function intersect(a: { rho: number; theta: number }, b: { rho: number; theta: number }): Point | null {
  const c1 = Math.cos(a.theta);
  const s1 = Math.sin(a.theta);
  const c2 = Math.cos(b.theta);
  const s2 = Math.sin(b.theta);
  const det = c1 * s2 - s1 * c2;
  if (Math.abs(det) < 1e-6) return null;
  return { x: (a.rho * s2 - s1 * b.rho) / det, y: (c1 * b.rho - a.rho * c2) / det };
}

function pairs<T>(items: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) out.push([items[i], items[j]]);
  return out;
}

/** a then b, as 3 x 3 row-major matrices. */
function compose(a: Homography, b: Homography): Homography {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

/** True when four points, in order, make a convex shape with no corner folded flat. */
function convex(q: readonly Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i];
    const a = q[(i + 1) % 4];
    const b = q[(i + 2) % 4];
    const cross = (a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x);
    const scale = Math.hypot(a.x - p.x, a.y - p.y) * Math.hypot(b.x - a.x, b.y - a.y);
    if (!(Math.abs(cross) > 0.02 * scale)) return false; // a corner nearly flat, or NaN
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** A phone camera's focal length, as a share of the frame's width: from about 120 degrees across (ultra wide) to about 20 (telephoto). */
const FOCAL_RANGE = { min: 0.3, max: 3 } as const;

/**
 * True when a real camera could take this view: one with square pixels,
 * centred, and a focal length a phone has. A view that crushes the far court
 * into a sliver above the net needs a lens wider than any phone's, or a
 * court whose sides aren't square, so it's thrown out here.
 */
function cameraCanSee(hm: Homography, w: number, h: number): boolean {
  // Columns of the view for the court's x and y directions, around the frame's centre.
  const col = (c: number) => {
    const g = hm[6 + c];
    return [hm[c] - (w / 2) * g, hm[3 + c] - (h / 2) * g, g];
  };
  const [a1, b1, c1] = col(0);
  const [a2, b2, c2] = col(1);
  // The two directions are square to each other and equally long once the
  // focal length f is taken out: solve for 1/f^2 by least squares.
  const A1 = a1 * a2 + b1 * b2;
  const B1 = c1 * c2;
  const A2 = a1 * a1 + b1 * b1 - a2 * a2 - b2 * b2;
  const B2 = c1 * c1 - c2 * c2;
  const den = A1 * A1 + A2 * A2;
  if (!(den > 0)) return false;
  const u = -(A1 * B1 + A2 * B2) / den;
  if (!(u > 0)) return false;
  const f = 1 / Math.sqrt(u);
  if (f < FOCAL_RANGE.min * w || f > FOCAL_RANGE.max * w) return false;
  const r1 = [a1 / f, b1 / f, c1];
  const r2 = [a2 / f, b2 / f, c2];
  const n1 = Math.hypot(r1[0], r1[1], r1[2]);
  const n2 = Math.hypot(r2[0], r2[1], r2[2]);
  const cos = (r1[0] * r2[0] + r1[1] * r2[1] + r1[2] * r2[2]) / (n1 * n2);
  const ratio = n1 / n2;
  return Math.abs(cos) < 0.25 && ratio > 0.8 && ratio < 1.25;
}

/**
 * True when a view can be a camera behind the near baseline. Rejects the
 * degenerate fits a straight search over line pairs throws up: the court
 * passing behind the camera, corners landing on each other, crossed or
 * inside-out shapes, a far baseline wider than the near one, a tiny court,
 * or a view no phone camera could take.
 */
export function plausibleView(hm: Homography, w: number, h: number): boolean {
  // The whole court in front of the camera: no sign change in the projective divisor.
  let sign = 0;
  for (const p of DOUBLES_CORNERS_M) {
    const d = hm[6] * p.x + hm[7] * p.y + hm[8];
    if (!Number.isFinite(d) || Math.abs(d) < 1e-9) return false;
    const s = Math.sign(d);
    if (sign && s !== sign) return false;
    sign = s;
  }
  const quad = SINGLES_CORNERS_M.map((p) => applyHomography(hm, p));
  if (quad.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  const [nl, nr, fr, fl] = quad;
  // Behind-the-baseline view: far baseline above the near one, left stays left.
  if (!(fl.y < nl.y && fr.y < nr.y && nl.x < nr.x && fl.x < fr.x)) return false;
  // Seen from behind, the far baseline is the shorter one.
  if (fr.x - fl.x > (nr.x - nl.x) * 1.02) return false;
  // Four distinct corners.
  const minGap = 0.02 * w;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (Math.hypot(quad[i].x - quad[j].x, quad[i].y - quad[j].y) < minGap) return false;
    }
  }
  if (!convex(quad)) return false;
  const area = polygonArea(quad);
  if (area < 0.03 * w * h || area > 4 * w * h) return false;
  // The near corners can be off the frame, but not wildly.
  if (nl.y > 3 * h || nr.y > 3 * h || nl.x < -3 * w || nr.x > 4 * w) return false;
  // The far half has to be on screen; the near baseline may be cut off.
  const farX = (fl.x + fr.x) / 2;
  const farY = (fl.y + fr.y) / 2;
  if (!(farY > -0.1 * h && farY < 0.9 * h && farX > -0.2 * w && farX < 1.2 * w)) return false;
  return cameraCanSee(hm, w, h);
}

/** The part of segment p-q inside the frame, as a range of t from 0 to 1, or null. */
function clip(p: Point, q: Point, w: number, h: number): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const edges: [number, number][] = [
    [-dx, p.x],
    [dx, w - 1 - p.x],
    [-dy, p.y],
    [dy, h - 1 - p.y],
  ];
  for (const [a, b] of edges) {
    if (a === 0) {
      if (b < 0) return null;
      continue;
    }
    const r = b / a;
    if (a < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return t1 > t0 ? [t0, t1] : null;
}

interface Score {
  hits: number;
  visible: number;
}

/**
 * Walks every painted court line as it falls on screen, a sample every
 * `step` pixels, and counts the samples that land on paint. Lines that
 * collapse to a point or fall off the frame add no samples, so they can't
 * prop up a bad view.
 */
function scoreView(hm: Homography, onPaint: Uint8Array, w: number, h: number, step: number): Score {
  let hits = 0;
  let visible = 0;
  for (const seg of PAINT) {
    const p = applyHomography(hm, seg.a);
    const q = applyHomography(hm, seg.b);
    const range = clip(p, q, w, h);
    if (!range) continue;
    const len = Math.hypot(q.x - p.x, q.y - p.y) * (range[1] - range[0]);
    const n = Math.max(1, Math.floor(len / step));
    for (let i = 0; i <= n; i++) {
      const t = range[0] + ((range[1] - range[0]) * i) / n;
      const x = (p.x + (q.x - p.x) * t) | 0;
      const y = (p.y + (q.y - p.y) * t) | 0;
      visible++;
      if (onPaint[y * w + x]) hits++;
    }
  }
  return { hits, visible };
}

const rank = (s: Score) => s.hits - MISS_COST * (s.visible - s.hits);

/**
 * Least-squares view (court meters to pixels) that puts each model line on its
 * matched image line. Each equation is divided by the view's depth at its
 * point, from the last estimate (starting at `start`), so the error is in
 * pixels and far lines count as much as near ones.
 */
function fitToLines(matches: { line: { rho: number; theta: number }; points: Point[] }[], w: number, start: Homography): Homography | null {
  // Unknowns h0..h7 (h8 = 1), on court meters / 10 and pixels / w so the numbers stay even.
  const toN: Homography = [1 / w, 0, 0, 0, 1 / w, 0, 0, 0, 1];
  const fromN: Homography = [10, 0, 0, 0, 10, 0, 0, 0, 1];
  let hm = start;
  for (let pass = 0; pass < 3; pass++) {
    const prior = compose(compose(toN, hm), fromN);
    const g = [prior[6] / prior[8], prior[7] / prior[8]];
    const ata = Array.from({ length: 8 }, () => new Array<number>(9).fill(0));
    let rows = 0;
    for (const { line, points } of matches) {
      const a = Math.cos(line.theta);
      const b = Math.sin(line.theta);
      const c = -line.rho / w;
      for (const p of points) {
        const X = p.x / 10;
        const Y = p.y / 10;
        const k = 1 / Math.max(Math.abs(g[0] * X + g[1] * Y + 1), 1e-6);
        // (a, b, c) . H (X, Y, 1) = 0, over the depth at (X, Y)
        const row = [k * a * X, k * a * Y, k * a, k * b * X, k * b * Y, k * b, k * c * X, k * c * Y];
        const rhs = -k * c;
        for (let i = 0; i < 8; i++) {
          for (let j = 0; j < 8; j++) ata[i][j] += row[i] * row[j];
          ata[i][8] += row[i] * rhs;
        }
        rows++;
      }
    }
    if (rows < 8) return null;
    for (let col = 0; col < 8; col++) {
      let pivot = col;
      for (let r = col + 1; r < 8; r++) if (Math.abs(ata[r][col]) > Math.abs(ata[pivot][col])) pivot = r;
      if (Math.abs(ata[pivot][col]) < 1e-12) return null;
      if (pivot !== col) [ata[pivot], ata[col]] = [ata[col], ata[pivot]];
      for (let r = 0; r < 8; r++) {
        if (r === col) continue;
        const f = ata[r][col] / ata[col][col];
        if (f === 0) continue;
        for (let c = col; c <= 8; c++) ata[r][c] -= f * ata[col][c];
      }
    }
    const hn = ata.map((row, i) => row[8] / row[i]);
    if (hn.some((v) => !Number.isFinite(v))) return null;
    // Undo the scaling: H = diag(w, w, 1) . Hn . diag(1/10, 1/10, 1).
    hm = compose(compose([w, 0, 0, 0, w, 0, 0, 0, 1], [...hn, 1]), [0.1, 0, 0, 0, 0.1, 0, 0, 0, 1]);
  }
  return hm;
}

/**
 * Pulls a view onto the paint it explains: each court line on screen is
 * matched to the paint pixels within `band` of it, a straight line is fitted
 * through them, and the view is re-solved to put every court line on its
 * fitted line.
 */
function refineView(hm: Homography, mask: Uint8Array, w: number, h: number, band: number): Homography | null {
  const matches: { line: { rho: number; theta: number }; points: Point[] }[] = [];
  const seen = new Int32Array(w * h);
  let stamp = 0;
  for (const seg of PAINT) {
    const p = applyHomography(hm, seg.a);
    const q = applyHomography(hm, seg.b);
    const range = clip(p, q, w, h);
    if (!range) continue;
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const visibleLen = len * (range[1] - range[0]);
    if (visibleLen < 15) continue;
    const ux = (q.x - p.x) / len;
    const uy = (q.y - p.y) / len;
    stamp++;
    const xs: number[] = [];
    const ys: number[] = [];
    let tMin = Infinity;
    let tMax = -Infinity;
    for (let d = range[0] * len; d <= range[1] * len; d += 1) {
      for (let o = -band; o <= band; o += 0.5) {
        const x = Math.round(p.x + ux * d - uy * o);
        const y = Math.round(p.y + uy * d + ux * o);
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        const k = y * w + x;
        if (!mask[k] || seen[k] === stamp) continue;
        seen[k] = stamp;
        xs.push(x);
        ys.push(y);
        if (d < tMin) tMin = d;
        if (d > tMax) tMax = d;
      }
    }
    // Enough paint, spread along enough of the line, to trust the fit.
    if (xs.length < 12 || tMax - tMin < Math.min(40, visibleLen * 0.4)) continue;
    const idx = xs.map((_, i) => i);
    const line = fitLine(xs, ys, idx);
    if (!line) continue;
    // Court points where the paint was found.
    const inv = invert(hm);
    if (!inv) return null;
    const ends = [tMin, (tMin + tMax) / 2, tMax].map((d) => applyHomography(inv, { x: p.x + ux * d, y: p.y + uy * d }));
    // Snap them onto the model line, so only the image side moves.
    const points = ends.map((e) => {
      const ax = seg.b.x - seg.a.x;
      const ay = seg.b.y - seg.a.y;
      const t = ((e.x - seg.a.x) * ax + (e.y - seg.a.y) * ay) / (ax * ax + ay * ay);
      return { x: seg.a.x + ax * t, y: seg.a.y + ay * t };
    });
    matches.push({ line, points });
  }
  // Needs two lines each way to pin the view.
  const across = matches.filter((m) => m.points[0].y === m.points[2].y).length;
  if (across < 2 || matches.length - across < 2) return null;
  return fitToLines(matches, w, hm);
}

function invert(m: Homography): Homography | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  return [
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det,
  ];
}

const UNIT_SQUARE: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/**
 * Finds the court in one frame. Returns the best fit, or null when nothing
 * fits at all. A fit with a low confidence is still returned, so the
 * court-line fix can start its handles from it; a fit whose corners can't be
 * a court always comes back with a confidence of 0.
 */
export function detectCourt(px: Pixels): CourtFit | null {
  const { width: w, height: h } = px;
  const paint = findPaint(px);
  const found = findLines(paint, w, h, minScoreLine(w, h));

  // Only straight white lines count as court paint, for the search and the
  // score: not yellow lines, and not the scatter of bright bits in a net,
  // fence or trees that lies on no line.
  const white = whiteLevel(found.filter((l) => l.votes >= minLine(w, h)));
  const isYellow = (l: Line) => l.yellow > white + YELLOW_MARGIN;
  const onCourt = new Uint8Array(w * h);
  for (const l of found) {
    if (isYellow(l)) continue;
    for (const k of l.pixels) onCourt[k] = 1;
  }
  const lines = found.filter((l) => !isYellow(l) && l.votes >= minLine(w, h));
  const tilt = (l: Line) => Math.abs(l.theta - Math.PI / 2);
  const across = lines.filter((l) => tilt(l) < ACROSS_MAX).slice(0, MAX_ACROSS);
  const along = lines.filter((l) => tilt(l) > ALONG_MIN).slice(0, MAX_ALONG);
  if (across.length < 2 || along.length < 2) return null;
  const near1 = rankFilter(onCourt, w, h, 3, true);
  const near2 = rankFilter(onCourt, w, h, 5, true);

  const yAtCenter = (l: Line) => (l.rho - (w / 2) * Math.cos(l.theta)) / Math.sin(l.theta);
  const acrossModel = pairs(ACROSS_M); // [far, near]
  const alongModel = pairs(ALONG_M); // [left, right]

  // Coarse pass: every pairing, a sample every 6 pixels.
  const kept: { hm: Homography; rank: number }[] = [];
  for (const [a, b] of pairs(across)) {
    const [upper, lower] = yAtCenter(a) < yAtCenter(b) ? [a, b] : [b, a];
    for (const [c, d] of pairs(along)) {
      if (c === upper || c === lower || d === upper || d === lower) continue;
      const lc = intersect(lower, c);
      const ld = intersect(lower, d);
      if (!lc || !ld) continue;
      const [left, right] = lc.x < ld.x ? [c, d] : [d, c];
      const img = [intersect(lower, left), intersect(lower, right), intersect(upper, right), intersect(upper, left)];
      if (img.some((p) => p === null)) continue;
      const [p0, p1, p2, p3] = img as Point[];
      // Far side above the near side, shorter than it, and a proper shape.
      if (!(p3.y < p0.y && p2.y < p1.y && p0.x < p1.x && p3.x < p2.x)) continue;
      if (p2.x - p3.x > (p1.x - p0.x) * 1.02) continue;
      if (!convex(img as Point[])) continue;
      const square = homography(UNIT_SQUARE, img as Point[]);
      if (!square) continue;
      for (const [yFar, yNear] of acrossModel) {
        for (const [xLeft, xRight] of alongModel) {
          const dx = xRight - xLeft;
          const dy = yFar - yNear;
          const hm = compose(square, [1 / dx, 0, -xLeft / dx, 0, 1 / dy, -yNear / dy, 0, 0, 1]);
          if (!plausibleView(hm, w, h)) continue;
          const r = rank(scoreView(hm, near2, w, h, 6));
          if (kept.length < KEEP || r > kept[kept.length - 1].rank) {
            kept.push({ hm, rank: r });
            kept.sort((x, y) => y.rank - x.rank);
            if (kept.length > KEEP) kept.pop();
          }
        }
      }
    }
  }
  if (!kept.length) return null;

  // Fine pass: refine the best few onto the paint, score every 2 pixels.
  let best: { hm: Homography; rank: number } | null = null;
  for (const k of kept) {
    let hm = k.hm;
    let r = rank(scoreView(hm, near1, w, h, 2));
    for (const band of [4, 2]) {
      const next = refineView(hm, onCourt, w, h, band);
      if (!next || !plausibleView(next, w, h)) break;
      const nr = rank(scoreView(next, near1, w, h, 2));
      if (nr < r) break;
      hm = next;
      r = nr;
    }
    if (!best || r > best.rank) best = { hm, rank: r };
  }
  if (!best) return null;

  const { hits, visible } = scoreView(best.hm, near2, w, h, 2);
  // A court in view shows well over a frame's width of line; less than that is too little to trust.
  const coverage = Math.min(1, visible / (0.75 * w));
  const corners = SINGLES_CORNERS_M.map((p) => {
    const q = applyHomography(best.hm, p);
    return { x: q.x / w, y: q.y / h };
  }) as Corners;
  const confidence = isCourtShape(corners) && visible > 0 ? (hits / visible) * coverage : 0;
  return { corners, confidence: Math.round(confidence * 1000) / 1000 };
}

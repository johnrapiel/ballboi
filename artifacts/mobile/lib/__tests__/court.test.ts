import { decode, encode } from "jpeg-js";
import { describe, expect, it } from "vitest";

import { analysisSize, videoAspectCrop } from "@/lib/court/still";
import {
  calibrationFromFit,
  CONFIDENT_FIT,
  needsCourtFix,
  nudgeCorner,
  sessionMetadata,
  toCalibration,
} from "@/lib/court/calibration";
import { detectCourt, type Pixels } from "@/lib/court/detect";
import {
  applyHomography,
  CALIBRATION_POINT_ORDER,
  courtLinesInImage,
  courtToImage,
  DEFAULT_CORNERS,
  homography,
  isCourtShape,
  SCORE_LINES_M,
  type Corners,
  type Point,
} from "@/lib/court/geometry";

const W = 480;
const H = 270;

/** A view from behind the near baseline, in normalized image points. */
const VIEW: Corners = [
  { x: 0.1, y: 0.93 },
  { x: 0.9, y: 0.93 },
  { x: 0.63, y: 0.3 },
  { x: 0.37, y: 0.3 },
];

/** Paints a court seen through `corners` on a blue-green hard court, with a sky band and two "players". */
function renderCourt(corners: Corners, opts: { lineWidth?: number; players?: boolean } = {}): Pixels {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const sky = y < H * 0.2;
      data[i] = sky ? 150 : 46;
      data[i + 1] = sky ? 180 : 94;
      data[i + 2] = sky ? 210 : 99;
      data[i + 3] = 255;
    }
  }
  const h = courtToImage(corners)!;
  const half = (opts.lineWidth ?? 2.4) / 2;
  for (const [a, b] of SCORE_LINES_M) {
    const p = applyHomography(h, a);
    const q = applyHomography(h, b);
    const p0 = { x: p.x * W, y: p.y * H };
    const q0 = { x: q.x * W, y: q.y * H };
    const len = Math.hypot(q0.x - p0.x, q0.y - p0.y);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = ((x - p0.x) * (q0.x - p0.x) + (y - p0.y) * (q0.y - p0.y)) / (len * len);
        if (t < 0 || t > 1) continue;
        const d = Math.abs((q0.y - p0.y) * x - (q0.x - p0.x) * y + q0.x * p0.y - q0.y * p0.x) / len;
        if (d > half) continue;
        const i = (y * W + x) * 4;
        data[i] = 233;
        data[i + 1] = 228;
        data[i + 2] = 214;
      }
    }
  }
  if (opts.players) {
    // Two dark, solid figures standing over lines.
    for (const [cx, cy] of [[W * 0.5, H * 0.32], [W * 0.45, H * 0.85]] as const) {
      for (let y = Math.round(cy - 28); y < cy + 4; y++) {
        for (let x = Math.round(cx - 7); x < cx + 7; x++) {
          const i = (y * W + x) * 4;
          data[i] = 30;
          data[i + 1] = 30;
          data[i + 2] = 60;
        }
      }
    }
  }
  return { width: W, height: H, data };
}

function maxCornerError(a: readonly Point[], b: readonly Point[]): number {
  return Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, (p.y - b[i].y) * (H / W))));
}

describe("homography", () => {
  it("maps the four source points onto the four targets", () => {
    const src = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const dst = [{ x: 10, y: 20 }, { x: 40, y: 22 }, { x: 35, y: 60 }, { x: 5, y: 55 }];
    const h = homography(src, dst)!;
    src.forEach((p, i) => {
      const q = applyHomography(h, p);
      expect(q.x).toBeCloseTo(dst[i].x, 6);
      expect(q.y).toBeCloseTo(dst[i].y, 6);
    });
  });

  it("gives up on points in a line", () => {
    const line = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
    expect(homography(line, line)).toBeNull();
  });

  it("draws the singles court through the corners", () => {
    const lines = courtLinesInImage(VIEW);
    expect(lines).toHaveLength(8);
    // Near baseline runs corner to corner.
    expect(lines[0][0].x).toBeCloseTo(VIEW[0].x, 6);
    expect(lines[0][1].y).toBeCloseTo(VIEW[1].y, 6);
  });
});

describe("isCourtShape", () => {
  it("takes a view from behind the baseline", () => {
    expect(isCourtShape(VIEW)).toBe(true);
    expect(isCourtShape(DEFAULT_CORNERS)).toBe(true);
  });

  it("refuses crossed, flipped, tiny or partial shapes", () => {
    const crossed = [VIEW[0], VIEW[1], VIEW[3], VIEW[2]];
    const upsideDown = VIEW.map((p) => ({ x: p.x, y: 1 - p.y }));
    const tiny = VIEW.map((p) => ({ x: 0.5 + (p.x - 0.5) * 0.05, y: 0.5 + (p.y - 0.5) * 0.05 }));
    expect(isCourtShape(crossed)).toBe(false);
    expect(isCourtShape(upsideDown)).toBe(false);
    expect(isCourtShape(tiny)).toBe(false);
    expect(isCourtShape(VIEW.slice(0, 3))).toBe(false);
    expect(isCourtShape([{ x: NaN, y: 0 }, VIEW[1], VIEW[2], VIEW[3]])).toBe(false);
  });
});

describe("detectCourt", () => {
  it("finds the corners of a clean court", () => {
    const fit = detectCourt(renderCourt(VIEW));
    expect(fit).not.toBeNull();
    expect(maxCornerError(fit!.corners, VIEW)).toBeLessThan(0.02);
    expect(fit!.confidence).toBeGreaterThanOrEqual(CONFIDENT_FIT);
    expect(needsCourtFix(fit)).toBe(false);
  });

  it("still finds them with players over the lines, through JPEG compression", () => {
    const px = renderCourt(VIEW, { players: true });
    const jpeg = encode({ width: W, height: H, data: px.data }, 70);
    const back = decode(jpeg.data, { useTArray: true });
    const fit = detectCourt({ width: back.width, height: back.height, data: back.data });
    expect(fit).not.toBeNull();
    expect(maxCornerError(fit!.corners, VIEW)).toBeLessThan(0.03);
  });

  it("finds a court whose near baseline is cut off by the frame", () => {
    const low: Corners = [
      { x: 0.02, y: 1.08 },
      { x: 0.98, y: 1.08 },
      { x: 0.66, y: 0.26 },
      { x: 0.34, y: 0.26 },
    ];
    const fit = detectCourt(renderCourt(low));
    expect(fit).not.toBeNull();
    expect(maxCornerError(fit!.corners, low)).toBeLessThan(0.04);
  });

  it("returns nothing on a frame with no court", () => {
    const blank = renderCourt(VIEW);
    for (let i = 0; i < blank.data.length; i += 4) {
      blank.data[i] = 46;
      blank.data[i + 1] = 94;
      blank.data[i + 2] = 99;
    }
    expect(detectCourt(blank)).toBeNull();
    expect(needsCourtFix(null)).toBe(true);
  });

  it("runs fast enough for a phone", () => {
    const px = renderCourt(VIEW, { players: true });
    const start = Date.now();
    detectCourt(px);
    // Node on a laptop; a phone's Hermes is a few times slower.
    expect(Date.now() - start).toBeLessThan(1500);
  });
});

describe("calibration", () => {
  it("is in the shape the API checks", () => {
    const cal = toCalibration(VIEW, "phone-fixed")!;
    expect(cal.pointOrder).toEqual(CALIBRATION_POINT_ORDER);
    expect(cal.points).toHaveLength(4);
    expect(cal.source).toBe("phone-fixed");
    expect(cal).not.toHaveProperty("confidence");
  });

  it("sends a confident find, and holds back a weak one for the fix", () => {
    expect(calibrationFromFit({ corners: VIEW, confidence: 0.8 })?.source).toBe("phone-detected");
    expect(calibrationFromFit({ corners: VIEW, confidence: 0.4 })).toBeNull();
    expect(needsCourtFix({ corners: VIEW, confidence: 0.4 })).toBe(true);
  });

  it("goes into the session's metadata only when there is one", () => {
    const cal = toCalibration(VIEW, "phone-detected", 0.8)!;
    expect(sessionMetadata(cal)).toEqual({ source: "ios", courtCalibration: cal });
    expect(sessionMetadata(null)).toEqual({ source: "ios" });
  });

  it("refuses corners that can't be a court", () => {
    expect(toCalibration([VIEW[0], VIEW[1], VIEW[3], VIEW[2]], "phone-fixed")).toBeNull();
  });

  it("nudges one corner a step, and keeps it near the frame", () => {
    const moved = nudgeCorner(VIEW, 2, "up");
    expect(moved[2].y).toBeCloseTo(VIEW[2].y - 0.01, 6);
    expect(moved[0]).toEqual(VIEW[0]);
    let far = VIEW;
    for (let i = 0; i < 200; i++) far = nudgeCorner(far, 0, "left");
    expect(far[0].x).toBeCloseTo(-0.15, 6);
  });
});

describe("still frame", () => {
  it("crops a 4:3 still to the video's 16:9 view", () => {
    expect(videoAspectCrop(4032, 3024)).toEqual({ originX: 0, originY: 378, width: 4032, height: 2268 });
    expect(videoAspectCrop(3024, 4032)).toEqual({ originX: 378, originY: 0, width: 2268, height: 4032 });
    expect(videoAspectCrop(1280, 720)).toBeNull();
  });

  it("analyses at 480 on the long side", () => {
    expect(analysisSize(1280, 720)).toEqual({ width: 480, height: 270 });
    expect(analysisSize(720, 1280)).toEqual({ width: 270, height: 480 });
  });
});

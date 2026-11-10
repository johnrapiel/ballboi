// Court detection and the voice coach on a real court: John's first court
// test (Nov 8). Green hard court, white tennis lines with pale yellow
// pickleball lines over them, seen from behind the near baseline with the far
// baseline hidden behind the net, people on court. Before this fix every
// frame gave a confident nonsense fit and the coach's step flipped every
// second. Frames and hand-labeled corners: lib/__tests__/fixtures/court-frames.

import { decode } from "jpeg-js";
import { describe, expect, it } from "vitest";

import {
  agreedStep,
  aimStep,
  frameStep,
  lockable,
  nextLock,
  nextStepRun,
  startSearch,
  STEP_RUN_START,
  type AimStep,
} from "@/lib/court/aim";
import { CONFIDENT_FIT } from "@/lib/court/calibration";
import { COACH_START, nextCoachCue } from "@/lib/court/coach";
import {
  detectCourt,
  houghLines,
  isPaint,
  lineMask,
  plausibleView,
  RETRY_BELOW,
  whiteLevel,
  YELLOW_MARGIN,
  type Line,
  type Pixels,
} from "@/lib/court/detect";
import { homography, isCourtShape, SINGLES_CORNERS_M, type Corners, type Point } from "@/lib/court/geometry";
import { uprightTurn } from "@/lib/court/still";
import LABELS from "./fixtures/court-frames/corners.json";

// Node's fs, without pulling Node's types into the app's TypeScript.
// @ts-ignore -- node:fs has no types in the React Native project; vitest runs in Node.
const fs: { readFileSync(p: string): Uint8Array } = await import("node:fs");
const DIR = `${process.cwd()}/lib/__tests__/fixtures/court-frames`;

const VIDEO = ["video-01", "video-02", "video-03", "video-04", "video-05", "video-06", "video-07", "video-08", "video-09", "video-10"];
const FRAMES = ["still-1", "still-2", ...VIDEO];

function load(name: string): Pixels {
  const img = decode(fs.readFileSync(`${DIR}/${name}.jpg`), { useTArray: true, formatAsRGBA: true });
  return { width: img.width, height: img.height, data: img.data };
}

const labeled = (name: string): Corners =>
  (LABELS as Record<string, number[][]>)[name].map(([x, y]) => ({ x, y })) as Corners;

/** Largest corner miss, as a share of the frame's width (down is scaled to match). */
function cornerError(a: readonly Point[], b: readonly Point[], aspect = 9 / 16): number {
  return Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, (p.y - b[i].y) * aspect)));
}

/** A quarter turn, clockwise or not: how a still looks if it isn't turned upright. */
function quarterTurn(px: Pixels, clockwise: boolean): Pixels {
  const { width: w, height: h, data } = px;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = clockwise ? h - 1 - y : y;
      const ny = clockwise ? x : w - 1 - x;
      const i = (y * w + x) * 4;
      const j = (ny * h + nx) * 4;
      out[j] = data[i];
      out[j + 1] = data[i + 1];
      out[j + 2] = data[i + 2];
      out[j + 3] = 255;
    }
  }
  return { width: h, height: w, data: out };
}

const frames = new Map(FRAMES.map((n) => [n, load(n)]));
const fits = new Map(FRAMES.map((n) => [n, detectCourt(frames.get(n)!)]));

describe("court detection on a real court", () => {
  it.each(FRAMES)("%s: lands on the hand-labeled corners", (name) => {
    const fit = fits.get(name)!;
    expect(fit).not.toBeNull();
    // About 10 pixels at the app's 480-pixel frame, far corners behind the net included.
    expect(cornerError(fit.corners, labeled(name))).toBeLessThan(0.035);
  });

  it.each(FRAMES)("%s: is confident, needs nothing fixed, and can lock", (name) => {
    const fit = fits.get(name)!;
    expect(fit.confidence).toBeGreaterThanOrEqual(CONFIDENT_FIT);
    expect(isCourtShape(fit.corners)).toBe(true);
    expect(aimStep(fit)).toBe("ok");
    expect(lockable(fit)).toBe(true);
  });

  it("the hand labels themselves are a view the coach accepts", () => {
    for (const name of FRAMES) expect(aimStep({ corners: labeled(name), confidence: 1 })).toBe("ok");
  });

  it("locks within two frames of the clip", () => {
    let lock = startSearch(0);
    for (const name of VIDEO.slice(0, 2)) lock = nextLock(lock, fits.get(name)!, true);
    expect(lock.stage).toBe("locked");
  });

  it("runs well under a second a frame", () => {
    const px = frames.get("video-05")!;
    detectCourt(px);
    const start = Date.now();
    for (let i = 0; i < 3; i++) detectCourt(px);
    // Node on a laptop; a phone's Hermes is a few times slower.
    expect((Date.now() - start) / 3).toBeLessThan(250);
  });
});

describe("pickleball lines", () => {
  // The two pale yellow pickleball sidelines, in pixels of the 480 x 270 frames.
  const PICKLEBALL: [Point, Point][] = [
    [{ x: 122, y: 163 }, { x: 181, y: 127.5 }],
    [{ x: 284, y: 131 }, { x: 334, y: 175 }],
  ];
  const along = (l: Line, [a, b]: [Point, Point], tol: number) => {
    const d = (p: Point) => Math.abs(p.x * Math.cos(l.theta) + p.y * Math.sin(l.theta) - l.rho);
    return d(a) < tol && d(b) < tol;
  };

  it.each(FRAMES)("%s: never count as court paint", (name) => {
    const lines = houghLines(frames.get(name)!);
    const white = whiteLevel(lines.filter((l) => l.votes >= 270 * 0.12));
    const onPickleball = lines.filter((l) => PICKLEBALL.some((seg) => along(l, seg, 8)));
    for (const l of onPickleball) expect(l.yellow).toBeGreaterThan(white + YELLOW_MARGIN);
  });

  it.each(FRAMES)("%s: the tennis lines beside them stay white", (name) => {
    const lines = houghLines(frames.get(name)!);
    const white = whiteLevel(lines.filter((l) => l.votes >= 270 * 0.12));
    const h = homography(
      SINGLES_CORNERS_M,
      labeled(name).map((p) => ({ x: p.x * 480, y: p.y * 270 })),
    )!;
    const project = (p: Point) => {
      const w = h[6] * p.x + h[7] * p.y + h[8];
      return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
    };
    // Near baseline and both singles sidelines, between the baseline and the service line.
    const tennis: [Point, Point][] = [
      [project({ x: -4.115, y: -11.885 }), project({ x: 4.115, y: -11.885 })],
      [project({ x: -4.115, y: -11.885 }), project({ x: -4.115, y: -6.4 })],
      [project({ x: 4.115, y: -11.885 }), project({ x: 4.115, y: -6.4 })],
    ];
    for (const seg of tennis) {
      const found = lines.filter((l) => along(l, seg, 6));
      expect(found.length).toBeGreaterThan(0);
      for (const l of found) expect(l.yellow).toBeLessThanOrEqual(white + YELLOW_MARGIN);
    }
  });
});

describe("degenerate fits", () => {
  // What detection used to return on these frames (Nov 8 run, pixels at
  // 480 x 270): corners on top of each other, or one flung off the frame.
  const OLD: [number, number][][] = [
    [[-634.2, 181.1], [483.9, 239.7], [208.4, 86.9], [207.5, 86.7]],
    [[376.2, 234], [542.5, 242.7], [229.6, 88.6], [228.4, 88.2]],
    [[144.2, 51.9], [4209, 2004.9], [156, 50.9], [138.7, 48.8]],
    [[497.1, 240.3], [624.4, 247], [224.6, 86.1], [224.5, 86.2]],
    [[225.7, 227.1], [453.8, 239.1], [20.1, 18.6], [16.7, 18.1]],
    [[483.6, 240.6], [558.6, 244.6], [110.5, 33.5], [109.5, 33.2]],
  ];

  it("are never taken as a view of a court", () => {
    for (const c of OLD) {
      const hm = homography(
        SINGLES_CORNERS_M,
        c.map(([x, y]) => ({ x, y })),
      );
      expect(hm === null || !plausibleView(hm, 480, 270)).toBe(true);
    }
  });

  it("the labeled view is", () => {
    for (const name of FRAMES) {
      const hm = homography(
        SINGLES_CORNERS_M,
        labeled(name).map((p) => ({ x: p.x * 480, y: p.y * 270 })),
      )!;
      expect(plausibleView(hm, 480, 270)).toBe(true);
    }
  });

  it("any fit whose corners can't be a court has no confidence", () => {
    const all = [...fits.values()];
    for (const name of FRAMES.slice(0, 4)) {
      for (const cw of [true, false]) all.push(detectCourt(quarterTurn(frames.get(name)!, cw)));
    }
    for (const fit of all) {
      if (fit && !isCourtShape(fit.corners)) expect(fit.confidence).toBe(0);
    }
  });
});

describe("a still on its side", () => {
  it("finds no court, which is why stills are turned upright first", () => {
    for (const name of FRAMES.slice(0, 4)) {
      for (const cw of [true, false]) {
        const fit = detectCourt(quarterTurn(frames.get(name)!, cw));
        expect(fit === null || !lockable(fit)).toBe(true);
      }
    }
  });

  it("turned back upright, finds it again", () => {
    // A portrait still from a phone held landscapeRight: the sensor's view, turned a quarter counterclockwise.
    const sideways = quarterTurn(frames.get("video-01")!, false);
    const turn = uprightTurn("landscapeRight", sideways.width, sideways.height);
    expect(turn).toBe(90);
    const upright = quarterTurn(sideways, true);
    const fit = detectCourt(upright);
    expect(fit && cornerError(fit.corners, labeled("video-01"))).toBeLessThan(0.035);
  });
});

describe("the coach on the clip", () => {
  /** Runs the clip through the coach, one frame every 0.7 seconds, as the phone does. */
  function coachClip(steps: AimStep[]) {
    let run = STEP_RUN_START;
    let coach = COACH_START;
    const said: string[] = [];
    steps.forEach((step, i) => {
      run = nextStepRun(run, step);
      const { cue, state } = nextCoachCue(coach, {
        now: i * 700,
        step: agreedStep(run),
        stage: "searching",
        busy: false,
        movedSinceLast: false,
      });
      coach = state;
      if (cue) said.push(cue);
    });
    return said;
  }

  it("never gives a correction or says it can't see the court", () => {
    const steps = VIDEO.map((n) => frameStep(fits.get(n)!));
    expect(steps.every((s) => s === "ok")).toBe(true);
    expect(coachClip(steps)).toEqual([]);
  });

  it("one bad frame can't change the advice", () => {
    // The steps the old detection gave on the clip, one a second.
    const old: AimStep[] = ["none", "tiltUp", "none", "none", "none", "tiltUp", "centre", "centre", "none", "tiltUp"];
    // Old: "can't see the court" after frame 3, then nothing agreed long enough to say.
    expect(coachClip(old)).toEqual(["noLock"]);
    // A single stray frame among good ones says nothing.
    expect(coachClip(["ok", "ok", "tiltUp", "ok", "ok", "none", "ok", "ok"])).toEqual([]);
  });
});

describe("low light and shade", () => {
  // The same frames as if filmed later in the day or with the court partly in
  // shade. Before Nov 9 the paint rule wanted lines brighter than 120, so at
  // 40% brightness, or with a shadow across the near court, it found nothing.

  /** Every pixel scaled by `gain`, as a darker exposure would. */
  function darker(px: Pixels, gain: number): Pixels {
    const out = new Uint8Array(px.data.length);
    for (let i = 0; i < out.length; i += 4) {
      out[i] = px.data[i] * gain;
      out[i + 1] = px.data[i + 1] * gain;
      out[i + 2] = px.data[i + 2] * gain;
      out[i + 3] = 255;
    }
    return { width: px.width, height: px.height, data: out };
  }

  /** A shadow (40% light) over the near court, its edge running down from left to right. */
  function shaded(px: Pixels): Pixels {
    const { width: w, height: h } = px;
    const out = new Uint8Array(px.data);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (y < 140 + (x * 60) / w) continue;
        const i = (y * w + x) * 4;
        out[i] *= 0.4;
        out[i + 1] *= 0.4;
        out[i + 2] *= 0.4;
      }
    }
    return { width: w, height: h, data: out };
  }

  const paintCount = (m: Uint8Array) => m.reduce((n, v) => n + v, 0);

  it.each(FRAMES)("%s in shade: lands on the labeled corners and can lock", (name) => {
    const fit = detectCourt(shaded(frames.get(name)!));
    expect(fit).not.toBeNull();
    expect(cornerError(fit!.corners, labeled(name))).toBeLessThan(0.035);
    expect(lockable(fit)).toBe(true);
  });

  it("at 40% brightness, finds and locks the court on nearly every frame", () => {
    let locked = 0;
    for (const name of FRAMES) {
      const fit = detectCourt(darker(frames.get(name)!, 0.4));
      if (fit && lockable(fit) && cornerError(fit.corners, labeled(name)) < 0.035) locked++;
    }
    expect(locked).toBeGreaterThanOrEqual(10);
  });

  it("the usual rule sees almost no paint in the dark; the low-light rule sees the lines", () => {
    const dim = darker(frames.get("video-05")!, 0.4);
    expect(paintCount(lineMask(dim))).toBeLessThan(500);
    expect(paintCount(lineMask(dim, true))).toBeGreaterThan(3000);
  });

  it("well-lit frames are left to the usual rule", () => {
    for (const name of FRAMES) {
      const fit = fits.get(name)!;
      // Confident enough that the low-light pass never runs.
      if (fit.confidence >= RETRY_BELOW) expect(detectCourt(frames.get(name)!)).toEqual(fit);
    }
  });

  it("paint is judged against the court right beside it", () => {
    // Bright court, as on Nov 8: the usual rule.
    expect(isPaint(200, 160)).toBe(true);
    expect(isPaint(180, 160)).toBe(false);
    // The same line at 40% light: only the low-light rule sees it.
    expect(isPaint(80, 64)).toBe(false);
    expect(isPaint(80, 64, true)).toBe(true);
    // Court texture a few levels up is not paint, and nothing in deep shade is.
    expect(isPaint(70, 64, true)).toBe(false);
    expect(isPaint(39, 20, true)).toBe(false);
  });
});

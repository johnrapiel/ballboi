import { describe, expect, it } from "vitest";

import {
  agreedStep,
  aimStep,
  FAR_TOP_MAX,
  frameStatus,
  frameStep,
  LOCK_STREAK,
  lockable,
  lostLock,
  NO_COURT_FRAMES,
  nextLock,
  nextStepRun,
  RECORD_ANYWAY_MS,
  recordAnywayReady,
  startSearch,
  STEP_FRAMES,
  STEP_RUN_START,
  type AimStep,
  type StepRun,
} from "@/lib/court/aim";
import { base64ToBytes } from "@/lib/court/base64";
import type { CourtFit } from "@/lib/court/detect";
import type { Corners, Point } from "@/lib/court/geometry";
import { attitudeChange, hasMoved, isSteady } from "@/lib/court/motion";
import { stillToScreen } from "@/lib/court/overlay";

/** A good view from behind the near baseline. */
const GOOD: Corners = [
  { x: 0.1, y: 0.93 },
  { x: 0.9, y: 0.93 },
  { x: 0.63, y: 0.3 },
  { x: 0.37, y: 0.3 },
];

const fit = (corners: Corners, confidence = 0.8): CourtFit => ({ corners, confidence });
const shift = (c: Corners, dx: number, dy: number) => c.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Corners;

describe("aimStep: one step at a time", () => {
  it("says nothing to fix on a good view", () => {
    expect(aimStep(fit(GOOD))).toBe("ok");
  });

  it("asks for a court when there's none", () => {
    expect(aimStep(null)).toBe("none");
  });

  it("tilts up when the far baseline is at the top edge, and down when there's too much sky", () => {
    expect(aimStep(fit(shift(GOOD, 0, -0.22)))).toBe("tiltUp");
    expect(aimStep(fit(shift(GOOD, 0, 0.25)))).toBe("tiltDown");
  });

  it("accepts the court test's view: a phone about 2 m up on the back fence (Nov 8)", () => {
    // Hand-labeled corners from lib/__tests__/fixtures/court-frames: the far
    // baseline 0.45 of the way down, behind the net. 0.45 used to ask for "tilt down".
    const fence: Corners = [
      { x: -0.064, y: 0.791 },
      { x: 1.002, y: 0.889 },
      { x: 0.597, y: 0.466 },
      { x: 0.358, y: 0.443 },
    ];
    expect(aimStep(fit(fence))).toBe("ok");
    // More than half the picture above the far baseline still asks for a tilt down.
    expect(aimStep(fit(shift(fence, 0, FAR_TOP_MAX - 0.45 + 0.02)))).toBe("tiltDown");
  });

  it("turns toward where the court sits", () => {
    expect(aimStep(fit(shift(GOOD, -0.2, 0)))).toBe("turnLeft");
    expect(aimStep(fit(shift(GOOD, 0.2, 0)))).toBe("turnRight");
  });

  it("moves toward the centre when the near and far ends don't line up", () => {
    const skewed: Corners = [
      { x: -0.2, y: 0.93 },
      { x: 0.6, y: 0.93 },
      { x: 0.63, y: 0.3 },
      { x: 0.37, y: 0.3 },
    ];
    expect(aimStep(fit(skewed))).toBe("centre");
  });

  it("raises a phone mounted too low and lowers one mounted too high", () => {
    const flat: Corners = [
      { x: 0.1, y: 0.5 },
      { x: 0.9, y: 0.5 },
      { x: 0.63, y: 0.3 },
      { x: 0.37, y: 0.3 },
    ];
    const steep: Corners = [
      { x: 0.1, y: 1.6 },
      { x: 0.9, y: 1.6 },
      { x: 0.6, y: 0.3 },
      { x: 0.4, y: 0.3 },
    ];
    expect(aimStep(fit(flat))).toBe("raise");
    expect(aimStep(fit(steep))).toBe("lower");
  });

  it("checks aim before position, so the court comes into view first", () => {
    // Too low in the frame and off to the left: tilt first.
    expect(aimStep(fit(shift(GOOD, -0.2, -0.22)))).toBe("tiltUp");
  });

  it("locks only on a confident, well aimed find", () => {
    expect(lockable(fit(GOOD))).toBe(true);
    expect(lockable(fit(GOOD, 0.3))).toBe(false);
    expect(lockable(fit(shift(GOOD, 0.2, 0)))).toBe(false);
  });
});

describe("steady advice: frames must agree", () => {
  const runOf = (steps: AimStep[]): StepRun => steps.reduce(nextStepRun, STEP_RUN_START);

  it("counts only confident fits as a court", () => {
    expect(frameStep(fit(GOOD))).toBe("ok");
    expect(frameStep(fit(GOOD, 0.3))).toBe("none");
    expect(frameStep(fit(shift(GOOD, 0.2, 0)))).toBe("turnRight");
    expect(frameStep(null)).toBe("none");
  });

  it("agrees on a correction only after it holds for several frames in a row", () => {
    expect(STEP_FRAMES).toBeGreaterThanOrEqual(3);
    const tilt = Array<AimStep>(STEP_FRAMES).fill("tiltUp");
    expect(agreedStep(runOf(tilt.slice(1)))).toBeNull();
    expect(agreedStep(runOf(tilt))).toBe("tiltUp");
    // One different frame starts the count over.
    expect(agreedStep(runOf([...tilt.slice(1), "turnLeft", "tiltUp"]))).toBeNull();
  });

  it("says it can't see the court only after several frames in a row without one", () => {
    expect(NO_COURT_FRAMES).toBeGreaterThanOrEqual(3);
    const none = Array<AimStep>(NO_COURT_FRAMES).fill("none");
    expect(agreedStep(runOf(none.slice(1)))).toBeNull();
    expect(agreedStep(runOf(none))).toBe("none");
    expect(agreedStep(runOf(["none", "none", "ok", "none"]))).toBeNull();
  });

  it("takes ok at once: it never starts a correction, and the lock has its own check", () => {
    expect(agreedStep(runOf(["tiltUp", "tiltUp", "ok"]))).toBe("ok");
    expect(agreedStep(STEP_RUN_START)).toBeNull();
  });
});

describe("locking", () => {
  it("holds, then locks after two good finds in a row while steady", () => {
    let s = startSearch(0);
    s = nextLock(s, fit(GOOD), true);
    expect(s.stage).toBe("holding");
    for (let i = 1; i < LOCK_STREAK; i++) s = nextLock(s, fit(GOOD), true);
    expect(s.stage).toBe("locked");
    expect(s.lockedFit?.corners).toEqual(GOOD);
    expect(frameStatus(s.stage, "ok")).toBe("Court locked");
  });

  it("starts over when the phone is moving or a find goes bad", () => {
    let s = nextLock(startSearch(0), fit(GOOD), true);
    s = nextLock(s, fit(GOOD), false);
    expect(s).toMatchObject({ stage: "searching", streak: 0 });
    s = nextLock(nextLock(s, fit(GOOD), true), null, true);
    expect(s).toMatchObject({ stage: "searching", streak: 0 });
  });

  it("loses the lock when the phone moves, and the 20 seconds start again", () => {
    let s = startSearch(0);
    s = nextLock(nextLock(s, fit(GOOD), true), fit(GOOD), true);
    expect(s.stage).toBe("locked");
    s = lostLock(s, 50_000);
    expect(s).toMatchObject({ stage: "searching", searchStartedAt: 50_000, lockedFit: null });
    expect(recordAnywayReady(s, 50_000 + RECORD_ANYWAY_MS - 1)).toBe(false);
    expect(recordAnywayReady(s, 50_000 + RECORD_ANYWAY_MS)).toBe(true);
  });

  it("offers Record anyway after about 20 seconds without a lock, never once locked", () => {
    const s = startSearch(1000);
    expect(recordAnywayReady(s, 1000 + 19_999)).toBe(false);
    expect(recordAnywayReady(s, 1000 + 20_000)).toBe(true);
    const locked = nextLock(nextLock(s, fit(GOOD), true), fit(GOOD), true);
    expect(recordAnywayReady(locked, 1000 + 60_000)).toBe(false);
  });

  it("says in words whether the court is in frame (G1)", () => {
    expect(frameStatus("searching", null)).toBe("Finding the court");
    expect(frameStatus("searching", "none")).toBe("Court not in frame");
    // Agrees with the coach: while it's saying it can't see the court, a stray find isn't "in frame".
    expect(frameStatus("searching", "tiltUp")).toBe("Court in frame");
    expect(frameStatus("searching", "tiltUp", true)).toBe("Finding the court");
    expect(frameStatus("searching", "none", true)).toBe("Court not in frame");
    expect(frameStatus("locked", "ok", true)).toBe("Court locked");
    expect(frameStatus("holding", "ok")).toBe("Court in frame");
    expect(frameStatus("searching", "tiltUp")).toBe("Court in frame");
  });
});

describe("motion", () => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const at = (a: number, b: number, g: number) => ({ alpha: rad(a), beta: rad(b), gamma: rad(g) });

  it("counts a turn or tilt of more than 4 degrees as moved", () => {
    expect(hasMoved(at(10, 80, 0), at(13, 80, 0))).toBe(false);
    expect(hasMoved(at(10, 80, 0), at(15, 80, 0))).toBe(true);
    expect(hasMoved(at(10, 80, 0), at(10, 74, 0))).toBe(true);
  });

  it("handles turning through north", () => {
    expect(attitudeChange(at(359, 0, 0), at(1, 0, 0))).toBeCloseTo(2, 5);
  });

  it("never reports a move without a reading", () => {
    expect(hasMoved(null, at(0, 0, 0))).toBe(false);
  });

  it("is steady below 6 degrees a second", () => {
    expect(isSteady({ alpha: 2, beta: -3, gamma: 1 })).toBe(true);
    expect(isSteady({ alpha: 0, beta: 30, gamma: 0 })).toBe(false);
    expect(isSteady(null)).toBe(true);
  });
});

describe("base64ToBytes", () => {
  it("decodes padded, unpadded and data: input", () => {
    expect([...base64ToBytes("TWFu")]).toEqual([77, 97, 110]);
    expect([...base64ToBytes("TWE=")]).toEqual([77, 97]);
    expect([...base64ToBytes("TQ")]).toEqual([77]);
    expect([...base64ToBytes("data:image/jpeg;base64,TWFu")]).toEqual([77, 97, 110]);
  });

  it("round-trips a thousand bytes", () => {
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => (i * 73 + 11) % 256);
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let b64 = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
      b64 += A[(n >> 18) & 63] + A[(n >> 12) & 63];
      b64 += i + 1 < bytes.length ? A[(n >> 6) & 63] : "=";
      b64 += i + 2 < bytes.length ? A[n & 63] : "=";
    }
    expect([...base64ToBytes(b64)]).toEqual([...bytes]);
  });
});

describe("stillToScreen", () => {
  const close = (p: Point, q: Point) => {
    expect(p.x).toBeCloseTo(q.x, 3);
    expect(p.y).toBeCloseTo(q.y, 3);
  };

  it("maps a portrait still straight onto a same-shape screen", () => {
    close(stillToScreen({ x: 0.25, y: 0.5 }, "portrait", 0.5, 200, 400), { x: 50, y: 200 });
  });

  it("turns a sideways still a quarter: top of the phone pointing left", () => {
    // A 16:9 still on its side fills a 9:16 screen exactly.
    const w = 90;
    const h = 160;
    // The still's top-left lands at the screen's top-right.
    close(stillToScreen({ x: 0, y: 0 }, "landscapeLeft", 16 / 9, w, h), { x: w, y: 0 });
    close(stillToScreen({ x: 1, y: 1 }, "landscapeLeft", 16 / 9, w, h), { x: 0, y: h });
    close(stillToScreen({ x: 0, y: 0 }, "landscapeRight", 16 / 9, w, h), { x: 0, y: h });
  });

  it("crops like aspect fill on a taller screen", () => {
    // 9:16 content on a 390 x 844 screen: scaled to the height, cropped at the sides.
    const p = stillToScreen({ x: 0.5, y: 0.5 }, "landscapeLeft", 16 / 9, 390, 844);
    close(p, { x: 195, y: 422 });
    const edge = stillToScreen({ x: 0, y: 1 }, "landscapeLeft", 16 / 9, 390, 844);
    expect(edge.x).toBeLessThan(0);
  });
});

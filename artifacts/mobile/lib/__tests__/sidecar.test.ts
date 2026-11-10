import { describe, expect, it } from "vitest";

import {
  batteryPercent,
  BUMP_MERGE_MS,
  cornersFor,
  handlesMoved,
  MAX_MOVEMENT_EVENTS,
  measuredBitrate,
  NATIVE_REASON,
  newSidecar,
  onActualFps,
  onBatteryAtStart,
  onCaptureStart,
  onConditions,
  onCorners,
  onCameraLock,
  onInterruption,
  onLensesKnown,
  onLock,
  onMotion,
  onSegment,
  onStop,
  onThermal,
  parseSidecar,
  serializeSidecar,
  type Sidecar,
} from "@/lib/recording/sidecar";

const t0 = new Date("2026-11-10T18:00:00.000Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

function fresh(): Sidecar {
  return newSidecar({
    now: t0,
    device: { model: "iPhone15,2", iosVersion: "26.1", appVersion: "1.0.0", appBuild: "41" },
    resolution: "1280x720",
    targetFps: 30,
    codec: "avc1",
    stabilization: "off",
    lens: null,
  });
}

function capturing(): Sidecar {
  return onCaptureStart(fresh(), {
    now: at(10_000),
    startedBy: "recordButton",
    locked: true,
    confidence: 0.82,
    recordAnyway: false,
    battery: 76,
    freeStorageBytes: 12e9,
  });
}

const still = { alpha: 0.2, beta: 0.1, gamma: 0 };

describe("sidecar", () => {
  it("starts with every unmeasured field null and a reason for it", () => {
    const sc = fresh();
    expect(sc.sidecarVersion).toBe(1);
    expect(sc.capture.actualFps).toBeNull();
    expect(sc.missing["capture.actualFps"]).toBe(NATIVE_REASON);
    expect(sc.missing["health.thermal"]).toBe(NATIVE_REASON);
    expect(sc.missing["capture.lens"]).toBeTruthy();
    expect(sc.complete).toBe(false);
  });

  it("records the court and phone at capture start, once", () => {
    const sc = capturing();
    expect(sc.courtLock).toMatchObject({ lockedAtStart: true, confidenceAtStart: 0.82, recordAnywayUsed: false, startedBy: "recordButton" });
    expect(sc.health.batteryAtStart).toBe(76);
    const again = onCaptureStart(sc, { ...{ now: at(20_000), startedBy: "liveActivity", locked: false, confidence: null, recordAnyway: true, battery: 10, freeStorageBytes: 1 } });
    expect(again).toBe(sc);
  });

  it("notes Record anyway and leaves the confidence null with a reason", () => {
    const sc = onCaptureStart(fresh(), { now: at(1), startedBy: "liveActivity", locked: false, confidence: 0.3, recordAnyway: true, battery: null, freeStorageBytes: null });
    expect(sc.courtLock.recordAnywayUsed).toBe(true);
    expect(sc.courtLock.startedBy).toBe("liveActivity");
    expect(sc.courtLock.confidenceAtStart).toBeNull();
    expect(sc.missing["courtLock.confidenceAtStart"]).toMatch(/wasn't locked/);
    expect(onBatteryAtStart(sc, 55).health.batteryAtStart).toBe(55);
    expect(onBatteryAtStart(sc, 55).missing["health.batteryAtStart"]).toBeUndefined();
  });

  it("logs every lock with its time and confidence", () => {
    const sc = onLock(onLock(fresh(), at(5_000), 0.7), at(90_000), 0.66);
    expect(sc.courtLock.relocks.map((r) => [r.tMs, r.confidence])).toEqual([
      [5_000, 0.7],
      [90_000, 0.66],
    ]);
  });

  it("turns a tap on the mounted phone into one bump event at that time", () => {
    let sc = capturing();
    sc = onMotion(sc, { now: at(70_000), rate: still, accel: null, moved: false });
    sc = onMotion(sc, { now: at(70_200), rate: { alpha: 25, beta: 3, gamma: 1 }, accel: { x: 2, y: 0, z: 0 }, moved: false });
    sc = onMotion(sc, { now: at(70_400), rate: { alpha: 40, beta: 3, gamma: 1 }, accel: null, moved: false });
    sc = onMotion(sc, { now: at(70_600), rate: still, accel: null, moved: false });
    expect(sc.movement.events).toHaveLength(1);
    expect(sc.movement.events[0]).toMatchObject({ kind: "bump", tMs: 70_200, peakDegPerS: 40 });
    expect(sc.movement.events[0].peakAccelG).toBeCloseTo(0.204, 2);
  });

  it("a move past 4 degrees wins over a bump, and later bumps are separate events", () => {
    let sc = capturing();
    sc = onMotion(sc, { now: at(70_000), rate: { alpha: 30, beta: 0, gamma: 0 }, accel: null, moved: false });
    sc = onMotion(sc, { now: at(70_200), rate: { alpha: 10, beta: 0, gamma: 0 }, accel: null, moved: true });
    sc = onMotion(sc, { now: at(70_000 + BUMP_MERGE_MS + 500), rate: { alpha: 12, beta: 0, gamma: 0 }, accel: null, moved: false });
    expect(sc.movement.events.map((e) => e.kind)).toEqual(["moved", "bump"]);
  });

  it("ignores motion before capture starts", () => {
    const sc = onMotion(fresh(), { now: at(1), rate: { alpha: 50, beta: 0, gamma: 0 }, accel: null, moved: true });
    expect(sc.movement.events).toHaveLength(0);
  });

  it("scores wobble per minute", () => {
    let sc = capturing();
    for (let i = 0; i < 10; i++) sc = onMotion(sc, { now: at(10_000 + i * 200), rate: { alpha: i % 2 ? 8 : 2, beta: 0, gamma: 0 }, accel: null, moved: false });
    sc = onMotion(sc, { now: at(10_000 + 61_000), rate: { alpha: 1, beta: 0, gamma: 0 }, accel: null, moved: false });
    expect(sc.movement.wobbleByMinute[0]).toMatchObject({ minute: 0, meanDegPerS: 5, maxDegPerS: 8, unsteadyShare: 0.5, samples: 10 });
    expect(sc.movement.wobbleByMinute[1]).toMatchObject({ minute: 1, samples: 1 });
  });

  it("caps movement events and counts the rest", () => {
    let sc = capturing();
    for (let i = 0; i <= MAX_MOVEMENT_EVENTS + 4; i++) {
      sc = onMotion(sc, { now: at(10_000 + i * (BUMP_MERGE_MS + 1)), rate: { alpha: 20, beta: 0, gamma: 0 }, accel: null, moved: false });
    }
    expect(sc.movement.events).toHaveLength(MAX_MOVEMENT_EVENTS);
    expect(sc.movement.droppedEvents).toBe(5);
  });

  it("logs a ringing call as a pause and a resume", () => {
    let sc = capturing();
    sc = onInterruption(sc, "ringingPause", at(100_000));
    sc = onInterruption(sc, "resume", at(112_000));
    expect(sc.health.interruptions.map((i) => [i.kind, i.tMs])).toEqual([
      ["ringingPause", 100_000],
      ["resume", 112_000],
    ]);
  });

  it("keeps thermal readings on change and every 30 seconds", () => {
    let sc = capturing();
    sc = onThermal(sc, "nominal", at(0));
    sc = onThermal(sc, "nominal", at(10_000));
    sc = onThermal(sc, "fair", at(12_000));
    sc = onThermal(sc, "fair", at(43_000));
    expect(sc.health.thermal.map((t) => t.state)).toEqual(["nominal", "fair", "fair"]);
    expect(sc.missing["health.thermal"]).toBeUndefined();
  });

  it("measures bitrate from the saved pieces", () => {
    expect(measuredBitrate([{ sizeBytes: 750_000, durationSeconds: 1 }])).toBe(6_000_000);
    expect(measuredBitrate([])).toBeNull();
    const sc = onSegment(capturing(), { startedAt: at(10_000).toISOString(), durationSeconds: 120, sizeBytes: 90_000_000 });
    expect(sc.capture.segments[0].index).toBe(0);
    expect(sc.capture.bitrate).toBe(6_000_000);
  });

  it("logs a frame rate gap over 2 fps", () => {
    expect(onActualFps(capturing(), 29.97).missing["capture.fpsGap"]).toBeUndefined();
    const slow = onActualFps(capturing(), 24);
    expect(slow.capture.actualFps).toBe(24);
    expect(slow.missing["capture.fpsGap"]).toMatch(/24 fps/);
  });

  it("converts corners to pixels for the way the phone was held", () => {
    const pts = [
      { x: 0.25, y: 0.3 },
      { x: 0.75, y: 0.3 },
      { x: 0.95, y: 0.9 },
      { x: 0.05, y: 0.9 },
    ];
    const c = cornersFor(pts, true, "phone-detected");
    expect(c.frameWidth).toBe(1280);
    expect(c.pixels[0]).toEqual({ x: 320, y: 216 });
    expect(cornersFor(pts, false, "phone-detected").frameWidth).toBe(720);
    expect(handlesMoved(pts, pts)).toBe(false);
    expect(handlesMoved(pts, [{ x: 0.26, y: 0.3 }, ...pts.slice(1)])).toBe(true);
    const sc = onCorners(capturing(), c, true);
    expect(sc.courtLock.handlesDragged).toBe(true);
    expect(onCorners(capturing(), null, null).missing["courtLock.corners"]).toBeTruthy();
  });

  it("conditions: skipped is null, picked is saved", () => {
    const skipped = onConditions(capturing(), { setting: null, light: null, surface: null });
    expect(skipped.conditions).toBeNull();
    const picked = onConditions(capturing(), { setting: "outdoor", light: "night", surface: "hard" });
    expect(picked.conditions).toEqual({ setting: "outdoor", light: "night", surface: "hard" });
    expect(picked.missing.conditions).toBeUndefined();
  });

  it("is complete only after a normal stop", () => {
    const sc = onStop(capturing(), { now: at(130_000), reason: "user", battery: 74 });
    expect(sc.complete).toBe(true);
    expect(sc.health.batteryAtEnd).toBe(74);
  });

  it("every write is whole JSON that reads back, even mid-recording", () => {
    let sc = capturing();
    sc = onMotion(sc, { now: at(20_000), rate: { alpha: 30, beta: 0, gamma: 0 }, accel: null, moved: false });
    const back = parseSidecar(serializeSidecar(sc));
    expect(back?.complete).toBe(false);
    expect(back?.movement.events).toHaveLength(1);
    expect(parseSidecar(serializeSidecar(sc).slice(0, 50))).toBeNull();
    expect(parseSidecar('{"sidecarVersion":2}')).toBeNull();
  });

  it("a 4-hour match with full lists stays under the server's 96 KB", () => {
    let sc = capturing();
    for (let i = 0; i < 4 * 60 * 60 * 5; i += 37) {
      sc = onMotion(sc, { now: at(10_000 + i * 200), rate: { alpha: i % 3 ? 2 : 30, beta: 0, gamma: 0 }, accel: { x: 1, y: 1, z: 1 }, moved: i % 7 === 0 });
    }
    for (let i = 0; i < 600; i++) sc = onThermal(sc, i % 2 ? "fair" : "nominal", at(i * 30_000));
    for (let i = 0; i < 200; i++) sc = onInterruption(sc, "background", at(i * 1000));
    expect(new TextEncoder().encode(serializeSidecar(sc)).length).toBeLessThan(96 * 1024);
  });

  it("battery percent from expo-battery's 0 to 1", () => {
    expect(batteryPercent(0.764)).toBe(76);
    expect(batteryPercent(-1)).toBeNull();
    expect(batteryPercent(null)).toBeNull();
  });

  it("records the pinned lens only when the phone has it, and when focus locked", () => {
    const wide = "AVCaptureDeviceTypeBuiltInWideAngleCamera";
    const sc = onLensesKnown(fresh(), ["AVCaptureDeviceTypeBuiltInTripleCamera", wide], wide);
    expect(sc.capture.lens).toBe(wide);
    expect(sc.missing["capture.lens"]).toBeUndefined();
    expect(onLensesKnown(fresh(), ["AVCaptureDeviceTypeBuiltInTripleCamera"], wide).capture.lens).toBeNull();
    const locked = onCameraLock(sc, "focus", true, at(30_000));
    expect(locked.capture.focus).toEqual({ mode: "locked", lockedAt: at(30_000).toISOString() });
    expect(onCameraLock(locked, "focus", false, at(40_000)).capture.focus).toEqual({ mode: "auto", lockedAt: null });
  });
});

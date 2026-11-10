// The recording's metadata sidecar (shot tracker test plan, decision T5).
//
// One small JSON file per recording that says what the phone, camera and
// court were doing while it filmed, so every miss in the eval can be traced
// ("accuracy drops after thermal throttling"). It's written to the phone
// during the recording (sidecarFile.ts), so a crash or an auto-stop still
// leaves a valid file, and uploaded next to the video.
//
// Every field is filled, or null with a reason in `missing`, so the eval can
// tell "not measured yet" from "zero". No personal data: no location, no
// names. The match and session ids are added by the server.
//
// Pure TypeScript, no React Native: tested in lib/__tests__/sidecar.test.ts.

import type { Point } from "@/lib/court/geometry";

export const SIDECAR_VERSION = 1;

/** Caps, so a 4-hour match stays well under the server's 96 KB limit. */
export const MAX_MOVEMENT_EVENTS = 300;
export const MAX_RELOCKS = 100;
export const MAX_INTERRUPTIONS = 120;
export const MAX_THERMAL_SAMPLES = 520;
export const MAX_MINUTES = 260;

/** A rotation faster than this, in degrees a second, is a bump (the same line as "steady" in lib/court/motion.ts). */
export const BUMP_DEG_PER_S = 6;
/** Bumps closer together than this are one event. */
export const BUMP_MERGE_MS = 1500;

export type ThermalState = "nominal" | "fair" | "serious" | "critical";

export type InterruptionKind =
  /** The camera stopped while the app stayed open: a call rang and wasn't answered. */
  | "ringingPause"
  /** The app went to the background: an answered call, the phone locked, or another app. iOS doesn't say which. */
  | "background"
  /** Back in the app after going to the background. */
  | "foreground"
  /** The camera started again after a pause. */
  | "resume";

export type StartedBy = "recordButton" | "liveActivity";

export interface TimedEvent {
  /** Wall clock time (ISO). */
  at: string;
  /** Milliseconds since the sidecar started (when the camera opened). */
  tMs: number;
}

export interface MovementEvent extends TimedEvent {
  /** "bump": a sudden turn (a tap, a ball, a gust). "moved": the phone turned more than 4 degrees from where it held (the line 13 test). */
  kind: "bump" | "moved";
  /** Peak rotation rate, degrees a second. */
  peakDegPerS: number;
  /** Peak shake without gravity, in g, when the sensor gives it. */
  peakAccelG: number | null;
}

export interface WobbleMinute {
  /** Minute of the recording, from 0. */
  minute: number;
  /** Average rotation rate over the minute, degrees a second. Wind on a loose fence shows here. */
  meanDegPerS: number;
  maxDegPerS: number;
  /** Share of readings over the steady line, 0 to 1. */
  unsteadyShare: number;
  samples: number;
}

export interface Relock extends TimedEvent {
  confidence: number | null;
}

export interface Interruption extends TimedEvent {
  kind: InterruptionKind;
}

/** Kept small (no wall clock time): there can be one every 30 seconds for 4 hours. */
export interface ThermalSample {
  tMs: number;
  state: ThermalState;
}

export interface Conditions {
  setting: "indoor" | "outdoor" | null;
  light: "day" | "night" | null;
  surface: "hard" | "clay" | "grass" | "other" | null;
}

export interface SidecarSegment {
  index: number;
  startedAt: string;
  durationSeconds: number;
  sizeBytes: number;
}

export interface Sidecar {
  sidecarVersion: 1;
  /** When the camera opened for this recording. */
  startedAt: string;
  /** When capture first started, or null if it never did. */
  captureStartedAt: string | null;
  /** When the recording stopped, or null while it's still going (or the app quit). */
  stoppedAt: string | null;
  /** Why it stopped: user, battery, storage, time, or null. */
  stopReason: string | null;
  /** True once the recording stopped normally. False means the file covers up to a crash or quit. */
  complete: boolean;
  device: {
    model: string | null;
    iosVersion: string | null;
    appVersion: string | null;
    appBuild: string | null;
  };
  capture: {
    /** The camera device in use (an AVCaptureDevice type), or null when the camera picked one itself. */
    lens: string | null;
    /** Lenses the phone offered. */
    availableLenses: string[];
    resolution: string;
    targetFps: number;
    /** Frames a second the file really has, measured from it. */
    actualFps: number | null;
    focus: { mode: "locked" | "auto"; lockedAt: string | null };
    exposure: { mode: "locked" | "auto"; lockedAt: string | null };
    stabilization: string;
    hdr: boolean | null;
    codec: string;
    /** Average bits a second of the saved files, measured from their size and length. */
    bitrate: number | null;
    segments: SidecarSegment[];
  };
  courtLock: {
    /** How the start began: the Record button, or Start match on a Lock Screen or the other phone. */
    startedBy: StartedBy | null;
    /** Locked when capture started. */
    lockedAtStart: boolean;
    /** The finder's confidence at that moment, as it reports it. */
    confidenceAtStart: number | null;
    /** Every lock, before and during the recording, with its confidence. */
    relocks: Relock[];
    /** The four court corners: shares of the frame (0 to 1) and pixels. */
    corners: { normalized: Point[]; pixels: Point[]; frameWidth: number; frameHeight: number; source: string } | null;
    /** Capture started without a lock (Record anyway, line 12). */
    recordAnywayUsed: boolean;
    /** The player moved the court-line handles after the stop. Null when the fix wasn't shown. */
    handlesDragged: boolean | null;
  };
  movement: {
    events: MovementEvent[];
    wobbleByMinute: WobbleMinute[];
    /** Events not kept because the list was full. */
    droppedEvents: number;
  };
  health: {
    thermal: ThermalSample[];
    droppedFramesByMinute: number[] | null;
    batteryAtStart: number | null;
    batteryAtEnd: number | null;
    freeStorageBytesAtStart: number | null;
    interruptions: Interruption[];
  };
  conditions: Conditions | null;
  /** Why a field is null: path to reason. */
  missing: Record<string, string>;
}

export interface SidecarStart {
  now: Date;
  device: Sidecar["device"];
  resolution: string;
  targetFps: number;
  codec: string;
  stabilization: string;
  lens: string | null;
}

/** Reasons for fields this version can't measure from JavaScript. */
export const NATIVE_REASON = "Needs the capture-info native module (a new TestFlight build).";

export function newSidecar(s: SidecarStart): Sidecar {
  const missing: Record<string, string> = {
    "capture.actualFps": NATIVE_REASON,
    "capture.hdr": NATIVE_REASON,
    "health.thermal": NATIVE_REASON,
    "health.droppedFramesByMinute": NATIVE_REASON,
    "conditions": "Not picked on the score prompt (optional).",
  };
  if (!s.lens) missing["capture.lens"] = "The camera picked its own lens.";
  for (const [k, v] of Object.entries(s.device)) if (v == null) missing[`device.${k}`] = "Not reported by the phone.";
  return {
    sidecarVersion: SIDECAR_VERSION,
    startedAt: s.now.toISOString(),
    captureStartedAt: null,
    stoppedAt: null,
    stopReason: null,
    complete: false,
    device: s.device,
    capture: {
      lens: s.lens,
      availableLenses: [],
      resolution: s.resolution,
      targetFps: s.targetFps,
      actualFps: null,
      focus: { mode: "auto", lockedAt: null },
      exposure: { mode: "auto", lockedAt: null },
      stabilization: s.stabilization,
      hdr: null,
      codec: s.codec,
      bitrate: null,
      segments: [],
    },
    courtLock: {
      startedBy: null,
      lockedAtStart: false,
      confidenceAtStart: null,
      relocks: [],
      corners: null,
      recordAnywayUsed: false,
      handlesDragged: null,
    },
    movement: { events: [], wobbleByMinute: [], droppedEvents: 0 },
    health: {
      thermal: [],
      droppedFramesByMinute: null,
      batteryAtStart: null,
      batteryAtEnd: null,
      freeStorageBytesAtStart: null,
      interruptions: [],
    },
    conditions: null,
    missing,
  };
}

function timed(sc: Sidecar, now: Date): TimedEvent {
  return { at: now.toISOString(), tMs: Math.max(0, now.getTime() - Date.parse(sc.startedAt)) };
}

function withMissing(sc: Sidecar, path: string, reason: string | null): Record<string, string> {
  const m = { ...sc.missing };
  if (reason) m[path] = reason;
  else delete m[path];
  return m;
}

/** Battery as a whole percent, or null. expo-battery gives 0 to 1, and -1 when unknown. */
export function batteryPercent(level: number | null | undefined): number | null {
  if (level == null || !Number.isFinite(level) || level < 0) return null;
  return Math.round(Math.min(1, level) * 100);
}

/** Capture started: what the court and phone looked like at that moment. */
export function onCaptureStart(
  sc: Sidecar,
  input: {
    now: Date;
    startedBy: StartedBy;
    locked: boolean;
    confidence: number | null;
    recordAnyway: boolean;
    battery: number | null;
    freeStorageBytes: number | null;
  },
): Sidecar {
  if (sc.captureStartedAt) return sc;
  const missing = { ...sc.missing };
  const set = (path: string, reason: string | null) => {
    if (reason) missing[path] = reason;
    else delete missing[path];
  };
  set("health.batteryAtStart", input.battery == null ? "Not reported by the phone." : null);
  set("health.freeStorageBytesAtStart", input.freeStorageBytes == null ? "Not reported by the phone." : null);
  set("courtLock.confidenceAtStart", input.locked ? null : "The court wasn't locked when capture started.");
  return {
    ...sc,
    missing,
    captureStartedAt: input.now.toISOString(),
    courtLock: {
      ...sc.courtLock,
      startedBy: input.startedBy,
      lockedAtStart: input.locked,
      confidenceAtStart: input.locked ? input.confidence : null,
      recordAnywayUsed: input.recordAnyway,
    },
    health: { ...sc.health, batteryAtStart: input.battery, freeStorageBytesAtStart: input.freeStorageBytes },
  };
}

export function onLock(sc: Sidecar, now: Date, confidence: number | null): Sidecar {
  if (sc.courtLock.relocks.length >= MAX_RELOCKS) return sc;
  return { ...sc, courtLock: { ...sc.courtLock, relocks: [...sc.courtLock.relocks, { ...timed(sc, now), confidence }] } };
}

/**
 * The lenses the phone offers. When the pinned lens is among them, it's the
 * one in use; otherwise the camera picked its own.
 */
export function onLensesKnown(sc: Sidecar, lenses: string[], pinned: string | null = null): Sidecar {
  const lens = pinned && lenses.includes(pinned) ? pinned : null;
  const missing = { ...sc.missing };
  if (lens) delete missing["capture.lens"];
  else missing["capture.lens"] = "The camera picked its own lens.";
  return { ...sc, missing, capture: { ...sc.capture, lens, availableLenses: [...new Set(lenses)].sort() } };
}

/** Focus or exposure locked (at court lock), or went back to auto. */
export function onCameraLock(sc: Sidecar, what: "focus" | "exposure", locked: boolean, now: Date): Sidecar {
  const value = locked ? { mode: "locked" as const, lockedAt: now.toISOString() } : { mode: "auto" as const, lockedAt: null };
  return { ...sc, capture: { ...sc.capture, [what]: value } };
}

export function onInterruption(sc: Sidecar, kind: InterruptionKind, now: Date): Sidecar {
  if (sc.health.interruptions.length >= MAX_INTERRUPTIONS) return sc;
  return { ...sc, health: { ...sc.health, interruptions: [...sc.health.interruptions, { ...timed(sc, now), kind }] } };
}

/** A thermal reading: kept when it changes, and every 30 seconds. */
export const THERMAL_SAMPLE_MS = 30_000;

export function onThermal(sc: Sidecar, state: ThermalState, now: Date): Sidecar {
  const list = sc.health.thermal;
  const last = list[list.length - 1];
  const tMs = timed(sc, now).tMs;
  if (last && last.state === state && tMs - last.tMs < THERMAL_SAMPLE_MS) return sc;
  if (list.length >= MAX_THERMAL_SAMPLES) return sc;
  return {
    ...sc,
    missing: withMissing(sc, "health.thermal", null),
    health: { ...sc.health, thermal: [...list, { tMs, state }] },
  };
}

/** One motion reading while recording. */
export interface MotionReading {
  now: Date;
  /** Rotation rate on each axis, degrees a second. */
  rate: { alpha: number; beta: number; gamma: number } | null;
  /** Acceleration without gravity, m/s², when the sensor gives it. */
  accel: { x: number; y: number; z: number } | null;
  /** The line 13 test fired on this reading (the phone turned more than 4 degrees from where it held). */
  moved: boolean;
}

const G = 9.80665;

function rateMagnitude(rate: MotionReading["rate"]): number {
  if (!rate) return 0;
  const m = Math.max(Math.abs(rate.alpha), Math.abs(rate.beta), Math.abs(rate.gamma));
  return Number.isFinite(m) ? m : 0;
}

function accelG(accel: MotionReading["accel"]): number | null {
  if (!accel) return null;
  const m = Math.sqrt(accel.x ** 2 + accel.y ** 2 + accel.z ** 2) / G;
  return Number.isFinite(m) ? Math.round(m * 1000) / 1000 : null;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Movement: a bump or a move becomes an event; every reading counts toward its minute's wobble. */
export function onMotion(sc: Sidecar, m: MotionReading): Sidecar {
  if (!sc.captureStartedAt) return sc;
  const deg = rateMagnitude(m.rate);
  const g = accelG(m.accel);
  const minute = Math.max(0, Math.floor((m.now.getTime() - Date.parse(sc.captureStartedAt)) / 60_000));

  // Wobble for this minute.
  const wob = [...sc.movement.wobbleByMinute];
  if ((wob.length === 0 || wob[wob.length - 1].minute !== minute) && wob.length < MAX_MINUTES) {
    wob.push({ minute, meanDegPerS: 0, maxDegPerS: 0, unsteadyShare: 0, samples: 0 });
  }
  const row = wob[wob.length - 1];
  if (row && row.minute === minute) {
    const n = row.samples + 1;
    const unsteady = row.unsteadyShare * row.samples + (deg >= BUMP_DEG_PER_S ? 1 : 0);
    wob[wob.length - 1] = {
      minute,
      meanDegPerS: r1((row.meanDegPerS * row.samples + deg) / n),
      maxDegPerS: r1(Math.max(row.maxDegPerS, deg)),
      unsteadyShare: Math.round((unsteady / n) * 1000) / 1000,
      samples: n,
    };
  }

  let movement = { ...sc.movement, wobbleByMinute: wob };
  const kind: MovementEvent["kind"] | null = m.moved ? "moved" : deg >= BUMP_DEG_PER_S ? "bump" : null;
  if (kind) {
    const events = movement.events;
    const last = events[events.length - 1];
    const t = timed(sc, m.now);
    if (last && t.tMs - last.tMs < BUMP_MERGE_MS) {
      // One bump, many readings: keep the peak, and "moved" wins over "bump".
      const merged: MovementEvent = {
        ...last,
        kind: last.kind === "moved" || kind === "moved" ? "moved" : "bump",
        peakDegPerS: r1(Math.max(last.peakDegPerS, deg)),
        peakAccelG: g == null ? last.peakAccelG : Math.max(last.peakAccelG ?? 0, g),
      };
      movement = { ...movement, events: [...events.slice(0, -1), merged] };
    } else if (events.length >= MAX_MOVEMENT_EVENTS) {
      movement = { ...movement, droppedEvents: movement.droppedEvents + 1 };
    } else {
      movement = { ...movement, events: [...events, { ...t, kind, peakDegPerS: r1(deg), peakAccelG: g }] };
    }
  }
  return { ...sc, movement };
}

/** Court corners as shares of the frame, and in pixels of a 16:9 frame held the given way. */
export function cornersFor(
  points: Point[],
  landscape: boolean,
  source: string,
  longSide = 1280,
  shortSide = 720,
): NonNullable<Sidecar["courtLock"]["corners"]> {
  const w = landscape ? longSide : shortSide;
  const h = landscape ? shortSide : longSide;
  return {
    normalized: points.map((p) => ({ x: p.x, y: p.y })),
    pixels: points.map((p) => ({ x: Math.round(p.x * w), y: Math.round(p.y * h) })),
    frameWidth: w,
    frameHeight: h,
    source,
  };
}

/** Average bits a second across the saved pieces, or null. */
export function measuredBitrate(segments: Pick<SidecarSegment, "sizeBytes" | "durationSeconds">[]): number | null {
  const bytes = segments.reduce((s, x) => s + Math.max(0, x.sizeBytes), 0);
  const secs = segments.reduce((s, x) => s + Math.max(0, x.durationSeconds), 0);
  if (bytes <= 0 || secs <= 0) return null;
  return Math.round((bytes * 8) / secs);
}

export function onSegment(sc: Sidecar, seg: Omit<SidecarSegment, "index">): Sidecar {
  const segments = [...sc.capture.segments, { ...seg, index: sc.capture.segments.length }];
  const bitrate = measuredBitrate(segments);
  return {
    ...sc,
    missing: withMissing(sc, "capture.bitrate", bitrate == null ? "No saved video yet." : null),
    capture: { ...sc.capture, segments, bitrate },
  };
}

/** Frames a second measured from a saved piece, from the native module. Keeps the lowest seen. */
export function onActualFps(sc: Sidecar, fps: number | null): Sidecar {
  if (fps == null || !Number.isFinite(fps) || fps <= 0) return sc;
  const rounded = Math.round(fps * 100) / 100;
  const actual = sc.capture.actualFps == null ? rounded : Math.min(sc.capture.actualFps, rounded);
  let missing = withMissing(sc, "capture.actualFps", null);
  const gap = Math.abs(actual - sc.capture.targetFps);
  if (gap > 2) missing = { ...missing, "capture.fpsGap": `Delivered ${actual} fps against a target of ${sc.capture.targetFps}.` };
  return { ...sc, missing, capture: { ...sc.capture, actualFps: actual } };
}

export function onStop(sc: Sidecar, input: { now: Date; reason: string; battery: number | null }): Sidecar {
  return {
    ...sc,
    stoppedAt: input.now.toISOString(),
    stopReason: input.reason,
    complete: true,
    missing: withMissing(sc, "health.batteryAtEnd", input.battery == null ? "Not reported by the phone." : null),
    health: { ...sc.health, batteryAtEnd: input.battery },
  };
}

export function onCorners(sc: Sidecar, corners: Sidecar["courtLock"]["corners"], handlesDragged: boolean | null): Sidecar {
  const missing = withMissing(
    sc,
    "courtLock.corners",
    corners ? null : "No corners: the server finds the court itself.",
  );
  return { ...sc, missing, courtLock: { ...sc.courtLock, corners, handlesDragged } };
}

/** True when the player moved any handle from where the fix put it. */
export function handlesMoved(start: Point[], end: Point[]): boolean {
  if (start.length !== end.length) return true;
  return start.some((p, i) => Math.abs(p.x - end[i].x) > 1e-4 || Math.abs(p.y - end[i].y) > 1e-4);
}

/** Conditions from the score prompt. All-null counts as skipped. */
export function onConditions(sc: Sidecar, c: Conditions | null): Sidecar {
  const picked = c && (c.setting || c.light || c.surface) ? c : null;
  return {
    ...sc,
    conditions: picked,
    missing: withMissing(sc, "conditions", picked ? null : "Not picked on the score prompt (optional)."),
  };
}

/** The file's text. Always complete, valid JSON. */
export function serializeSidecar(sc: Sidecar): string {
  return JSON.stringify(sc);
}

/** Reads a saved sidecar, or null when it isn't one. */
export function parseSidecar(text: string): Sidecar | null {
  try {
    const v = JSON.parse(text) as Partial<Sidecar>;
    return v && v.sidecarVersion === SIDECAR_VERSION ? (v as Sidecar) : null;
  } catch {
    return null;
  }
}

/** Battery at capture start, read just after it (the read is async and capture never waits for it). */
export function onBatteryAtStart(sc: Sidecar, battery: number | null): Sidecar {
  if (battery == null) return sc;
  const missing = { ...sc.missing };
  delete missing["health.batteryAtStart"];
  return { ...sc, missing, health: { ...sc.health, batteryAtStart: battery } };
}

/**
 * Dropped frames from one saved piece, per minute of that piece, added to the
 * recording's minutes from where the piece started (`startMinute`).
 */
export function onDroppedFrames(sc: Sidecar, perMinute: number[], startMinute: number): Sidecar {
  const list = [...(sc.health.droppedFramesByMinute ?? [])];
  perMinute.forEach((n, i) => {
    const m = Math.max(0, startMinute + i);
    if (m >= MAX_MINUTES) return;
    while (list.length <= m) list.push(0);
    list[m] += Math.max(0, Math.round(n));
  });
  const missing = { ...sc.missing };
  delete missing["health.droppedFramesByMinute"];
  return { ...sc, missing, health: { ...sc.health, droppedFramesByMinute: list } };
}

/** HDR as the camera reports it. Null keeps the field unknown. */
export function onHdr(sc: Sidecar, hdr: boolean | null): Sidecar {
  if (hdr == null) return sc;
  const missing = { ...sc.missing };
  delete missing["capture.hdr"];
  return { ...sc, missing, capture: { ...sc.capture, hdr } };
}

/** Minutes from capture start to a piece's start, for lining up its dropped frames. */
export function minuteOf(sc: Sidecar, isoStart: string): number {
  if (!sc.captureStartedAt) return 0;
  return Math.max(0, Math.floor((Date.parse(isoStart) - Date.parse(sc.captureStartedAt)) / 60_000));
}

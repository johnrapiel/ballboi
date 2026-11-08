// The court check on the mounted phone: frames from the camera while setting
// up and counting down, the motion sensor all the way through.
//
// - Setting up: about one frame a second. Each find gives the next step
//   (lib/court/aim.ts). Two good finds in a row while the phone is steady
//   lock the court.
// - Locked: frames stop. If the phone turns or tilts away from where it
//   locked, the lock is lost and the search starts again (line 13 in the
//   countdown).
// - Recording: no frames, ever. "Court in frame" comes from the motion
//   sensor: still where it locked, or moved.
// - After about 20 seconds without a lock, Record anyway turns on, and stays
//   on.

import type { CameraView } from "expo-camera";
import { DeviceMotion } from "expo-sensors";
import { useEffect, useRef, useState, type RefObject } from "react";

import {
  aimStep,
  lostLock,
  nextLock,
  recordAnywayReady,
  startSearch,
  type AimStep,
  type LockState,
} from "@/lib/court/aim";
import type { CourtFit } from "@/lib/court/detect";
import { captureFrame, releaseFrame, type CourtFrame } from "@/lib/court/frame";
import { hasMoved, isSteady, type Attitude } from "@/lib/court/motion";

/** Time between frames while setting up. */
const FRAME_GAP_MS = 700;
/** How often the motion sensor reports. */
const MOTION_INTERVAL_MS = 200;

export interface CourtWatch {
  lock: LockState;
  /** The latest step, or null before the first frame. */
  step: AimStep | null;
  /** The latest find, for the overlay. */
  fit: CourtFit | null;
  /** True once Record anyway has turned on. It stays on. */
  recordAnyway: boolean;
  /** True when the phone has moved since the court locked. */
  movedSinceLock: boolean;
  /** The newest frame, kept for the court-line fix. Owned by the hook. */
  latestFrame: RefObject<CourtFrame | null>;
  /** The phone's attitude right now, for the voice coach's repeat rule. */
  attitude: RefObject<Attitude | null>;
  /** True when the phone isn't moving right now. */
  steady: RefObject<boolean>;
  /** Resolves once no frame is being taken, so capture never starts mid-photo. */
  idle: () => Promise<void>;
}

export interface CourtWatchEvents {
  /** A new frame was read. */
  onFrame?: (step: AimStep, lock: LockState) => void;
  onLocked?: (fit: CourtFit) => void;
  /** The phone moved away from where the court locked. */
  onLockLost?: () => void;
  onRecordAnyway?: () => void;
}

/**
 * Watches the court. `framesOn` is true while frames may be taken (setting up
 * or counting down, camera ready); `sensing` while the motion sensor should
 * run (the whole time the camera screen is open).
 */
export function useCourtWatch(
  camera: RefObject<CameraView | null>,
  framesOn: boolean,
  sensing: boolean,
  events: CourtWatchEvents = {},
): CourtWatch {
  const [lock, setLockState] = useState<LockState>(() => startSearch(Date.now()));
  const lockRef = useRef(lock);
  const [step, setStep] = useState<AimStep | null>(null);
  const [fit, setFit] = useState<CourtFit | null>(null);
  const [recordAnyway, setRecordAnyway] = useState(false);
  const recordAnywayRef = useRef(false);
  const [movedSinceLock, setMovedSinceLock] = useState(false);
  const latestFrame = useRef<CourtFrame | null>(null);
  const attitude = useRef<Attitude | null>(null);
  const steady = useRef(true);
  const lockAttitude = useRef<Attitude | null>(null);
  const started = useRef(false);
  const inflight = useRef<Promise<unknown> | null>(null);
  const ev = useRef(events);
  useEffect(() => {
    ev.current = events;
  });

  const setLock = (s: LockState) => {
    lockRef.current = s;
    setLockState(s);
  };

  // Motion: steadiness, and losing the lock when the phone is bumped.
  useEffect(() => {
    if (!sensing) return;
    let sub: { remove(): void } | null = null;
    try {
      DeviceMotion.setUpdateInterval(MOTION_INTERVAL_MS);
      sub = DeviceMotion.addListener((m) => {
        if (!m.rotation) return;
        const now = { alpha: m.rotation.alpha, beta: m.rotation.beta, gamma: m.rotation.gamma };
        attitude.current = now;
        steady.current = isSteady(m.rotationRate);
        if (lockRef.current.stage === "locked" && hasMoved(lockAttitude.current, now)) {
          lockAttitude.current = null;
          setMovedSinceLock(true);
          setLock(lostLock(lockRef.current, Date.now()));
          ev.current.onLockLost?.();
        }
      });
    } catch {
      // No motion sensor: the phone counts as steady and never "moved".
    }
    return () => sub?.remove();
  }, [sensing]);

  // Frames: about one a second until the court locks.
  useEffect(() => {
    if (!framesOn) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // The 20 seconds count from when the camera is up, not from the intro.
    if (!started.current) {
      started.current = true;
      setLock(startSearch(Date.now()));
    }
    const loop = async () => {
      if (cancelled) return;
      const s = lockRef.current;
      if (s.stage !== "locked") {
        const taking = captureFrame(camera.current);
        inflight.current = taking;
        const frame = await taking;
        inflight.current = null;
        if (cancelled) {
          releaseFrame(frame);
          return;
        }
        if (frame) {
          releaseFrame(latestFrame.current);
          latestFrame.current = frame;
          const st = aimStep(frame.fit);
          const next = nextLock(lockRef.current, frame.fit, steady.current);
          setStep(st);
          setFit(frame.fit);
          if (next.stage === "locked" && lockRef.current.stage !== "locked" && next.lockedFit) {
            lockAttitude.current = attitude.current;
            setMovedSinceLock(false);
            setLock(next);
            ev.current.onLocked?.(next.lockedFit);
          } else {
            setLock(next);
          }
          ev.current.onFrame?.(st, next);
        }
      }
      if (!recordAnywayRef.current && recordAnywayReady(lockRef.current, Date.now())) {
        recordAnywayRef.current = true;
        setRecordAnyway(true);
        ev.current.onRecordAnyway?.();
      }
      timer = setTimeout(loop, FRAME_GAP_MS);
    };
    loop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [framesOn, camera]);

  // Frees the last frame when the screen goes.
  useEffect(
    () => () => {
      releaseFrame(latestFrame.current);
      latestFrame.current = null;
    },
    [],
  );

  const idle = async () => {
    const p = inflight.current;
    if (p) await p.catch(() => {});
  };

  return { lock, step, fit, recordAnyway, movedSinceLock, latestFrame, attitude, steady, idle };
}

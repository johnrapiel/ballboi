// Safety cap (spec: Ball Boi > Recording): "auto-stop and save at low battery,
// low storage, or 4 hours". The 4-hour limit is the camera's maxDuration;
// battery and storage are checked while recording.

import * as Battery from "expo-battery";
import { useEffect, useRef, useState } from "react";

import { freeDiskBytes } from "@/lib/recording/files";
import { batteryTooLow, batteryWarning } from "@/lib/recording/limits";

export const MAX_RECORDING_SECONDS = 4 * 60 * 60;
/** Stop below this much free space, leaving room to finish writing the file (about 15 minutes of 720p). */
export const LOW_STORAGE_BYTES = 1 * 1024 ** 3;
/** Don't start with less than this free, in GB: about 30 minutes of 720p video, plus room to finish the file. */
export const MIN_START_STORAGE_GB = 2;
export const MIN_START_STORAGE_BYTES = MIN_START_STORAGE_GB * 1024 ** 3;

export { STOP_CUES, STOP_MESSAGES, type StopReason } from "@/lib/recording/stopMessages";

/** Battery or storage problem right now, or null when it's fine to keep going. */
export async function checkLimits(): Promise<"battery" | "storage" | null> {
  try {
    const [level, state] = await Promise.all([Battery.getBatteryLevelAsync(), Battery.getBatteryStateAsync()]);
    const charging = state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL;
    // Same rule as starting (under 10%, unplugged), so a match started at 10% isn't stopped straight away.
    if (batteryTooLow(level, charging)) return "battery";
  } catch {
    // Unknown battery: keep recording.
  }
  try {
    if (freeDiskBytes() < LOW_STORAGE_BYTES) return "storage";
  } catch {
    // Unknown storage: keep recording.
  }
  return null;
}

/** True when the battery is too low to start: under 10% and not plugged in (D14). Unknown never blocks. */
export async function batteryBlocksStart(): Promise<boolean> {
  try {
    const [level, state] = await Promise.all([Battery.getBatteryLevelAsync(), Battery.getBatteryStateAsync()]);
    const pluggedIn = state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL;
    return batteryTooLow(level, pluggedIn);
  } catch {
    return false;
  }
}

/** True when there's room to start a recording. */
export function hasRoomToStart(): boolean {
  try {
    return freeDiskBytes() >= MIN_START_STORAGE_BYTES;
  } catch {
    return true;
  }
}

/** Warn about storage below this while recording: the 1 GB auto-stop is close. */
export const WARN_STORAGE_BYTES = 2 * 1024 ** 3;

export const BATTERY_WARNING = "Battery low. Plug in to keep recording.";
export const STORAGE_WARNING = "Phone storage almost full.";

/**
 * While `active`, checks battery and storage every 30 seconds and says which
 * are running low, so the recording screen can warn in words before the
 * safety cap stops the match (G1).
 */
export function useRecordingWarnings(active: boolean): { battery: boolean; storage: boolean } {
  const [warn, setWarn] = useState({ battery: false, storage: false });
  useEffect(() => {
    if (!active) {
      setWarn({ battery: false, storage: false });
      return;
    }
    let cancelled = false;
    const tick = async () => {
      let battery = false;
      let storage = false;
      try {
        const [level, state] = await Promise.all([Battery.getBatteryLevelAsync(), Battery.getBatteryStateAsync()]);
        battery = batteryWarning(level, state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL);
      } catch {
        // Unknown battery: no warning.
      }
      try {
        storage = freeDiskBytes() < WARN_STORAGE_BYTES;
      } catch {
        // Unknown storage: no warning.
      }
      if (!cancelled) setWarn((w) => (w.battery === battery && w.storage === storage ? w : { battery, storage }));
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [active]);
  return warn;
}

/** While `active`, checks every 30 seconds and calls `onLimit` once when a limit is hit. */
export function useSafetyCap(active: boolean, onLimit: (reason: "battery" | "storage") => void) {
  const fired = useRef(false);
  const cb = useRef(onLimit);
  useEffect(() => {
    cb.current = onLimit;
  });
  useEffect(() => {
    if (!active) {
      fired.current = false;
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const hit = await checkLimits();
      if (hit && !cancelled && !fired.current) {
        fired.current = true;
        cb.current(hit);
      }
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [active]);
}

// Safety cap (spec: Ball Boi > Recording): "auto-stop and save at low battery,
// low storage, or 4 hours". The 4-hour limit is the camera's maxDuration;
// battery and storage are checked while recording.

import * as Battery from "expo-battery";
import { useEffect, useRef } from "react";

import { freeDiskBytes } from "@/lib/recording/files";

export const MAX_RECORDING_SECONDS = 4 * 60 * 60;
/** Stop below this charge, unless the phone is plugged in. */
export const LOW_BATTERY = 0.1;
/** Stop below this much free space, leaving room to finish writing the file (about 15 minutes of 720p). */
export const LOW_STORAGE_BYTES = 1 * 1024 ** 3;
/** Don't start with less than this free, in GB: about 30 minutes of 720p video, plus room to finish the file. */
export const MIN_START_STORAGE_GB = 2;
export const MIN_START_STORAGE_BYTES = MIN_START_STORAGE_GB * 1024 ** 3;

export type StopReason = "user" | "battery" | "storage" | "time";

export const STOP_MESSAGES: Record<Exclude<StopReason, "user">, string> = {
  battery: "Battery low. Recording stopped and saved.",
  storage: "Phone storage almost full. Recording stopped and saved.",
  time: "Recording reached 4 hours. Stopped and saved.",
};

/** Battery or storage problem right now, or null when it's fine to keep going. */
export async function checkLimits(): Promise<"battery" | "storage" | null> {
  try {
    const [level, state] = await Promise.all([Battery.getBatteryLevelAsync(), Battery.getBatteryStateAsync()]);
    const charging = state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL;
    // -1 means the level isn't known (simulator); never stop on that.
    if (!charging && level >= 0 && level <= LOW_BATTERY) return "battery";
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

/** True when there's room to start a recording. */
export function hasRoomToStart(): boolean {
  try {
    return freeDiskBytes() >= MIN_START_STORAGE_BYTES;
  } catch {
    return true;
  }
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

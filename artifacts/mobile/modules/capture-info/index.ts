// Ball Boi capture info (decision T5): thermal state, the delivered frame
// rate and dropped frames of a saved piece, and holding exposure and HDR
// still at court lock. The native side is apple/BallBoiCaptureInfoModule.swift
// (apple/, not ios/, because the app's .gitignore drops ios/ folders). Where
// it isn't built in (Expo Go, a simulator, a build before it), every call
// returns null and the sidecar keeps those fields null with a reason.

import { requireOptionalNativeModule } from "expo";

export type ThermalState = "nominal" | "fair" | "serious" | "critical";

export interface VideoInfo {
  durationSeconds: number;
  nominalFps: number;
  frames: number;
  deliveredFps: number | null;
  /** Frames missing from the file, per minute of this piece. */
  droppedFramesByMinute: number[];
  codec: string | null;
  width: number;
  height: number;
  bitrate: number;
}

interface CaptureInfoModule {
  thermalState(): ThermalState;
  videoInfo(uri: string): Promise<VideoInfo>;
  holdExposure(locked: boolean): { exposureLocked: boolean | null; hdr: boolean | null };
  addListener(event: "onThermalChange", listener: (e: { state: ThermalState }) => void): { remove(): void };
}

const native = requireOptionalNativeModule<CaptureInfoModule>("BallBoiCaptureInfo");

export const captureInfoAvailable = !!native;

export function thermalState(): ThermalState | null {
  try {
    return native ? native.thermalState() : null;
  } catch {
    return null;
  }
}

export function onThermalChange(listener: (state: ThermalState) => void): () => void {
  if (!native) return () => {};
  try {
    const sub = native.addListener("onThermalChange", (e) => listener(e.state));
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

export async function videoInfo(uri: string): Promise<VideoInfo | null> {
  try {
    return native ? await native.videoInfo(uri) : null;
  } catch {
    return null;
  }
}

export function holdExposure(locked: boolean): { exposureLocked: boolean | null; hdr: boolean | null } | null {
  try {
    return native ? native.holdExposure(locked) : null;
  } catch {
    return null;
  }
}

// Camera settings for match recording, matched to what the analysis models
// expect (John approved, from Session E's #78): 1280x720, 30 fps, H.264,
// stabilization off.
//
// - 720p: on iOS this is AVFoundation's hd1280x720 preset, which records at
//   30 fps. expo-camera has no frame-rate option, so 30 fps comes from the
//   preset. Check it on a phone with the footage review script in
//   artifacts/ml-server/intake if this ever changes.
// - H.264 ("avc1"): iPhones default to HEVC; the analysis models expect H.264.
// - Stabilization off: the phone is on the fence, and stabilization crops
//   and shifts the frame, which moves the court lines between frames.
//
// Size: iPhones record this at roughly 5 to 8 megabits a second, about
// 2.3 to 3.6 GB an hour. The free-space checks in safety.ts use that.

import type { VideoCodec, VideoQuality, VideoStabilization } from "expo-camera";

export const VIDEO_QUALITY: VideoQuality = "720p";
export const VIDEO_CODEC: VideoCodec = "avc1";
export const VIDEO_STABILIZATION: VideoStabilization = "off";

/** The frame rate the 720p preset records at. The sidecar compares what the file really has against it. */
export const VIDEO_TARGET_FPS = 30;

/**
 * The camera holds its view still while it records (shot analyst, Nov 9):
 * reframing breaks the court mapping that in and out calls depend on.
 *
 * - Lens: the physical wide lens. Without this, expo-camera picks the
 *   multi-lens "virtual" camera on Pro iPhones, which can switch lenses on
 *   its own (it jumps to the ultra-wide for close focus). The wide lens is
 *   the view that virtual camera shows anyway, so framing doesn't change.
 *   This doesn't settle wide vs ultra-wide: the two-phone A/B does (test
 *   plan section 7). A phone without the lens falls back to the default.
 * - Focus: continuous while aiming, then focuses once and locks at court
 *   lock (or when the countdown starts anyway). Stays locked while
 *   recording. expo-camera's "on" means focus once, then hold.
 * - Exposure and HDR can't be set from JavaScript: the capture-info native
 *   module handles them.
 * - Center Stage is front camera only, Cinematic mode is never turned on,
 *   and nothing zooms: none of them apply.
 */
export const RECORDING_LENS = "AVCaptureDeviceTypeBuiltInWideAngleCamera";

/** expo-camera's autofocus prop: "on" focuses once and locks, "off" keeps focusing. */
export function focusSetting(locked: boolean): "on" | "off" {
  return locked ? "on" : "off";
}

/** Should focus be locked now? Once capture has started it never unlocks, even if the phone is bumped. */
export function focusShouldLock(input: { courtLocked: boolean; countingAnyway: boolean; capturing: boolean }): boolean {
  if (input.capturing) return true;
  return input.courtLocked || input.countingAnyway;
}

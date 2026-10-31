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

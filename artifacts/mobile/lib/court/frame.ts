// Takes the small frames the court check reads, on the phone (spec: Ball Boi
// > Processing, "court detection runs on device"). Each frame is a silent
// photo from the camera, shrunk to 480 pixels on its long side and cropped to
// the video's 16:9 view. It stays in memory: nothing is written to disk until
// the phone keeps one still for the court-line fix, and nothing leaves the
// phone except the four corners and a confidence score.
//
// Frames are only taken while setting up and counting down, never while the
// camera is recording.

import type { CameraView } from "expo-camera";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat, type ImageRef } from "expo-image-manipulator";
import { decode } from "jpeg-js";

import { base64ToBytes } from "@/lib/court/base64";
import { detectCourt, type CourtFit } from "@/lib/court/detect";
import type { PhoneOrientation } from "@/lib/court/overlay";
import { analysisSize, uprightTurn, videoAspectCrop } from "@/lib/court/still";

/** One frame: the small image, kept so it can become the court-line fix's still. */
export interface CourtFrame {
  image: ImageRef;
  width: number;
  height: number;
  fit: CourtFit | null;
}

/** A still saved on the phone for the court-line fix. */
export interface CourtStill {
  uri: string;
  width: number;
  height: number;
}

/** Frees a frame's image. Safe to call twice. */
export function releaseFrame(frame: CourtFrame | null | undefined) {
  try {
    frame?.image.release();
  } catch {
    // Already released.
  }
}

/**
 * Takes one frame and finds the court in it. Null when the camera can't take
 * a photo right now (busy, not ready, or recording). `orientation` is how
 * the phone is held: a still that comes out on its side is turned upright
 * first (lib/court/still.ts uprightTurn), since detection only reads an
 * upright court.
 */
export async function captureFrame(camera: CameraView | null, orientation: PhoneOrientation = "portrait"): Promise<CourtFrame | null> {
  if (!camera) return null;
  let photo: { release(): void; width: number; height: number } | null = null;
  try {
    const ref = await camera.takePictureAsync({ pictureRef: true, shutterSound: false });
    photo = ref;
    let ctx = ImageManipulator.manipulate(ref);
    const turn = uprightTurn(orientation, ref.width, ref.height);
    if (turn) ctx = ctx.rotate(turn);
    const width = turn ? ref.height : ref.width;
    const height = turn ? ref.width : ref.height;
    const crop = videoAspectCrop(width, height);
    if (crop) ctx = ctx.crop(crop);
    ctx = ctx.resize(analysisSize(crop?.width ?? width, crop?.height ?? height));
    const image = await ctx.renderAsync();
    try {
      ctx.release();
    } catch {
      // Nothing to free.
    }
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
    let fit: CourtFit | null = null;
    if (saved.base64) {
      const img = decode(base64ToBytes(saved.base64), { useTArray: true, formatAsRGBA: true });
      fit = detectCourt({ width: img.width, height: img.height, data: img.data });
    }
    discard(saved.uri);
    return { image, width: image.width, height: image.height, fit };
  } catch {
    return null;
  } finally {
    try {
      photo?.release();
    } catch {
      // Already released.
    }
  }
}

/** Saves a frame as a still on the phone, for the court-line fix. */
export async function keepStill(frame: CourtFrame): Promise<CourtStill | null> {
  try {
    const saved = await frame.image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
    return { uri: saved.uri, width: saved.width, height: saved.height };
  } catch {
    return null;
  }
}

/** Deletes a still from the phone. Missing files are fine. */
export function discard(uri: string | null | undefined) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone.
  }
}

// Takes the still frame for court detection and runs detection on it, on the
// phone (spec: Ball Boi > Processing). The still is taken just before the
// first piece of a match starts recording, so nothing interrupts the video,
// and it stays on the phone: it is only shown back on the court-line fix.

import type { CameraView } from "expo-camera";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { decode } from "jpeg-js";

import { detectCourt, type CourtFit } from "@/lib/court/detect";
import { analysisSize, videoAspectCrop } from "@/lib/court/still";

export interface CourtStill {
  /** The small still on the phone, for the court-line fix. */
  uri: string;
  width: number;
  height: number;
}

/**
 * Takes a still from the camera, silently, and saves it at analysis size,
 * cropped to the video's frame. Null when the camera can't take one.
 */
export async function takeCourtStill(camera: CameraView | null): Promise<CourtStill | null> {
  if (!camera) return null;
  try {
    const photo = await camera.takePictureAsync({ shutterSound: false, quality: 0.9, exif: false });
    if (!photo?.uri) return null;
    let ctx = ImageManipulator.manipulate(photo.uri);
    const crop = videoAspectCrop(photo.width, photo.height);
    if (crop) ctx = ctx.crop(crop);
    ctx = ctx.resize(analysisSize(crop?.width ?? photo.width, crop?.height ?? photo.height));
    const image = await ctx.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
    discard(photo.uri);
    return { uri: saved.uri, width: saved.width, height: saved.height };
  } catch {
    return null;
  }
}

/** Finds the court in a still. Null when it can't be read or nothing fits. */
export async function findCourt(still: CourtStill): Promise<CourtFit | null> {
  try {
    const bytes = await new File(still.uri).bytes();
    const img = decode(bytes, { useTArray: true, formatAsRGBA: true });
    return detectCourt({ width: img.width, height: img.height, data: img.data });
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

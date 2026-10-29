// Where Ball Boi keeps match video on the phone until the server has it.
//
// The camera writes into the cache folder, which iOS can clear when space is
// low. Spec (After the match): "video stays on the phone until the server
// confirms", so every recording moves into the app's documents folder as
// soon as it stops, and is deleted only after the upload is confirmed.

import { Directory, File, Paths } from "expo-file-system";

const FOLDER = "recordings";

function recordingsDir(): Directory {
  const dir = new Directory(Paths.document, FOLDER);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Moves a finished recording out of the cache. Returns its new location and size. */
export function keepRecording(cacheUri: string, name: string): { uri: string; sizeBytes: number } {
  const source = new File(cacheUri);
  const ext = source.extension || ".mov";
  const target = new File(recordingsDir(), `${name}${ext}`);
  if (target.exists) target.delete();
  source.move(target);
  return { uri: target.uri, sizeBytes: target.size ?? 0 };
}

/** Deletes a recording from the phone. Missing files are fine. */
export function deleteRecording(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone.
  }
}

/** True when the recording is still on the phone. */
export function recordingExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/** Free space on the phone, in bytes. */
export function freeDiskBytes(): number {
  return Paths.availableDiskSpace;
}

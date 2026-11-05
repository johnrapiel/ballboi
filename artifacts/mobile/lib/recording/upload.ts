// Sends one finished recording to Ball Boi for analysis (Wave 1 review D4).
//
// Storage takes at most 5 GB in one PUT, and an hour of match is 2.3 to
// 3.6 GB, so each piece of a recording goes up as a multipart upload: 64 MB
// parts, each on its own presigned address, each sent in an iOS background
// URL session so it keeps going when the app is put away. Storage remembers
// the parts it has, so after a dropped connection or a closed app only the
// missing parts are sent: the Wi-Fi used stays about one file's size.
//
// Each part is copied to a temporary file first, because the background
// upload sends whole files. The copy goes 4 MB at a time, so memory stays
// small, and the temporary file is deleted as soon as its part is sent.
//
// The video is analysis input only: nothing here, or anywhere in the app,
// ever plays it back.

import {
  completeBallBoiMultipartUpload,
  completeBallBoiSession,
  requestBallBoiUploadPartUrl,
  startBallBoiMultipartUpload,
  startBallBoiSession,
  type BallBoiSessionSegment,
} from "@workspace/api-client-react";
import { Directory, File, FileMode, Paths, UploadType } from "expo-file-system";

import { joinSegments, recordingFiles, type RecordedSegment } from "@/lib/recording/segments";

const MAX_INT32 = 2_147_483_647;
const COPY_CHUNK_BYTES = 4 * 1024 * 1024;
/** Tries per part before the upload is marked failed (it picks up from the missing parts later). */
const PART_TRIES = 3;

export interface RecordingToUpload {
  id: string;
  matchId: number;
  /** Set once the server has a session for this recording. */
  sessionId?: number | null;
  uri: string;
  sizeBytes: number;
  durationSeconds: number;
  recordedAt: string;
  segments?: RecordedSegment[];
}

/** Creates the server's record of this recording. Safe to call once per recording. */
export async function ensureSession(rec: RecordingToUpload): Promise<number> {
  if (rec.sessionId) return rec.sessionId;
  // recordedAt: the card's day label is when the match was recorded, not when it uploaded (D19).
  const session = await startBallBoiSession(rec.matchId, { metadata: { source: "ios" }, recordedAt: rec.recordedAt });
  return session.id;
}

/** The server's answer to a refused call, when it sent one. */
function errorData(e: unknown): { status: number; data: Record<string, unknown> } | null {
  if (!e || typeof e !== "object" || !("status" in e)) return null;
  const status = (e as { status: unknown }).status;
  const data = (e as { data?: unknown }).data;
  if (typeof status !== "number") return null;
  return { status, data: data && typeof data === "object" ? (data as Record<string, unknown>) : {} };
}

/** Thrown when the server already has this recording: the phone's copy is done. */
class AlreadyUploaded extends Error {}

function partsDir(): Directory {
  const dir = new Directory(Paths.cache, "ballboi-parts");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Copies bytes [start, start + length) of `source` into a new temporary file. */
async function copyPart(source: File, start: number, length: number, name: string): Promise<File> {
  const target = new File(partsDir(), name);
  if (target.exists) target.delete();
  target.create();
  const input = source.open(FileMode.ReadOnly);
  const output = target.open(FileMode.WriteOnly);
  try {
    input.offset = start;
    let left = length;
    while (left > 0) {
      const bytes = await input.readBytes(Math.min(COPY_CHUNK_BYTES, left));
      if (bytes.length === 0) break;
      await output.writeBytes(bytes);
      left -= bytes.length;
    }
    if (left > 0) throw new Error("The recording on this phone is shorter than expected.");
  } finally {
    input.close();
    output.close();
  }
  return target;
}

function removeFile(f: File) {
  try {
    if (f.exists) f.delete();
  } catch {
    // Cache; iOS clears it anyway.
  }
}

/** Sends one part, with a fresh address each try. */
async function sendPart(
  sessionId: number,
  segment: number,
  partNumber: number,
  file: File,
  signal?: AbortSignal,
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < PART_TRIES; attempt++) {
    if (signal?.aborted) throw new Error("Discarded.");
    try {
      const { url } = await requestBallBoiUploadPartUrl(sessionId, { segment, partNumber });
      const result = await file.upload(url, {
        httpMethod: "PUT",
        uploadType: UploadType.BINARY_CONTENT,
        sessionType: "background",
        signal,
      });
      if (result.status >= 200 && result.status < 300) return;
      lastError = new Error(`Upload failed (${result.status}). Your match is still on this phone.`);
    } catch (e) {
      if (errorData(e)?.data.uploaded) throw new AlreadyUploaded();
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Upload failed. Your match is still on this phone.");
}

/** Sends one piece of the recording in parts and has storage join them. Returns its stored path. */
async function uploadSegment(
  rec: { id: string; sessionId: number },
  segment: number,
  uri: string,
  signal?: AbortSignal,
): Promise<{ objectPath: string; sizeBytes: number }> {
  const source = new File(uri);
  const sizeBytes = source.size ?? 0;
  if (sizeBytes <= 0) throw new Error("The recording on this phone is empty.");

  for (let round = 0; round < 3; round++) {
    let upload;
    try {
      upload = await startBallBoiMultipartUpload(rec.sessionId, { segment, sizeBytes });
    } catch (e) {
      if (errorData(e)?.data.uploaded) throw new AlreadyUploaded();
      throw e;
    }
    if (upload.completed) return { objectPath: upload.objectPath, sizeBytes };

    // Only the parts storage doesn't have yet.
    for (const partNumber of upload.missingParts) {
      if (signal?.aborted) throw new Error("Discarded.");
      const start = (partNumber - 1) * upload.partSize;
      const length = Math.min(upload.partSize, sizeBytes - start);
      const part = await copyPart(source, start, length, `${rec.id}-${segment}-${partNumber}.part`);
      try {
        await sendPart(rec.sessionId, segment, partNumber, part, signal);
      } finally {
        removeFile(part);
      }
    }

    if (signal?.aborted) throw new Error("Discarded.");
    try {
      const done = await completeBallBoiMultipartUpload(rec.sessionId, { segment });
      return { objectPath: done.objectPath, sizeBytes };
    } catch (e) {
      const err = errorData(e);
      if (err?.data.uploaded) throw new AlreadyUploaded();
      // A part went missing, or storage dropped an old unfinished upload: go round again.
      if (err?.status === 409 && (err.data.restart || Array.isArray(err.data.missingParts))) continue;
      throw e;
    }
  }
  throw new Error("Upload failed. Your match is still on this phone.");
}

/**
 * Uploads every piece and tells the server the match is ready to analyze.
 * Resolves once the server has confirmed it; only then is it safe to delete
 * the files. Telling the server twice is safe: it starts analysis once.
 */
export async function uploadRecording(
  rec: RecordingToUpload & { sessionId: number },
  signal?: AbortSignal,
): Promise<void> {
  const files = recordingFiles(rec);
  const sent: BallBoiSessionSegment[] = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const piece = await uploadSegment(rec, i, files[i], signal);
      const duration = rec.segments?.[i]?.durationSeconds ?? rec.durationSeconds;
      sent.push({
        objectPath: piece.objectPath,
        sizeBytes: Math.min(piece.sizeBytes, MAX_INT32),
        durationSeconds: Math.max(1, Math.round(duration)),
      });
    }
  } catch (e) {
    // The server already has the whole match (an earlier try finished): done.
    if (e instanceof AlreadyUploaded) return;
    throw e;
  }
  // Discarded while the file was going up: don't tell the server it's ready.
  if (signal?.aborted) throw new Error("Discarded.");
  const totals = rec.segments?.length ? joinSegments(rec.segments) : null;
  const totalBytes = files.reduce((s, uri) => s + (new File(uri).size ?? 0), 0);
  await completeBallBoiSession(rec.sessionId, {
    objectPath: sent[0].objectPath,
    contentType: "video/quicktime",
    // ball_boi_sessions.video_size_bytes is a 32-bit integer; the size is informational only.
    sizeBytes: Math.min(totalBytes, MAX_INT32),
    durationSeconds: totals?.durationSeconds ?? rec.durationSeconds,
    segments: sent,
  });
}

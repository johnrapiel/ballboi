// Sends one finished recording to Ball Boi for analysis.
//
// The file goes straight from the phone to storage with a presigned PUT, in an
// iOS background URL session, so a long match keeps uploading if the app is
// put away. The video is analysis input only: nothing here, or anywhere in the
// app, ever plays it back.

import {
  completeBallBoiSession,
  requestBallBoiUploadUrl,
  startBallBoiSession,
} from "@workspace/api-client-react";
import { File, UploadType } from "expo-file-system";

const MAX_INT32 = 2_147_483_647;

export interface RecordingToUpload {
  matchId: number;
  /** Set once the server has a session for this recording. */
  sessionId?: number | null;
  uri: string;
  sizeBytes: number;
  durationSeconds: number;
}

/** Creates the server's record of this recording. Safe to call once per recording. */
export async function ensureSession(rec: RecordingToUpload): Promise<number> {
  if (rec.sessionId) return rec.sessionId;
  const session = await startBallBoiSession(rec.matchId, { metadata: { source: "ios" } });
  return session.id;
}

/**
 * Uploads the file and tells the server it's ready to analyze. Resolves once
 * the server has confirmed it; only then is it safe to delete the file.
 */
export async function uploadRecording(rec: RecordingToUpload & { sessionId: number }): Promise<void> {
  // Ask for the upload address right before sending: it expires after 15 minutes.
  const { uploadURL, objectPath } = await requestBallBoiUploadUrl(rec.sessionId);
  const result = await new File(rec.uri).upload(uploadURL, {
    httpMethod: "PUT",
    uploadType: UploadType.BINARY_CONTENT,
    sessionType: "background",
    headers: { "Content-Type": "video/quicktime" },
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Upload failed (${result.status}). Your match is still on this phone.`);
  }
  await completeBallBoiSession(rec.sessionId, {
    objectPath,
    contentType: "video/quicktime",
    // ball_boi_sessions.video_size_bytes is a 32-bit integer, so files over
    // 2 GB (about 35 minutes of 720p at the high end, an hour at the low end)
    // would fail here. Capped until the column is widened to bigint; the size
    // is informational only.
    sizeBytes: Math.min(rec.sizeBytes, MAX_INT32),
    durationSeconds: rec.durationSeconds,
  });
}

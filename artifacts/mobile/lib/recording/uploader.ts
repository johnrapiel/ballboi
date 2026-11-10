// Works through the upload queue, one recording at a time.
//
// - Wi-Fi by default; cellular only when the setting is on, or for one
//   recording when someone taps "Upload now on cellular".
// - Each part goes up in an iOS background URL session, so it keeps going
//   when the app is put away. If the app is closed mid-upload, it picks up
//   from the parts storage doesn't have yet the next time the app opens.
// - The file is deleted only after the server confirms.

import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import * as Network from "expo-network";
import { useEffect } from "react";
import { AppState } from "react-native";

import { discardOnServer, DiscardError } from "@/lib/recording/api";
import { deleteRecording, recordingExists } from "@/lib/recording/files";
import { loadUploadOnCellular } from "@/lib/recording/prefs";
import { clearQueue, getQueue, loadQueue, removeQueued, updateQueued, type QueuedRecording } from "@/lib/recording/queue";
import { recordingFiles } from "@/lib/recording/segments";
import { deleteSidecar } from "@/lib/recording/sidecarFile";
import { ensureSession, uploadRecording, uploadSidecar } from "@/lib/recording/upload";

/** Deletes a recording's sidecar from the phone. */
function deleteSidecarOf(rec: Pick<QueuedRecording, "sidecarUri">) {
  deleteSidecar(rec.sidecarUri);
}

/** Deletes every file of a recording from the phone. */
export function deleteRecordingFiles(rec: Pick<QueuedRecording, "uri" | "segments"> & { sidecarUri?: string }) {
  for (const uri of recordingFiles(rec)) deleteRecording(uri);
  deleteSidecarOf(rec);
}

export type Connection = "wifi" | "cellular" | "none";

export async function currentConnection(): Promise<Connection> {
  try {
    const s = await Network.getNetworkStateAsync();
    if (!s.isConnected || s.isInternetReachable === false) return "none";
    if (s.type === Network.NetworkStateType.WIFI || s.type === Network.NetworkStateType.ETHERNET) return "wifi";
    if (s.type === Network.NetworkStateType.CELLULAR) return "cellular";
    // Unknown types (VPN, other): treat like Wi-Fi rather than stall forever.
    return "wifi";
  } catch {
    return "none";
  }
}

/** True when this recording may upload on the current connection. */
export function mayUpload(rec: QueuedRecording, connection: Connection, cellularOn: boolean): boolean {
  if (connection === "none") return false;
  if (connection === "wifi") return true;
  return cellularOn || !!rec.allowCellular;
}

/** Wait this long before retrying a failed upload on its own. */
const RETRY_AFTER_MS = 60_000;

/** Uploads in progress, so Discard can stop one and wait for it to settle. */
const inFlight = new Map<string, { abort: AbortController; done: Promise<void> }>();
/** Recordings being discarded: the queue leaves them alone. */
const discarding = new Set<string>();

let running = false;
let again = false;
let onUploaded: (() => Promise<unknown>) | null = null;

/** Uploads everything that can go now. Safe to call any time; overlapping calls merge. */
export async function drainQueue(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      await loadQueue();
      const cellularOn = await loadUploadOnCellular();
      for (const rec of getQueue()) {
        if (rec.state === "uploading" || discarding.has(rec.id)) continue;
        // The player is still fixing the court lines for this match.
        if (rec.courtLinesPending) continue;
        // Cleared meanwhile (sign-out or Delete account).
        if (!getQueue().some((r) => r.id === rec.id)) continue;
        // A failed upload tries again on the next trigger (Wi-Fi back, app reopened), not in a tight loop.
        if (rec.state === "failed" && rec.failedAt && Date.now() - new Date(rec.failedAt).getTime() < RETRY_AFTER_MS) {
          continue;
        }
        if (!recordingFiles(rec).every(recordingExists)) {
          // A file is gone (deleted outside the app); the match can't be sent whole.
          // A server session for it then shows as "Didn't upload" with Remove (D18).
          deleteRecordingFiles(rec);
          await removeQueued(rec.id);
          continue;
        }
        const connection = await currentConnection();
        // The sidecar is small: it goes on any connection, ahead of the video (decision T5).
        if (connection !== "none" && rec.sidecarUri && rec.sidecarDirty) await sendSidecar(rec);
        if (!mayUpload(rec, connection, cellularOn)) continue;
        const latest = getQueue().find((r) => r.id === rec.id);
        if (latest) await uploadOne(latest);
      }
    } while (again);
  } finally {
    running = false;
  }
}

/**
 * Sends a recording's sidecar: creates the server's session for it first if
 * needed (the same session the video goes to). A failure never holds up the
 * video; it's tried again on the next pass while the recording is queued.
 */
async function sendSidecar(rec: QueuedRecording) {
  if (!rec.sidecarUri || discarding.has(rec.id)) return;
  try {
    const sessionId = await ensureSession(rec);
    if (sessionId !== rec.sessionId) await updateQueued(rec.id, { sessionId });
    // Marked clean first: a change made while it's sending marks it dirty again.
    await updateQueued(rec.id, { sidecarDirty: false });
    const sent = await uploadSidecar(sessionId, rec.sidecarUri);
    if (!sent) return;
  } catch {
    if (getQueue().some((r) => r.id === rec.id)) await updateQueued(rec.id, { sidecarDirty: true });
  }
}

async function uploadOne(rec: QueuedRecording) {
  const abort = new AbortController();
  const done = uploadWith(rec, abort.signal);
  inFlight.set(rec.id, { abort, done });
  try {
    await done;
  } finally {
    inFlight.delete(rec.id);
  }
}

async function uploadWith(rec: QueuedRecording, signal: AbortSignal) {
  await updateQueued(rec.id, { state: "uploading", error: undefined });
  try {
    const sessionId = await ensureSession(rec);
    if (sessionId !== rec.sessionId) await updateQueued(rec.id, { sessionId });
    if (signal.aborted) return;
    await uploadRecording({ ...rec, sessionId }, signal);
    // The sidecar changed while the video went up (the score prompt's conditions): send the newest copy.
    const latest = getQueue().find((r) => r.id === rec.id);
    if (latest?.sidecarDirty) await sendSidecar({ ...latest, sessionId });
    // Refresh the server list first, so its card never shows a stale
    // "still waiting for the video" once the phone's card goes (D18).
    await onUploaded?.().catch(() => {});
    await removeQueued(rec.id);
    deleteRecordingFiles(rec);
  } catch (e) {
    // A discard stopped it on purpose; Discard decides what happens next.
    if (signal.aborted || discarding.has(rec.id)) return;
    await updateQueued(rec.id, {
      state: "failed",
      failedAt: new Date().toISOString(),
      allowCellular: false,
      error: e instanceof Error ? e.message : "Upload failed. Your match is still on this phone.",
    });
  }
}

/**
 * Discard on the processing card (coordinator note on #79, D2): stops an
 * upload in progress, then removes the server's session (and a placeholder
 * Quick match), then the file and the card. If the server can't be reached,
 * nothing is removed and the recording goes back to waiting, so a discard
 * never leaves half a recording behind. Throws with a message to show.
 */
export async function discardQueued(
  id: string,
  getToken: () => Promise<string | null>,
): Promise<{ matchRemoved: boolean }> {
  // Already gone, or a discard is already running for it (a second tap).
  if (!getQueue().some((r) => r.id === id) || discarding.has(id)) return { matchRemoved: false };
  discarding.add(id);
  try {
    const running = inFlight.get(id);
    if (running) {
      running.abort.abort();
      await running.done.catch(() => {});
    }
    // Read it again: the upload may have created a server session meanwhile.
    const rec = getQueue().find((r) => r.id === id);
    if (!rec) return { matchRemoved: false }; // It finished uploading first; the server card takes over.
    const result = await discardOnServer(rec.matchId, rec.sessionId ?? null, getToken);
    await removeQueued(id);
    deleteRecordingFiles(rec);
    onUploaded?.();
    return result;
  } catch (e) {
    if (e instanceof DiscardError && e.alreadyUploaded) {
      // The server has it: the phone's copy is done, and the server card takes over.
      const rec = getQueue().find((r) => r.id === id);
      await removeQueued(id);
      if (rec) deleteRecordingFiles(rec);
      onUploaded?.();
    } else {
      await updateQueued(id, { state: "waiting", error: undefined, failedAt: undefined });
    }
    throw e;
  } finally {
    discarding.delete(id);
  }
}

/**
 * Sign-out and Delete account (Wave 1 review A10): stops any upload, then
 * removes every recording waiting on this phone, files included, so nothing
 * from that account stays on the phone or uploads later.
 */
export async function clearUploadQueue(): Promise<void> {
  for (const { abort } of inFlight.values()) abort.abort();
  const removed = await clearQueue();
  for (const rec of removed) deleteRecordingFiles(rec);
}

/** "Upload now on cellular" for one recording. */
export async function uploadNowOnCellular(id: string) {
  await updateQueued(id, { allowCellular: true, state: "waiting", error: undefined, failedAt: undefined });
  drainQueue();
}

/** "Try again" after a failed upload, on whatever connection is allowed. */
export async function retryUpload(id: string) {
  await updateQueued(id, { state: "waiting", error: undefined, failedAt: undefined });
  drainQueue();
}

/**
 * Keeps the queue moving while the app is open: at launch, whenever the app
 * comes back to the foreground, and when the connection changes (joining
 * Wi-Fi starts waiting uploads). Mount once, inside the signed-in app.
 */
export function useUploadRunner() {
  const { isSignedIn } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isSignedIn) return;
    onUploaded = () => queryClient.invalidateQueries({ queryKey: ["recording", "sessions"] });
    drainQueue();
    const app = AppState.addEventListener("change", (s) => {
      if (s === "active") drainQueue();
    });
    const net = Network.addNetworkStateListener(() => drainQueue());
    return () => {
      onUploaded = null;
      app.remove();
      net.remove();
    };
  }, [isSignedIn, queryClient]);
}

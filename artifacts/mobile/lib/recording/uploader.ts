// Works through the upload queue, one recording at a time.
//
// - Wi-Fi by default; cellular only when the setting is on, or for one
//   recording when someone taps "Upload now on cellular".
// - Each file goes up in an iOS background URL session, so it keeps going
//   when the app is put away. If the app is closed mid-upload, it starts over
//   the next time the app opens.
// - The file is deleted only after the server confirms.

import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import * as Network from "expo-network";
import { useEffect } from "react";
import { AppState } from "react-native";

import { discardOnServer, DiscardError } from "@/lib/recording/api";
import { deleteRecording, recordingExists } from "@/lib/recording/files";
import { loadUploadOnCellular } from "@/lib/recording/prefs";
import { getQueue, loadQueue, removeQueued, updateQueued, type QueuedRecording } from "@/lib/recording/queue";
import { ensureSession, uploadRecording } from "@/lib/recording/upload";

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
let onUploaded: (() => void) | null = null;

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
        // A failed upload tries again on the next trigger (Wi-Fi back, app reopened), not in a tight loop.
        if (rec.state === "failed" && rec.failedAt && Date.now() - new Date(rec.failedAt).getTime() < RETRY_AFTER_MS) {
          continue;
        }
        if (!recordingExists(rec.uri)) {
          // The file is gone (deleted outside the app); nothing left to send.
          await removeQueued(rec.id);
          continue;
        }
        const connection = await currentConnection();
        if (!mayUpload(rec, connection, cellularOn)) continue;
        await uploadOne(rec);
      }
    } while (again);
  } finally {
    running = false;
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
    await removeQueued(rec.id);
    deleteRecording(rec.uri);
    onUploaded?.();
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
    deleteRecording(rec.uri);
    onUploaded?.();
    return result;
  } catch (e) {
    if (e instanceof DiscardError && e.alreadyUploaded) {
      // The server has it: the phone's copy is done, and the server card takes over.
      const rec = getQueue().find((r) => r.id === id);
      await removeQueued(id);
      if (rec) deleteRecording(rec.uri);
      onUploaded?.();
    } else {
      await updateQueued(id, { state: "waiting", error: undefined, failedAt: undefined });
    }
    throw e;
  } finally {
    discarding.delete(id);
  }
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

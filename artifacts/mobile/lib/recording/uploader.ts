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
        if (rec.state === "uploading") continue;
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
  await updateQueued(rec.id, { state: "uploading", error: undefined });
  try {
    const sessionId = await ensureSession(rec);
    if (sessionId !== rec.sessionId) await updateQueued(rec.id, { sessionId });
    await uploadRecording({ ...rec, sessionId });
    await removeQueued(rec.id);
    deleteRecording(rec.uri);
    onUploaded?.();
  } catch (e) {
    await updateQueued(rec.id, {
      state: "failed",
      failedAt: new Date().toISOString(),
      allowCellular: false,
      error: e instanceof Error ? e.message : "Upload failed. Your match is still on this phone.",
    });
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

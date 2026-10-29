// Recordings waiting to reach the server (spec: Ball Boi > After the match,
// Upload). Kept on the phone and in this list until the server confirms, so
// a recording survives the app closing, a restart, or no Wi-Fi for days.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

export type UploadState = "waiting" | "uploading" | "failed";

export interface QueuedRecording {
  /** Local id, also the file name. */
  id: string;
  matchId: number;
  opponentName: string;
  uri: string;
  sizeBytes: number;
  durationSeconds: number;
  recordedAt: string;
  /** Server session, once created. Reused on retry so one match never gets two. */
  sessionId: number | null;
  state: UploadState;
  error?: string;
  /** When the last upload attempt failed. */
  failedAt?: string;
  /** Upload this one on cellular even though the setting is Wi-Fi only. */
  allowCellular?: boolean;
}

const KEY = "ballboi.recording.queue.v1";

let items: QueuedRecording[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

async function persist() {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Kept in memory; the next write tries again.
  }
}

/**
 * Reads the saved list once per launch. Anything that was mid-upload when
 * the app closed goes back to waiting and starts over with a fresh address.
 */
export async function loadQueue(): Promise<QueuedRecording[]> {
  if (loaded) return items;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as QueuedRecording[]) : [];
    items = saved.map((r) => (r.state === "uploading" ? { ...r, state: "waiting" as const } : r));
  } catch {
    items = [];
  }
  loaded = true;
  emit();
  return items;
}

export function getQueue(): QueuedRecording[] {
  return items;
}

export async function enqueue(rec: Omit<QueuedRecording, "state" | "sessionId"> & { sessionId?: number | null }) {
  await loadQueue();
  items = [...items.filter((r) => r.id !== rec.id), { ...rec, sessionId: rec.sessionId ?? null, state: "waiting" }];
  emit();
  await persist();
}

export async function updateQueued(id: string, patch: Partial<QueuedRecording>) {
  items = items.map((r) => (r.id === id ? { ...r, ...patch } : r));
  emit();
  await persist();
}

export async function removeQueued(id: string) {
  items = items.filter((r) => r.id !== id);
  emit();
  await persist();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Live list of recordings still on this phone. */
export function useQueue(): QueuedRecording[] {
  return useSyncExternalStore(subscribe, getQueue, getQueue);
}

/** One queued recording by local id, or undefined once it's on the server. */
export function useQueuedRecording(id: string | null): QueuedRecording | undefined {
  const all = useQueue();
  return id ? all.find((r) => r.id === id) : undefined;
}

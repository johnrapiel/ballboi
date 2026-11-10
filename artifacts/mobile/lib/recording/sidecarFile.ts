// Where a recording's sidecar lives on the phone (decision T5), and the writer
// the camera screen feeds while it records.
//
// The file is rewritten whole, a few seconds apart and at every important
// moment (capture start, a pause, a lock, the stop). Each write goes to a
// temporary file first and then replaces the old one, so whatever happens
// (a crash, the battery dying, a force quit) the file on the phone is always
// complete JSON covering up to its last write.

import { Directory, File, Paths } from "expo-file-system";

import { parseSidecar, serializeSidecar, type Sidecar } from "@/lib/recording/sidecar";

const FOLDER = "sidecars";
/** Longest gap between writes while something changed. */
const WRITE_EVERY_MS = 5_000;

function dir(): Directory {
  const d = new Directory(Paths.document, FOLDER);
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

/** The sidecar's file for a recording id (the queue's id). */
export function sidecarUri(recId: string): string {
  return new File(dir(), `${recId}.json`).uri;
}

/** Writes the whole sidecar safely. Never throws: a failed write is retried on the next change. */
export function writeSidecar(uri: string, sc: Sidecar): boolean {
  try {
    const target = new File(uri);
    const temp = new File(`${uri}.tmp`);
    temp.write(serializeSidecar(sc));
    temp.move(target, { overwrite: true });
    return true;
  } catch {
    return false;
  }
}

/** The saved sidecar, or null when it's missing or unreadable. */
export async function readSidecar(uri: string): Promise<Sidecar | null> {
  for (const u of [uri, `${uri}.tmp`]) {
    try {
      const f = new File(u);
      if (!f.exists) continue;
      const sc = parseSidecar(await f.text());
      if (sc) return sc;
    } catch {
      // Try the next.
    }
  }
  return null;
}

/** Changes a saved sidecar after the stop (the court-line fix, the score prompt's conditions). */
export async function updateSidecar(uri: string, change: (sc: Sidecar) => Sidecar): Promise<boolean> {
  const sc = await readSidecar(uri);
  if (!sc) return false;
  return writeSidecar(uri, change(sc));
}

export function deleteSidecar(uri: string | null | undefined) {
  if (!uri) return;
  for (const u of [uri, `${uri}.tmp`]) {
    try {
      const f = new File(u);
      if (f.exists) f.delete();
    } catch {
      // Already gone.
    }
  }
}

/**
 * Holds the sidecar while the camera screen is open. `apply` changes it in
 * memory; the file is written at most every 5 seconds, or at once with
 * `flush` (capture start, pauses, the stop). Before the first piece has a
 * name, nothing is written: there's no recording to go with it yet.
 */
export class SidecarWriter {
  private sc: Sidecar;
  private uri: string | null = null;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(initial: Sidecar) {
    this.sc = initial;
  }

  get current(): Sidecar {
    return this.sc;
  }

  get fileUri(): string | null {
    return this.uri;
  }

  /** Names the file once the recording has an id, and writes it straight away. */
  attach(recId: string): string {
    if (!this.uri) this.uri = sidecarUri(recId);
    this.flush();
    return this.uri;
  }

  apply(change: (sc: Sidecar) => Sidecar, urgent = false) {
    const next = change(this.sc);
    if (next === this.sc) return;
    this.sc = next;
    this.dirty = true;
    if (urgent) this.flush();
    else this.schedule();
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.uri) return;
    if (writeSidecar(this.uri, this.sc)) this.dirty = false;
  }

  private schedule() {
    if (this.timer || !this.uri) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.dirty) this.flush();
    }, WRITE_EVERY_MS);
  }

  /** Stops the timer (the screen is going). Writes anything pending first. */
  close() {
    if (this.dirty) this.flush();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

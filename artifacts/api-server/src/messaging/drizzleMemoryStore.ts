import { db, messagingMemorySnapshotTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { MemorySnapshot, MemoryStore } from "./memoryProvider";

/**
 * Saves the in-memory provider's messages in Postgres, so staging keeps its
 * chats when the API container sleeps or redeploys (its disk is wiped then).
 * One row, rewritten on each change: fine for a beta's worth of messages.
 */
export class DrizzleMemoryStore implements MemoryStore {
  constructor(private readonly key = "default") {}

  async load(): Promise<MemorySnapshot | null> {
    const [row] = await db
      .select({ data: messagingMemorySnapshotTable.data })
      .from(messagingMemorySnapshotTable)
      .where(eq(messagingMemorySnapshotTable.key, this.key));
    return row ? (row.data as MemorySnapshot) : null;
  }

  async save(snapshot: MemorySnapshot): Promise<void> {
    const now = new Date();
    await db
      .insert(messagingMemorySnapshotTable)
      .values({ key: this.key, data: snapshot, updatedAt: now })
      .onConflictDoUpdate({ target: messagingMemorySnapshotTable.key, set: { data: snapshot, updatedAt: now } });
  }
}

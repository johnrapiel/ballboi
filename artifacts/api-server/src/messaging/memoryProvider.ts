import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SYSTEM_SENDER, type MessagingProvider, type ProviderMessage, type SendInput } from "./provider";

type Channel = { members: string[]; messages: ProviderMessage[] };

/** Every channel and its messages, as saved: dates as ISO strings. */
export type MemorySnapshot = Record<string, { members: string[]; messages: (Omit<ProviderMessage, "createdAt"> & { createdAt: string })[] }>;

/**
 * Somewhere outside the API process to keep the messages, so they survive a
 * restart. Staging uses the database (drizzleMemoryStore): its container
 * loses its disk every time it sleeps or deploys.
 */
export interface MemoryStore {
  /** The saved messages, or null when nothing is saved yet. Throws when the store can't be read. */
  load(): Promise<MemorySnapshot | null>;
  save(snapshot: MemorySnapshot): Promise<void>;
}

type Log = { warn: (o: object, m: string) => void; info?: (o: object, m: string) => void };

/**
 * Keeps messages in memory. Used in development (no Stream keys needed), on
 * staging until it has Stream keys, and in tests. Conversation records live
 * in the database, so without somewhere to save them a restart of the API
 * kept the chats in Messages (with their last-message preview) but emptied
 * every chat when opened (John, Nov 10). With `file` or `store`, messages are
 * also saved there and read back on start, so chats keep their history.
 */
export class MemoryMessagingProvider implements MessagingProvider {
  readonly name = "memory" as const;
  private channels = new Map<string, Channel>();
  private byId = new Map<string, ProviderMessage>();
  private clock: () => Date;
  private file: string | null;
  private store: MemoryStore | null;
  private log: Log | null;
  /** Resolves once saved messages are loaded. Every call waits for it. */
  readonly ready: Promise<void>;
  /** False when the store couldn't be read: then nothing is saved, so the saved history is never overwritten. */
  private canSave = true;
  private saving: Promise<void> = Promise.resolve();
  private saveQueued = false;

  constructor(opts: { now?: () => Date; file?: string; store?: MemoryStore; log?: Log; retryDelayMs?: number } = {}) {
    this.clock = opts.now ?? (() => new Date());
    this.file = opts.file ?? null;
    this.store = opts.store ?? null;
    this.log = opts.log ?? null;
    this.load();
    this.ready = this.store ? this.loadStore(opts.retryDelayMs ?? 2_000) : Promise.resolve();
  }

  private restore(saved: MemorySnapshot) {
    for (const [channelId, ch] of Object.entries(saved)) {
      const messages = ch.messages.map((m) => ({ ...m, createdAt: new Date(m.createdAt) }));
      this.channels.set(channelId, { members: ch.members, messages });
      for (const m of messages) this.byId.set(m.id, m);
    }
  }

  private load() {
    if (!this.file) return;
    let saved: MemorySnapshot;
    try {
      saved = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      return; // No file yet, or unreadable: start empty.
    }
    this.restore(saved);
  }

  /** Reads the store, trying a few times. If it never answers, keeps running but never saves over it. */
  private async loadStore(retryDelayMs: number) {
    const store = this.store!;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        const saved = await store.load();
        if (saved) this.restore(saved);
        this.log?.info?.({ channels: this.channels.size, messages: this.byId.size }, "Messaging: saved messages loaded");
        return;
      } catch (err) {
        this.log?.warn({ err, attempt }, "Messaging: couldn't load saved messages");
        if (attempt < 5) await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
      }
    }
    this.canSave = false;
    this.log?.warn({}, "Messaging: saved messages never loaded; not saving, so they aren't overwritten. Restart the API.");
  }

  private snapshot(): MemorySnapshot {
    return JSON.parse(JSON.stringify(Object.fromEntries(this.channels))) as MemorySnapshot;
  }

  private save() {
    if (this.file) {
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.channels)));
        renameSync(tmp, this.file);
      } catch {
        // Best effort: messages still work in memory.
      }
    }
    if (this.store && this.canSave) {
      // One save at a time, in order; saves asked for while one runs fold into the next.
      if (this.saveQueued) return;
      this.saveQueued = true;
      const store = this.store;
      this.saving = this.saving.then(async () => {
        this.saveQueued = false;
        try {
          await store.save(this.snapshot());
        } catch (err) {
          this.log?.warn({ err }, "Messaging: couldn't save messages");
        }
      });
    }
  }

  /** Waits for saves in flight. For tests and shutdown. */
  async flush(): Promise<void> {
    await this.ready;
    await this.saving;
  }

  async ensureChannel(channelId: string, members: string[]): Promise<void> {
    await this.ready;
    if (this.channels.has(channelId)) return;
    this.channels.set(channelId, { members: [...new Set(members)], messages: [] });
    this.save();
  }

  async addMembers(channelId: string, userIds: string[]): Promise<void> {
    await this.ready;
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error(`Unknown channel ${channelId}`);
    channel.members = [...new Set([...channel.members, ...userIds])];
    this.save();
  }

  async removeMembers(channelId: string, userIds: string[]): Promise<void> {
    await this.ready;
    const channel = this.channels.get(channelId);
    if (!channel) return;
    channel.members = channel.members.filter((m) => !userIds.includes(m));
    this.save();
  }

  /** For tests: who is in a channel. */
  membersOf(channelId: string): string[] {
    return [...(this.channels.get(channelId)?.members ?? [])];
  }

  async sendMessage(input: SendInput): Promise<ProviderMessage> {
    await this.ready;
    const existing = this.byId.get(input.messageId);
    if (existing) return existing;
    const channel = this.channels.get(input.channelId);
    if (!channel) throw new Error(`Unknown channel ${input.channelId}`);
    const system = input.system === true && input.senderId === SYSTEM_SENDER;
    if (!system && !channel.members.includes(input.senderId)) throw new Error("Sender is not in this channel");
    const message: ProviderMessage = {
      id: input.messageId,
      channelId: input.channelId,
      senderId: input.senderId,
      text: input.text,
      createdAt: this.clock(),
      hidden: false,
      ...(system ? { system: true } : {}),
      ...(!system && input.admin ? { admin: true } : {}),
      ...(!system && input.mentions?.length ? { mentions: [...input.mentions] } : {}),
    };
    channel.messages.push(message);
    this.byId.set(message.id, message);
    this.save();
    return message;
  }

  async listMessages(channelId: string, opts: { limit?: number; before?: string } = {}): Promise<ProviderMessage[]> {
    await this.ready;
    const all = this.channels.get(channelId)?.messages ?? [];
    const end = opts.before ? all.findIndex((m) => m.id === opts.before) : all.length;
    const stop = end < 0 ? all.length : end;
    const limit = opts.limit ?? 50;
    return all.slice(Math.max(0, stop - limit), stop).map((m) => ({ ...m }));
  }

  async getMessage(messageId: string): Promise<ProviderMessage | null> {
    await this.ready;
    const m = this.byId.get(messageId);
    return m ? { ...m } : null;
  }

  async setHidden(messageId: string, hidden: boolean): Promise<void> {
    await this.ready;
    const m = this.byId.get(messageId);
    if (m) {
      m.hidden = hidden;
      this.save();
    }
  }

  async deleteUserData(userId: string): Promise<void> {
    await this.ready;
    for (const channel of this.channels.values()) {
      channel.messages = channel.messages.filter((m) => {
        if (m.senderId !== userId) return true;
        this.byId.delete(m.id);
        return false;
      });
    }
    this.save();
  }
}

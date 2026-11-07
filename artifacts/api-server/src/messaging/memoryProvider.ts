import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { MessagingProvider, ProviderMessage } from "./provider";

type Channel = { members: [string, string]; messages: ProviderMessage[] };

/**
 * Keeps messages in memory. Used in development (no Stream keys needed) and in
 * tests. Conversation records live in the database, so without `file` a
 * restart of the API kept the chats in Messages (with their last-message
 * preview) but emptied every chat when opened. With `file`, messages are also
 * saved there and read back on start, so chats keep their history.
 */
export class MemoryMessagingProvider implements MessagingProvider {
  readonly name = "memory" as const;
  private channels = new Map<string, Channel>();
  private byId = new Map<string, ProviderMessage>();
  private clock: () => Date;
  private file: string | null;

  constructor(opts: { now?: () => Date; file?: string } = {}) {
    this.clock = opts.now ?? (() => new Date());
    this.file = opts.file ?? null;
    this.load();
  }

  private load() {
    if (!this.file) return;
    let saved: Record<string, { members: [string, string]; messages: (Omit<ProviderMessage, "createdAt"> & { createdAt: string })[] }>;
    try {
      saved = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      return; // No file yet, or unreadable: start empty.
    }
    for (const [channelId, ch] of Object.entries(saved)) {
      const messages = ch.messages.map((m) => ({ ...m, createdAt: new Date(m.createdAt) }));
      this.channels.set(channelId, { members: ch.members, messages });
      for (const m of messages) this.byId.set(m.id, m);
    }
  }

  private save() {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.channels)));
      renameSync(tmp, this.file);
    } catch {
      // Best effort: messages still work in memory.
    }
  }

  async ensureChannel(channelId: string, members: [string, string]): Promise<void> {
    if (this.channels.has(channelId)) return;
    this.channels.set(channelId, { members, messages: [] });
    this.save();
  }

  async sendMessage(input: { channelId: string; messageId: string; senderId: string; text: string }): Promise<ProviderMessage> {
    const existing = this.byId.get(input.messageId);
    if (existing) return existing;
    const channel = this.channels.get(input.channelId);
    if (!channel) throw new Error(`Unknown channel ${input.channelId}`);
    if (!channel.members.includes(input.senderId)) throw new Error("Sender is not in this channel");
    const message: ProviderMessage = {
      id: input.messageId,
      channelId: input.channelId,
      senderId: input.senderId,
      text: input.text,
      createdAt: this.clock(),
      hidden: false,
    };
    channel.messages.push(message);
    this.byId.set(message.id, message);
    this.save();
    return message;
  }

  async listMessages(channelId: string, opts: { limit?: number; before?: string } = {}): Promise<ProviderMessage[]> {
    const all = this.channels.get(channelId)?.messages ?? [];
    const end = opts.before ? all.findIndex((m) => m.id === opts.before) : all.length;
    const stop = end < 0 ? all.length : end;
    const limit = opts.limit ?? 50;
    return all.slice(Math.max(0, stop - limit), stop).map((m) => ({ ...m }));
  }

  async getMessage(messageId: string): Promise<ProviderMessage | null> {
    const m = this.byId.get(messageId);
    return m ? { ...m } : null;
  }

  async setHidden(messageId: string, hidden: boolean): Promise<void> {
    const m = this.byId.get(messageId);
    if (m) {
      m.hidden = hidden;
      this.save();
    }
  }

  async deleteUserData(userId: string): Promise<void> {
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

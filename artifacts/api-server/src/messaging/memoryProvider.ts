import type { MessagingProvider, ProviderMessage } from "./provider";

/**
 * Keeps messages in memory. Used in development (no Stream keys needed) and in
 * tests. Messages are lost when the API restarts; conversation records in the
 * database stay.
 */
export class MemoryMessagingProvider implements MessagingProvider {
  readonly name = "memory" as const;
  private channels = new Map<string, { members: [string, string]; messages: ProviderMessage[] }>();
  private byId = new Map<string, ProviderMessage>();
  private clock: () => Date;

  constructor(opts: { now?: () => Date } = {}) {
    this.clock = opts.now ?? (() => new Date());
  }

  async ensureChannel(channelId: string, members: [string, string]): Promise<void> {
    if (!this.channels.has(channelId)) this.channels.set(channelId, { members, messages: [] });
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
    if (m) m.hidden = hidden;
  }

  async deleteUserData(userId: string): Promise<void> {
    for (const channel of this.channels.values()) {
      channel.messages = channel.messages.filter((m) => {
        if (m.senderId !== userId) return true;
        this.byId.delete(m.id);
        return false;
      });
    }
  }
}

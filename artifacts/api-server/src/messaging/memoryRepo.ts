import type { ConversationPatch, ConversationRecord, MessagingRepo, NewConversation, PersonSummary } from "./repo";

/**
 * In-memory MessagingRepo for tests. Fill in people, connections, blocks and
 * restrictions directly, then run the service against it.
 */
export class MemoryMessagingRepo implements MessagingRepo {
  conversations: ConversationRecord[] = [];
  names = new Map<string, PersonSummary>();
  createdAt = new Map<string, Date>();
  connections = new Set<string>();
  blocks: [string, string][] = [];
  restricted = new Set<string>();
  playerAccounts = new Map<number, string>();
  private nextId = 1;
  private clock: () => Date;

  constructor(opts: { now?: () => Date } = {}) {
    this.clock = opts.now ?? (() => new Date());
  }

  connect(a: string, b: string) {
    this.connections.add([a, b].sort().join(":"));
  }

  async findByPair(pairKey: string) {
    return this.conversations.find((c) => c.pairKey === pairKey) ?? null;
  }

  async findById(id: number) {
    return this.conversations.find((c) => c.id === id) ?? null;
  }

  async create(input: NewConversation) {
    const existing = await this.findByPair(input.pairKey);
    if (existing) return existing;
    const rec: ConversationRecord = {
      ...input,
      id: this.nextId++,
      lastMessageAt: null,
      lastMessageText: null,
      lastSender: null,
      aUnread: 0,
      bUnread: 0,
      createdAt: this.clock(),
      acceptedAt: input.status === "active" ? this.clock() : null,
    };
    this.conversations.push(rec);
    return rec;
  }

  async update(id: number, patch: ConversationPatch) {
    const rec = this.conversations.find((c) => c.id === id);
    if (!rec) throw new Error(`No conversation ${id}`);
    Object.assign(rec, patch);
    return rec;
  }

  async recordMessage(id: number, input: { sender: string; text: string; at: Date }) {
    const rec = this.conversations.find((c) => c.id === id);
    if (!rec) throw new Error(`No conversation ${id}`);
    rec.lastMessageAt = input.at;
    rec.lastMessageText = input.text;
    rec.lastSender = input.sender;
    if (input.sender === rec.userA) rec.bUnread += 1;
    else rec.aUnread += 1;
    return rec;
  }

  async listFor(userId: string) {
    return this.conversations.filter((c) => c.userA === userId || c.userB === userId);
  }

  async countStartedSince(userId: string, since: Date) {
    return this.conversations.filter((c) => c.requester === userId && c.createdAt >= since).length;
  }

  async accountCreatedAt(userId: string) {
    return this.createdAt.get(userId) ?? null;
  }

  async areConnected(a: string, b: string) {
    return this.connections.has([a, b].sort().join(":"));
  }

  async blockedSetFor(userId: string) {
    const out = new Set<string>();
    for (const [x, y] of this.blocks) {
      if (x === userId) out.add(y);
      if (y === userId) out.add(x);
    }
    return out;
  }

  async restrictedSet(userIds: string[]) {
    return new Set(userIds.filter((id) => this.restricted.has(id)));
  }

  async people(userIds: string[]) {
    const out = new Map<string, PersonSummary>();
    for (const id of userIds) out.set(id, this.names.get(id) ?? { name: "Player", playerId: null });
    return out;
  }

  async accountForPlayer(playerId: number) {
    return this.playerAccounts.get(playerId) ?? null;
  }

  async contactsFor(userId: string) {
    const out: { userId: string; name: string; playerId: number | null }[] = [];
    for (const key of this.connections) {
      const [a, b] = key.split(":");
      const other = a === userId ? b : b === userId ? a : null;
      if (!other) continue;
      const p = this.names.get(other) ?? { name: "Player", playerId: null };
      out.push({ userId: other, ...p });
    }
    return out;
  }

  async deleteAllFor(userId: string) {
    this.conversations = this.conversations.filter((c) => c.userA !== userId && c.userB !== userId);
  }
}

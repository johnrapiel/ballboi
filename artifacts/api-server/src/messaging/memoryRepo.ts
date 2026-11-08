import type {
  ConversationPatch,
  ConversationRecord,
  GroupMember,
  GroupPatch,
  GroupRecord,
  MessagingRepo,
  NewConversation,
  NewGroup,
  PersonSummary,
} from "./repo";

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
  userAccounts = new Map<number, string>();
  groups: GroupRecord[] = [];
  members: GroupMember[] = [];
  /** Connections from a match an open match made, not yet played: they don't count in group chats. */
  openMatchOnly = new Set<string>();
  private nextId = 1;
  private nextGroupId = 1;
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

  async findByChannel(channelId: string) {
    return this.conversations.find((c) => c.channelId === channelId) ?? null;
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

  async areConnected(a: string, b: string, opts: { beyondOpenMatches?: boolean } = {}) {
    const key = [a, b].sort().join(":");
    if (opts.beyondOpenMatches && this.openMatchOnly.has(key)) return false;
    return this.connections.has(key);
  }

  async blockedSetFor(userId: string) {
    const out = new Set<string>();
    for (const [x, y] of this.blocks) {
      if (x === userId) out.add(y);
      if (y === userId) out.add(x);
    }
    return out;
  }

  async blockedByMe(userId: string) {
    const out = new Set<string>();
    for (const [x, y] of this.blocks) if (x === userId) out.add(y);
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

  async accountForUser(userId: number) {
    return this.userAccounts.get(userId) ?? null;
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
      const { name, playerId } = this.names.get(other) ?? { name: "Player", playerId: null };
      out.push({ userId: other, name, playerId });
    }
    return out;
  }

  async deleteAllFor(userId: string) {
    this.conversations = this.conversations.filter((c) => c.userA !== userId && c.userB !== userId);
  }

  // ─── Group chats ──────────────────────────────────────────────────────────

  async findGroup(id: number) {
    return this.groups.find((g) => g.id === id) ?? null;
  }

  async findGroupByChannel(channelId: string) {
    return this.groups.find((g) => g.channelId === channelId) ?? null;
  }

  async findGroupByOpenMatch(openMatchId: number) {
    return this.groups.find((g) => g.openMatchId === openMatchId) ?? null;
  }

  async createGroup(input: NewGroup) {
    const existing = await this.findGroupByChannel(input.channelId);
    if (existing) return existing;
    const g: GroupRecord = {
      ...input,
      id: this.nextGroupId++,
      open: true,
      closedReason: null,
      lastMessageAt: null,
      lastMessageText: null,
      lastSender: null,
      createdAt: this.clock(),
    };
    this.groups.push(g);
    return g;
  }

  async updateGroup(id: number, patch: GroupPatch) {
    const g = this.groups.find((x) => x.id === id);
    if (!g) throw new Error(`No group ${id}`);
    Object.assign(g, patch);
    return g;
  }

  async groupMembers(id: number) {
    return this.members.filter((m) => m.groupId === id);
  }

  async addGroupMembers(id: number, userIds: string[], at: Date) {
    for (const userId of userIds) {
      if (!this.members.some((m) => m.groupId === id && m.userId === userId)) {
        this.members.push({ groupId: id, userId, unread: 0, firstSentAt: null, joinedAt: at });
      }
    }
  }

  async removeGroupMembers(id: number, userIds: string[]) {
    this.members = this.members.filter((m) => m.groupId !== id || !userIds.includes(m.userId));
  }

  async recordGroupMessage(id: number, input: { sender: string | null; text: string; at: Date; recipients: string[] }) {
    const g = await this.updateGroup(id, { lastMessageAt: input.at, lastMessageText: input.text, lastSender: input.sender });
    for (const m of this.members) {
      if (m.groupId !== id) continue;
      if (input.recipients.includes(m.userId)) m.unread += 1;
      if (input.sender && m.userId === input.sender && !m.firstSentAt) m.firstSentAt = input.at;
    }
    return g;
  }

  async markGroupRead(id: number, userId: string) {
    for (const m of this.members) if (m.groupId === id && m.userId === userId) m.unread = 0;
  }

  async groupsFor(userId: string) {
    return this.members
      .filter((m) => m.userId === userId)
      .map((member) => ({ group: this.groups.find((g) => g.id === member.groupId)!, member }))
      .filter((r) => r.group);
  }
}

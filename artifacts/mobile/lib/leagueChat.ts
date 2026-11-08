// League chat helpers (decisions 145 and 146). Pure, so they're tested in
// lib/__tests__/leagueChat.test.ts.
//
// @mentions work the way iOS Messages does: typing @ suggests league members,
// and picking one puts "@Full Name " in the message. The server finds the
// mention in the text, so nothing else needs sending.

export interface MentionCandidate {
  name: string;
  me?: boolean;
}

/** Most names in the @ suggestion list. */
export const MAX_SUGGESTIONS = 5;

/**
 * The @ word being typed at the caret: "@sa" gives "sa", "@" alone gives "".
 * Null when the caret isn't in one. The @ has to start a word, so an email
 * address never opens suggestions. A space is allowed once letters follow it
 * ("@Sam P"), so full names can be typed.
 */
export function mentionQuery(text: string, caret: number = text.length): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /\n/.test(query) || /\s{2}/.test(query) || /^\s/.test(query)) return null;
  // At most one space: a first and last name.
  if ((query.match(/\s/g) ?? []).length > 1) return null;
  return { query, start: at };
}

/** Members whose name, or any word of it, starts with the query. Never you. */
export function suggestMentions<M extends MentionCandidate>(query: string, members: M[]): M[] {
  const q = query.trim().toLocaleLowerCase();
  return members
    .filter((m) => !m.me && m.name.trim())
    .filter((m) => {
      if (!q) return true;
      const name = m.name.toLocaleLowerCase();
      return name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q));
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS);
}

/** Puts "@Full Name " where the @ word was, and gives the new caret. */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const inserted = `@${name.trim()} `;
  const after = text.slice(caret).replace(/^\S*/, "").replace(/^ /, "");
  const next = `${text.slice(0, start)}${inserted}${after}`;
  return { text: next, caret: start + inserted.length };
}

export interface Segment {
  text: string;
  mention: boolean;
}

/**
 * Splits a message so its @mentions can show in bold. Only names the server
 * says it mentions are marked; "You" stands for your own name.
 */
export function mentionSegments(text: string, mentioned: string[], myName?: string): Segment[] {
  const names = [...new Set(mentioned.map((n) => (n === "You" ? (myName ?? "") : n)).filter((n) => n.trim()))].sort(
    (a, b) => b.length - a.length,
  );
  if (!names.length) return [{ text, mention: false }];
  const out: Segment[] = [];
  const lower = text.toLocaleLowerCase();
  let i = 0;
  let plain = "";
  while (i < text.length) {
    const hit = text[i] === "@" ? names.find((n) => lower.startsWith(`@${n.toLocaleLowerCase()}`, i)) : undefined;
    if (hit) {
      if (plain) out.push({ text: plain, mention: false });
      plain = "";
      out.push({ text: text.slice(i, i + hit.length + 1), mention: true });
      i += hit.length + 1;
    } else {
      plain += text[i];
      i += 1;
    }
  }
  if (plain) out.push({ text: plain, mention: false });
  return out;
}

/** What VoiceOver reads for a league chat message: the Admin label and who it mentions come first. */
export function spokenGroupMessage(m: { senderName: string; text: string; admin?: boolean; mentionsMe?: boolean; mentions?: string[] }): string {
  const who = m.admin ? `${m.senderName}, Admin` : m.senderName;
  const others = (m.mentions ?? []).filter((n) => n !== "You");
  const notes = [m.mentionsMe ? "Mentions you" : null, others.length ? `Mentions ${others.join(", ")}` : null].filter(Boolean);
  return [`${who}, ${m.text}`, ...notes].join(". ");
}

/** The Chat button on the league page, for VoiceOver: "Chat, 3 unread". */
export function chatButtonLabel(unread: number): string {
  return unread > 0 ? `Chat, ${unread} unread` : "Chat";
}

/** A count badge: "99+" past 99. */
export function badgeText(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/** The pins bar, collapsed: "3 pinned posts". */
export function pinsTitle(count: number): string {
  return count === 1 ? "1 pinned post" : `${count} pinned posts`;
}

/**
 * A league chat's row in Messages, read as one element by VoiceOver: that
 * it's a league chat, its name, unread, who wrote last and when.
 */
export function leagueRowLabel(g: {
  title: string;
  unread: number;
  lastMessage: { text: string; fromMe: boolean; senderName: string | null } | null;
  canSend: boolean;
}, when: string | null): string {
  const who = g.lastMessage ? (g.lastMessage.fromMe ? "You" : g.lastMessage.senderName) : null;
  return [
    `League chat, ${g.title}`,
    g.unread > 0 ? `${g.unread} unread` : null,
    g.lastMessage ? `${who ? `${who}: ` : ""}${g.lastMessage.text}` : "No messages yet",
    when,
    g.canSend ? null : "Read only",
  ]
    .filter(Boolean)
    .join(". ");
}

/** What a long press on a league chat message offers, in order. */
export type LeagueMessageAction = "pin" | "unpin" | "report" | "delete" | "mute" | "unmute" | "remove";

export function leagueMessageActions(input: {
  isAdmin: boolean;
  fromMe: boolean;
  /** A line from Ball Boi. */
  system: boolean;
  pinned: boolean;
  pinsFull: boolean;
  /** The sender, as the members list knows them. Null for Ball Boi or someone who left. */
  sender: { admin: boolean; muted: boolean; playerId: number | null } | null;
}): LeagueMessageAction[] {
  const out: LeagueMessageAction[] = [];
  if (input.isAdmin) {
    if (input.pinned) out.push("unpin");
    else if (!input.pinsFull) out.push("pin");
  }
  if (input.system) return out;
  if (input.fromMe) return out;
  out.push("report");
  if (!input.isAdmin) return out;
  out.push("delete");
  if (input.sender && !input.sender.admin) {
    out.push(input.sender.muted ? "unmute" : "mute");
    if (input.sender.playerId !== null) out.push("remove");
  }
  return out;
}

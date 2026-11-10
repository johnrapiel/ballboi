// Messages data for the iOS app. Spec: Messaging and moderation.
// Talks to Ball Boi's /api/messages routes only; the app never connects to
// Stream directly. New messages arrive by polling while a screen is open.

import { useAuth } from "@clerk/expo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { apiErrorMessage, apiFetch } from "@/lib/api";
import { needsMoreToFill } from "@/lib/olderPaging";

/** Always active: there are no Message Requests (finding 17, John, Nov 6). */
export type ConversationState = "active";

export interface Conversation {
  id: number;
  state: ConversationState;
  /** You blocked the other person: read only, with Unblock. */
  blocked: boolean;
  /** userId: their account, for a Discover player with no league player record yet. */
  /** `avatarUrl` is their photo ("/objects/..."); none for someone you blocked. */
  other: { name: string; playerId: number | null; userId?: number | null; avatarUrl?: string | null };
  lastMessage: { text: string; fromMe: boolean; at: string } | null;
  unread: number;
  canSend: boolean;
  sendBlockedReason: string | null;
}

export interface Message {
  id: string;
  text: string;
  fromMe: boolean;
  at: string;
}

/**
 * A group chat: an open match's chat once every spot fills (F15), or a
 * league's chat (decision 145), titled with the league name.
 */
export interface GroupConversation {
  id: number;
  /** Older servers leave it out: an open match's chat. "doubles": a doubles league match's chat for all four (D6). */
  kind?: "match" | "league" | "doubles";
  /** "Sat 9 AM doubles · Beacon Courts", or the league name */
  title: string;
  openMatchId: number | null;
  leagueId?: number | null;
  /** Doubles match chats (D6): the league match, for its Match button. */
  matchId?: number | null;
  memberCount: number;
  /** senderName null: a line from Ball Boi. */
  lastMessage: { text: string; fromMe: boolean; senderName: string | null; at: string } | null;
  /** Every unread message: the row shows bold with this count. */
  unread: number;
  /** League chats: the unread @mentions of you and admin posts, the ones the Messages button counts (decision 146). */
  attention?: number;
  /** League chats: you're one of its admins (pins and moderation). */
  isAdmin?: boolean;
  canSend: boolean;
  sendBlockedReason: string | null;
}

export interface GroupMessage {
  id: string;
  text: string;
  fromMe: boolean;
  at: string;
  /** Null for a line from Ball Boi ("All 4 spots filled"). */
  senderName: string | null;
  senderPlayerId: number | null;
  senderUserId: number | null;
  /** League chats: an admin post, shown with the Admin label. */
  admin?: boolean;
  /** League chats: the names it @mentions ("You" for you). */
  mentions?: string[];
  mentionsMe?: boolean;
}

export interface GroupThread {
  group: GroupConversation;
  messages: GroupMessage[];
  olderCursor: string | null;
  /** League chats: pinned posts, oldest pin first (up to 3). */
  pins?: GroupMessage[];
}

/** Someone in a group chat: for @ suggestions and league admin tools. */
export interface GroupMember {
  name: string;
  /** Their player in this league, for Remove from league. */
  playerId: number | null;
  userId: number | null;
  admin: boolean;
  muted: boolean;
  me: boolean;
}

/** The league page's Chat button (decision 145). */
export interface LeagueChat {
  groupId: number;
  unread: number;
  attention: number;
}

export interface MessagesSummary {
  /** Unread messages everywhere. */
  unread: number;
}

export interface Thread {
  conversation: Conversation;
  messages: Message[];
  /** Pass as `before` to load the page of earlier messages; null at the first message. */
  olderCursor: string | null;
}

/** A failed request, with the server's plain-language message and code. */
export class MessagesApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function readError(res: Response, fallback: string): Promise<MessagesApiError> {
  let code: string | undefined;
  let message = fallback;
  try {
    const body = (await res.clone().json()) as { error?: unknown; code?: unknown };
    if (typeof body.code === "string") code = body.code;
    if (typeof body.error === "string") message = body.error;
  } catch {
    message = await apiErrorMessage(res, fallback);
  }
  return new MessagesApiError(message, res.status, code);
}

function useApi() {
  const { getToken } = useAuth();
  return async function call<T>(path: string, init?: RequestInit, fallback = "Something went wrong. Try again."): Promise<T> {
    let res: Response;
    try {
      res = await apiFetch(path, getToken, init);
    } catch {
      throw new MessagesApiError("Check your connection and try again.", 0);
    }
    if (!res.ok) throw await readError(res, fallback);
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  };
}

export const messagesKeys = {
  all: ["messages"] as const,
  list: ["messages", "list"] as const,
  summary: ["messages", "summary"] as const,
  thread: (id: number) => ["messages", "thread", id] as const,
  group: (id: number) => ["messages", "group", id] as const,
  members: (id: number) => ["messages", "group", id, "members"] as const,
  leagueChat: (leagueId: number) => ["messages", "league", leagueId] as const,
  contacts: ["messages", "contacts"] as const,
};

export function useConversations() {
  const call = useApi();
  return useQuery({
    queryKey: messagesKeys.list,
    queryFn: () => call<{ conversations: Conversation[]; groups?: GroupConversation[] } & MessagesSummary>("/api/messages"),
    refetchInterval: 15_000,
  });
}

/** For the Messages button badge. */
export function useMessagesSummary() {
  const call = useApi();
  return useQuery({
    queryKey: messagesKeys.summary,
    queryFn: () => call<MessagesSummary>("/api/messages/summary"),
    refetchInterval: 30_000,
  });
}

/** The Messages button's badge: unread messages. */
export function badgeCount(summary: MessagesSummary | undefined): number {
  return summary?.unread ?? 0;
}

export function useThread(id: number | null) {
  const call = useApi();
  const qc = useQueryClient();
  return useQuery({
    queryKey: messagesKeys.thread(id ?? 0),
    queryFn: async () => {
      const before = qc.getQueryData<Thread>(messagesKeys.thread(id ?? 0));
      const thread = await call<Thread>(`/api/messages/${id}`);
      // Opening a conversation marks it read on the server. When that happens
      // (first load, or new messages read while it's open), refresh the badge
      // and the Messages list so their counts drop right away.
      const lastBefore = before?.messages[before.messages.length - 1]?.id;
      const lastNow = thread.messages[thread.messages.length - 1]?.id;
      if (!before || lastBefore !== lastNow) {
        void qc.invalidateQueries({ queryKey: messagesKeys.summary });
        void qc.invalidateQueries({ queryKey: ["messages", "list"] });
      }
      return thread;
    },
    enabled: id !== null,
    refetchInterval: 5_000,
  });
}

/** A group chat, refreshed every 5 seconds while open. Opening it marks it read. */
/** The page of a group chat before a message, for useOlderMessages. */
export const groupPage = (id: number, before: string) => `/api/messages/groups/${id}?before=${encodeURIComponent(before)}`;

export function useGroupThread(id: number | null) {
  const call = useApi();
  const qc = useQueryClient();
  return useQuery({
    queryKey: messagesKeys.group(id ?? 0),
    queryFn: async () => {
      const before = qc.getQueryData<GroupThread>(messagesKeys.group(id ?? 0));
      const thread = await call<GroupThread>(`/api/messages/groups/${id}`);
      const lastBefore = before?.messages[before.messages.length - 1]?.id;
      const lastNow = thread.messages[thread.messages.length - 1]?.id;
      if (!before || lastBefore !== lastNow) {
        void qc.invalidateQueries({ queryKey: messagesKeys.summary });
        void qc.invalidateQueries({ queryKey: ["messages", "list"] });
        // A league chat's count on its league page's Chat button (decision 145).
        if (thread.group.leagueId) void qc.invalidateQueries({ queryKey: messagesKeys.leagueChat(thread.group.leagueId) });
      }
      return thread;
    },
    enabled: id !== null,
    refetchInterval: 5_000,
  });
}

/**
 * Earlier messages, loaded a page at a time as you scroll up past the latest
 * ones `useThread` keeps fresh. Stops once the first message has loaded.
 * Show `older` before the latest messages, skipping any id already shown.
 * `page` gives the address of a page: a conversation by default, or a group chat's.
 */
export function useOlderMessages<M extends { id: string } = Message>(
  id: number | null,
  latest: { messages: M[]; olderCursor: string | null } | undefined,
  page: (id: number, before: string) => string = (id, before) => `/api/messages/${id}?before=${encodeURIComponent(before)}`,
) {
  const call = useApi();
  const [older, setOlder] = useState<M[]>([]);
  // undefined until the first older page loads; then that page's cursor.
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  // A different conversation starts over.
  useEffect(() => {
    setOlder([]);
    setCursor(undefined);
    setError(null);
  }, [id]);

  // Once you've scrolled back, keep every message seen. New messages slide the
  // latest page forward, and nothing between the two may drop out of view.
  const scrolledBack = cursor !== undefined;
  useEffect(() => {
    if (!scrolledBack || !latest) return;
    setOlder((list) => {
      const known = new Set(list.map((m) => m.id));
      const fresh = latest.messages.filter((m) => !known.has(m.id));
      return fresh.length ? [...list, ...fresh] : list;
    });
  }, [scrolledBack, latest]);

  const before = cursor === undefined ? (latest?.olderCursor ?? null) : cursor;

  const loadMore = useCallback(() => {
    if (!id || !before || busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    call<{ messages: M[]; olderCursor: string | null }>(page(id, before))
      .then((page) => {
        setOlder((list) => {
          const known = new Set(list.map((m) => m.id));
          return [...page.messages.filter((m) => !known.has(m.id)), ...list];
        });
        setCursor(page.olderCursor);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        busy.current = false;
        setLoading(false);
      });
    // `page` is a fixed address builder per screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, id, before]);

  return { older, loadMore, loading, hasMore: before !== null, error };
}

/**
 * Keeps loading earlier messages until they fill the screen or the history
 * ends (lib/olderPaging). Without it, a chat whose latest page is shorter
 * than the screen has nothing to scroll, so the list never asks for more.
 * Spread the result onto the chat's FlatList.
 */
export function useFillScreen(history: { loadMore: () => void; loading: boolean; hasMore: boolean; error: string | null }) {
  const [contentHeight, setContentHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const { loadMore, loading, hasMore, error } = history;
  useEffect(() => {
    if (needsMoreToFill({ contentHeight, viewportHeight, hasMore, loading, failed: error !== null })) loadMore();
  }, [contentHeight, viewportHeight, hasMore, loading, error, loadMore]);
  return {
    onContentSizeChange: (_w: number, h: number) => setContentHeight(h),
    onLayout: (e: { nativeEvent: { layout: { height: number } } }) => setViewportHeight(e.nativeEvent.layout.height),
  };
}

/** Everyone in a group chat, for @ suggestions and the league admin menu. */
export function useGroupMembers(id: number | null) {
  const call = useApi();
  return useQuery({
    queryKey: messagesKeys.members(id ?? 0),
    queryFn: async () => (await call<{ members: GroupMember[] }>(`/api/messages/groups/${id}/members`)).members,
    enabled: id !== null,
    staleTime: 60_000,
  });
}

/**
 * The league page's Chat button: your league's chat and its unread count.
 * Null when you're not in the league (the server says 404).
 */
export function useLeagueChat(leagueId: number | null) {
  const call = useApi();
  return useQuery({
    queryKey: messagesKeys.leagueChat(leagueId ?? 0),
    queryFn: async () => {
      try {
        return await call<LeagueChat>(`/api/leagues/${leagueId}/chat`);
      } catch (e) {
        if (e instanceof MessagesApiError && e.status === 404) return null;
        throw e;
      }
    },
    enabled: leagueId !== null,
    refetchInterval: 30_000,
  });
}

export function useContacts() {
  const call = useApi();
  return useQuery({
    queryKey: messagesKeys.contacts,
    queryFn: () => call<{ contacts: { name: string; playerId: number }[] }>("/api/messages/contacts"),
  });
}

export function useMessagesActions() {
  const call = useApi();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: messagesKeys.all });

  return {
    refresh,
    /** First message to a player. Returns the conversation it landed in. */
    start: (playerId: number, text: string, clientMessageId: string) =>
      call<{ conversationId: number; message: Message }>("/api/messages", {
        method: "POST",
        body: JSON.stringify({ playerId, text, clientMessageId }),
      }),
    /** First message to a Discover player, by account (they may be in no league yet). */
    startWithUser: (userId: number, text: string, clientMessageId: string) =>
      call<{ conversationId: number; message: Message }>("/api/messages", {
        method: "POST",
        body: JSON.stringify({ userId, text, clientMessageId }),
      }),
    send: (conversationId: number, text: string, clientMessageId: string) =>
      call<{ conversationId: number; message: Message }>(`/api/messages/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({ text, clientMessageId }),
      }),
    /** Sends in a group chat (F15). Retrying with the same client id never posts twice. */
    sendToGroup: (groupId: number, text: string, clientMessageId: string) =>
      call<{ groupId: number; message: GroupMessage }>(`/api/messages/groups/${groupId}/messages`, {
        method: "POST",
        body: JSON.stringify({ text, clientMessageId }),
      }),
    // League chats (decision 145): admin pins and moderation.
    pin: (groupId: number, messageId: string) =>
      call<{ pinnedIds: string[] }>(`/api/messages/groups/${groupId}/pins`, {
        method: "POST",
        body: JSON.stringify({ messageId }),
      }),
    unpin: (groupId: number, messageId: string) =>
      call<{ pinnedIds: string[] }>(`/api/messages/groups/${groupId}/pins/${encodeURIComponent(messageId)}`, { method: "DELETE" }),
    adminDelete: (groupId: number, messageId: string) =>
      call<{ deleted: boolean }>(`/api/messages/groups/${groupId}/messages/${encodeURIComponent(messageId)}/delete`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    mute: (groupId: number, member: { playerId?: number | null; userId?: number | null }) =>
      call<{ muted: boolean }>(`/api/messages/groups/${groupId}/mute`, {
        method: "POST",
        body: JSON.stringify(member),
      }),
    unmute: (groupId: number, member: { playerId?: number | null; userId?: number | null }) =>
      call<{ muted: boolean }>(`/api/messages/groups/${groupId}/unmute`, {
        method: "POST",
        body: JSON.stringify(member),
      }),
    /** Remove from league, from the league chat: the league's own removal, logged for moderation. */
    removeFromLeague: (leagueId: number, playerId: number) =>
      call<{ removed: boolean }>(`/api/leagues/${leagueId}/players/${playerId}/remove`, {
        method: "POST",
        body: JSON.stringify({ fromChat: true }),
      }),
    conversationWithPlayer: (playerId: number) =>
      call<{ conversationId: number | null }>(`/api/messages/with-player/${playerId}`),
    conversationWithUser: (userId: number) =>
      call<{ conversationId: number | null }>(`/api/messages/with-user/${userId}`),
    report: (conversationId: number, messageId: string, reason: string) =>
      call<{ id: number }>(`/api/messages/${conversationId}/report`, {
        method: "POST",
        body: JSON.stringify({ messageId, reason }),
      }, "We couldn't send your report. Try again."),
    addSamples: () => call<void>("/api/dev/messages/samples", { method: "POST" }),
  };
}

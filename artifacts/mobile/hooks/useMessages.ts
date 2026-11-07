// Messages data for the iOS app. Spec: Messaging and moderation.
// Talks to Ball Boi's /api/messages routes only; the app never connects to
// Stream directly. New messages arrive by polling while a screen is open.

import { useAuth } from "@clerk/expo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { apiErrorMessage, apiFetch } from "@/lib/api";

/** Always active: there are no Message Requests (finding 17, John, Nov 6). */
export type ConversationState = "active";

export interface Conversation {
  id: number;
  state: ConversationState;
  /** You blocked the other person: read only, with Unblock. */
  blocked: boolean;
  /** userId: their account, for a Discover player with no league player record yet. */
  other: { name: string; playerId: number | null; userId?: number | null };
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
  contacts: ["messages", "contacts"] as const,
};

export function useConversations() {
  const call = useApi();
  return useQuery({
    queryKey: messagesKeys.list,
    queryFn: () => call<{ conversations: Conversation[] } & MessagesSummary>("/api/messages"),
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

/**
 * Earlier messages, loaded a page at a time as you scroll up past the latest
 * ones `useThread` keeps fresh. Stops once the first message has loaded.
 * Show `older` before the latest messages, skipping any id already shown.
 */
export function useOlderMessages(id: number | null, latest: Thread | undefined) {
  const call = useApi();
  const [older, setOlder] = useState<Message[]>([]);
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
    call<Thread>(`/api/messages/${id}?before=${encodeURIComponent(before)}`)
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
  }, [call, id, before]);

  return { older, loadMore, loading, hasMore: before !== null, error };
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

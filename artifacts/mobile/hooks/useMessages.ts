// Messages data for the iOS app. Spec: Messaging and moderation.
// Talks to Ball Boi's /api/messages routes only; the app never connects to
// Stream directly. New messages arrive by polling while a screen is open.

import { useAuth } from "@clerk/expo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiErrorMessage, apiFetch } from "@/lib/api";

export type ConversationState = "active" | "awaiting_reply" | "request";

export interface Conversation {
  id: number;
  state: ConversationState;
  other: { name: string; playerId: number | null };
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
  unread: number;
  requests: number;
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
  list: (box: "messages" | "requests") => ["messages", "list", box] as const,
  summary: ["messages", "summary"] as const,
  thread: (id: number) => ["messages", "thread", id] as const,
  contacts: ["messages", "contacts"] as const,
};

export function useConversations(box: "messages" | "requests") {
  const call = useApi();
  return useQuery({
    queryKey: messagesKeys.list(box),
    queryFn: () => call<{ conversations: Conversation[] } & MessagesSummary>(`/api/messages?box=${box}`),
    refetchInterval: 15_000,
  });
}

/** For the Messages button: unread messages plus waiting Message Requests. */
export function useMessagesSummary() {
  const call = useApi();
  return useQuery({
    queryKey: messagesKeys.summary,
    queryFn: () => call<MessagesSummary>("/api/messages/summary"),
    refetchInterval: 30_000,
  });
}

export function useThread(id: number | null) {
  const call = useApi();
  return useQuery({
    queryKey: messagesKeys.thread(id ?? 0),
    queryFn: () => call<{ conversation: Conversation; messages: Message[] }>(`/api/messages/${id}`),
    enabled: id !== null,
    refetchInterval: 5_000,
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
    send: (conversationId: number, text: string, clientMessageId: string) =>
      call<{ conversationId: number; message: Message }>(`/api/messages/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({ text, clientMessageId }),
      }),
    conversationWithPlayer: (playerId: number) =>
      call<{ conversationId: number | null }>(`/api/messages/with-player/${playerId}`),
    report: (conversationId: number, messageId: string, reason: string) =>
      call<{ id: number }>(`/api/messages/${conversationId}/report`, {
        method: "POST",
        body: JSON.stringify({ messageId, reason }),
      }, "We couldn't send your report. Try again."),
    decline: (conversationId: number) => call<void>(`/api/messages/${conversationId}/decline`, { method: "POST" }),
    addSamples: () => call<void>("/api/dev/messages/samples", { method: "POST" }),
  };
}

export function useDeclineRequest() {
  const actions = useMessagesActions();
  return useMutation({ mutationFn: actions.decline, onSettled: actions.refresh });
}

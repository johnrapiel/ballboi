// Message pushes (Wave 2, Session G; spec decision 128).
//
// - Previews on (the default): the sender is the title and the text is the
//   body, so iOS shows "Sam Whitfield: Still on for 6?".
// - Previews off (Settings › Notifications › Show message previews): no text,
//   just "New message from Sam Whitfield".
// - iOS's own Show Previews setting still applies on top.
// - Never between blocked players, whichever side blocked.
// - Tapping opens that chat.
// - Group chats (F15) use the same path and switch: "Sam Whitfield in Sat 9 AM
//   doubles · Beacon Courts" over the text, or "New message from Sam
//   Whitfield in Sat 9 AM doubles · Beacon Courts" with previews off.

export interface MessagePushEvent {
  conversationId: number;
  senderId: string;
  recipientId: string;
  senderName: string;
  text: string;
  /** A group chat message: the chat's title. conversationId is then the group's id. */
  groupTitle?: string;
}

export interface PushContent {
  /** Empty means no title: iOS shows the app name. */
  title: string;
  body: string;
  link: string;
}

/** Longer messages are cut here; the chat has the rest. */
export const MESSAGE_PUSH_MAX = 150;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= MESSAGE_PUSH_MAX) return flat;
  return `${flat.slice(0, MESSAGE_PUSH_MAX - 1).trimEnd()}…`;
}

export function messagePushContent(
  e: Pick<MessagePushEvent, "conversationId" | "senderName" | "text" | "groupTitle">,
  previews: boolean,
): PushContent {
  const name = e.senderName.trim() || "a player";
  const group = e.groupTitle?.trim();
  if (group) {
    const link = `/conversation/group/${e.conversationId}`;
    if (!previews) return { title: "", body: `New message from ${name} in ${group}`, link };
    return { title: `${name} in ${group}`, body: clip(e.text) || "Sent a message", link };
  }
  const link = `/conversation/${e.conversationId}`;
  if (!previews) return { title: "", body: `New message from ${name}`, link };
  return { title: name, body: clip(e.text) || "Sent a message", link };
}

export interface MessagePushDeps {
  /** Every account hidden from this person, whichever side blocked. */
  blockedFor: (userId: string) => Promise<Set<string>>;
  /** The recipient's Show message previews switch (on when never changed). */
  previewsOn: (userId: string) => Promise<boolean>;
  send: (userIds: string[], title: string, body: string, link: string) => Promise<void>;
}

export function createMessageNotifier(deps: MessagePushDeps) {
  return async function notify(e: MessagePushEvent): Promise<"sent" | "skipped"> {
    if (!e.recipientId || e.recipientId === e.senderId) return "skipped";
    const blocked = await deps.blockedFor(e.recipientId);
    if (blocked.has(e.senderId)) return "skipped";
    const content = messagePushContent(e, await deps.previewsOn(e.recipientId));
    await deps.send([e.recipientId], content.title, content.body, content.link);
    return "sent";
  };
}

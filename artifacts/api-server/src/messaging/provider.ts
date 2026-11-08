// Ball Boi's own messaging interface. Spec: Messaging and moderation
// ("Behind Ball Boi's own messaging interface in code, so moving to a
// self-built backend later is a contained swap, not a rewrite").
//
// A provider only moves message text. Every rule (the first-message
// filter, throttles, blocks, restrictions) lives in
// MessagingService, so swapping Stream for something else never touches them.

export interface ProviderMessage {
  id: string;
  channelId: string;
  senderId: string;
  text: string;
  createdAt: Date;
  /** Hidden by a moderator. Never returned to the app. */
  hidden: boolean;
  /** A line from Ball Boi in a group chat ("All 4 spots filled"), sent by SYSTEM_SENDER. */
  system?: boolean;
}

/** The sender of Ball Boi's own lines in group chats. Never a member, never a person. */
export const SYSTEM_SENDER = "ballboi";

export interface SendInput {
  channelId: string;
  messageId: string;
  senderId: string;
  text: string;
  /** A line from Ball Boi (senderId is SYSTEM_SENDER). */
  system?: boolean;
}

export interface MessagingProvider {
  readonly name: "memory" | "stream";
  /**
   * Creates the channel if it doesn't exist. Idempotent. Direct messages pass
   * the two people; a group chat passes everyone in it (F15).
   */
  ensureChannel(channelId: string, members: string[]): Promise<void>;
  /** Group chats: adds people to an existing channel. They see its history. */
  addMembers(channelId: string, userIds: string[]): Promise<void>;
  /** Group chats: takes people out, so they can't read or send there any more. */
  removeMembers(channelId: string, userIds: string[]): Promise<void>;
  /**
   * Sends a message. `messageId` comes from the app, so a retried send after a
   * dropped connection never posts twice.
   */
  sendMessage(input: SendInput): Promise<ProviderMessage>;
  /** Newest last. `before` pages backwards from a message id. */
  listMessages(channelId: string, opts?: { limit?: number; before?: string }): Promise<ProviderMessage[]>;
  getMessage(messageId: string): Promise<ProviderMessage | null>;
  /** Hides a message for both people. Reversible by a moderator. */
  setHidden(messageId: string, hidden: boolean): Promise<void>;
  /** Account deletion: removes everything this user sent. */
  deleteUserData(userId: string): Promise<void>;
}

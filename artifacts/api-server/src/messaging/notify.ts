import { blockedAccountsFor } from "../lib/blocks";
import { logger } from "../lib/logger";
import { sendPushToUsers } from "../routes/notifications";
import { createMessageNotifier } from "../services/push/messagePush";
import { notificationSettingsFor } from "../services/push/settings";
import type { NewMessageEvent } from "./service";

/**
 * Push for new messages (Wave 2, Session G; decision 128): sender and text,
 * or "New message from [name]" when the recipient turned Show message
 * previews off. Never between blocked players. Rules in services/push/messagePush.ts.
 */
const notify = createMessageNotifier({
  blockedFor: blockedAccountsFor,
  previewsOn: async (userId) => (await notificationSettingsFor(userId)).messagePreviews,
  send: sendPushToUsers,
});

export function notifyNewMessage(event: NewMessageEvent): void {
  // Sending never holds up the message itself.
  void notify(event).catch((err) => logger.warn({ err, conversationId: event.conversationId }, "Message push failed"));
}

import type { NewMessageEvent } from "./service";

/**
 * Push for new messages. A stub until APNs lands (checklist: APNs push, and
 * "Message push notifications with privacy toggle"). When it's built:
 * - Respect the recipient's "hide message previews" setting: no text on the lock screen.
 * - Requests push as "New Message Request", never with the message text.
 * - Skip blocked pairs and restricted senders' requests.
 */
export function notifyNewMessage(_event: NewMessageEvent): void {
  // Intentionally empty.
}

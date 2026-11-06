import type { NewMessageEvent } from "./service";

/**
 * Push for new messages. A stub until APNs lands (checklist: APNs push, and
 * "Message push notifications with privacy toggle"). When it's built:
 * - Respect the recipient's "hide message previews" setting: no text on the lock screen.
 * - Skip blocked pairs.
 */
export function notifyNewMessage(_event: NewMessageEvent): void {
  // Intentionally empty.
}

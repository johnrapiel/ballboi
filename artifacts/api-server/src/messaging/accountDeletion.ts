import { getMessagingService } from ".";

type Log = { warn: (o: object, m: string) => void };

/**
 * Account deletion for messaging (App Store 5.1.1(v): deleting an account must
 * also delete messages). Removes every message the person sent from the
 * messaging provider (Stream in production), then every conversation record
 * they're in, and takes them out of every group chat. Reports they filed or received stay for moderation, as with the
 * rest of account deletion.
 *
 * A failure is logged for manual cleanup rather than leaving the person with a
 * half-deleted account, the same rule as video files.
 */
export async function deleteMessagingData(clerkUserId: string, log: Log): Promise<void> {
  const svc = getMessagingService();
  try {
    // Out of every group chat first (F15), so the others see them leave like a direct chat disappears.
    await svc.leaveAllGroups(clerkUserId);
  } catch (err) {
    log.warn({ err }, "Account deletion: not removed from group chats; needs manual cleanup");
  }
  try {
    await svc.provider.deleteUserData(clerkUserId);
  } catch (err) {
    log.warn({ err }, "Account deletion: messages not deleted from the messaging provider; needs manual cleanup");
  }
  try {
    await svc.repo.deleteAllFor(clerkUserId);
  } catch (err) {
    log.warn({ err }, "Account deletion: conversation records not deleted; needs manual cleanup");
  }
}

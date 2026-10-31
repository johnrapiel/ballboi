import { logger } from "../lib/logger";
import { moderationRepo } from "./drizzleModeration";
import { DrizzleMessagingRepo } from "./drizzleRepo";
import { AutoRestrict } from "./moderation";
import { FirstMessageFilter } from "./filter";
import { MemoryMessagingProvider } from "./memoryProvider";
import { notifyNewMessage } from "./notify";
import type { MessagingProvider } from "./provider";
import { MessagingService } from "./service";

let service: MessagingService | null = null;
let autoRestrict: AutoRestrict | null = null;

/** Shared auto-restrict, also used by reports and blocks in routes/safety.ts. */
export function getAutoRestrict(): AutoRestrict {
  autoRestrict ??= new AutoRestrict(moderationRepo(), undefined, (r) =>
    // Push alert to the moderator comes with APNs (checklist: 24-hour review, staffed).
    logger.warn({ restrictionId: r.id, reportId: r.reportId, reason: r.reason }, "Account auto-restricted"),
  );
  return autoRestrict;
}

/**
 * Picks the provider from MESSAGING_PROVIDER. "memory" (the default) needs no
 * keys and keeps messages until the API restarts.
 */
export function createProvider(env: NodeJS.ProcessEnv = process.env): MessagingProvider {
  const name = env.MESSAGING_PROVIDER ?? "memory";
  if (name !== "memory") logger.warn({ provider: name }, "Unknown MESSAGING_PROVIDER, using memory");
  return new MemoryMessagingProvider();
}

export function getMessagingService(): MessagingService {
  if (!service) {
    const provider = createProvider();
    const filter = FirstMessageFilter.fromEnv(process.env, (msg) => logger.warn(msg));
    service = new MessagingService({
      repo: new DrizzleMessagingRepo(),
      provider,
      filter,
      onNewMessage: notifyNewMessage,
      devAutoReply: provider.name === "memory" && process.env.NODE_ENV !== "production",
      moderation: { auto: getAutoRestrict(), repo: moderationRepo() },
    });
    logger.info({ provider: provider.name, blockedTerms: filter.termCount }, "Messaging ready");
  }
  return service;
}

/** Tests swap in a service built on in-memory parts. */
export function setMessagingService(next: MessagingService | null) {
  service = next;
}

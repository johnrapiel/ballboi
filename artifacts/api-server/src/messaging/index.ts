import { logger } from "../lib/logger";
import { DrizzleMessagingRepo } from "./drizzleRepo";
import { FirstMessageFilter } from "./filter";
import { MemoryMessagingProvider } from "./memoryProvider";
import { notifyNewMessage } from "./notify";
import type { MessagingProvider } from "./provider";
import { MessagingService } from "./service";

let service: MessagingService | null = null;

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
    });
    logger.info({ provider: provider.name, blockedTerms: filter.termCount }, "Messaging ready");
  }
  return service;
}

/** Tests swap in a service built on in-memory parts. */
export function setMessagingService(next: MessagingService | null) {
  service = next;
}

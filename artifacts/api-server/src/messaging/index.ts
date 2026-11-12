import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../lib/logger";
import { moderationRepo } from "./drizzleModeration";
import { DrizzleMessagingRepo } from "./drizzleRepo";
import { FirstMessageFilter } from "./filter";
import { DrizzleMemoryStore } from "./drizzleMemoryStore";
import { MemoryMessagingProvider, type MemoryStore } from "./memoryProvider";
import { DrizzleLeagueChatSource } from "./drizzleLeagueChats";
import { setLeagueChatEvents } from "./leagueChatEvents";
import { LeagueChats } from "./leagueChats";
import { notifyNewMessage } from "./notify";
import type { MessagingProvider } from "./provider";
import { StreamMessagingProvider } from "./streamProvider";
import { MessagingService } from "./service";

let service: MessagingService | null = null;
/**
 * Picks the provider from MESSAGING_PROVIDER:
 * - "stream": Stream Chat (needs STREAM_API_KEY and STREAM_API_SECRET).
 * - "memory": keeps messages in the API's memory, no keys needed.
 * - "auto" or unset: Stream when both keys are set, otherwise memory. Staging
 *   uses this, so adding the two Stream secrets switches it over.
 *
 * Memory saves its messages so chats keep their history when the API
 * restarts: to MESSAGING_MEMORY_FILE (a file in the system temp folder by
 * default), or to the database with MESSAGING_MEMORY_STORE=database. Staging
 * needs the database: its container's disk is wiped every time it sleeps or
 * deploys, which emptied every chat (John, Nov 10).
 */
export function createProvider(env: NodeJS.ProcessEnv = process.env, store?: () => MemoryStore): MessagingProvider {
  const hasKeys = !!(env.STREAM_API_KEY && env.STREAM_API_SECRET);
  const asked = env.MESSAGING_PROVIDER || "auto";
  const name = asked === "auto" ? (hasKeys ? "stream" : "memory") : asked;
  if (name === "stream") {
    if (hasKeys) return new StreamMessagingProvider(env.STREAM_API_KEY!, env.STREAM_API_SECRET!);
    // In production a missing key is a deploy mistake: fail loudly rather than lose messages on restart.
    if (env.NODE_ENV === "production") throw new Error("MESSAGING_PROVIDER=stream needs STREAM_API_KEY and STREAM_API_SECRET");
    logger.warn("MESSAGING_PROVIDER=stream without STREAM_API_KEY and STREAM_API_SECRET, using memory");
  } else if (name !== "memory") {
    logger.warn({ provider: name }, "Unknown MESSAGING_PROVIDER, using memory");
  }
  if (env.MESSAGING_MEMORY_STORE === "database") {
    return new MemoryMessagingProvider({ store: (store ?? (() => new DrizzleMemoryStore()))(), log: logger });
  }
  return new MemoryMessagingProvider({ file: env.MESSAGING_MEMORY_FILE || join(tmpdir(), "ballboi-messages.json") });
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
      moderation: { repo: moderationRepo() },
      leaguePlayers: (leagueId) => getLeagueChats().leaguePlayers(leagueId),
    });
    logger.info({ provider: provider.name, blockedTerms: filter.termCount }, "Messaging ready");
    if (provider instanceof StreamMessagingProvider) {
      void provider
        .check()
        .then(() => logger.info("Stream: keys work"))
        .catch((err) => logger.error({ err }, "Stream: the keys didn't work. Check STREAM_API_KEY and STREAM_API_SECRET"));
    }
  }
  return service;
}

/** Tests swap in a service built on in-memory parts. */
export function setMessagingService(next: MessagingService | null) {
  service = next;
}

let leagueChats: LeagueChats | null = null;

/** League chats (decisions 145 and 146) on the messaging service. */
export function getLeagueChats(): LeagueChats {
  if (!leagueChats) {
    leagueChats = new LeagueChats({ service: getMessagingService, source: new DrizzleLeagueChatSource(), log: logger });
  }
  return leagueChats;
}

/**
 * At startup: the league routes start telling league chats about joins,
 * results and pairings, and every existing league gets its chat (idempotent,
 * nothing deleted). Runs in the background so the API starts right away.
 */
export function startLeagueChats(): void {
  const chats = getLeagueChats();
  setLeagueChatEvents(chats.events());
  void chats
    .syncAll()
    .then((r) => logger.info(r, "League chats in step"))
    .catch((err) => logger.warn({ err }, "League chats: startup sync failed"));
}

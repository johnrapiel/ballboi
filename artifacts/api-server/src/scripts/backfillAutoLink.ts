import pino from "pino";
import { db } from "@workspace/db";
import { playersTable } from "@workspace/db";
import { isNull } from "drizzle-orm";
import { autoLinkPlayer } from "../lib/autoLinkPlayer.js";

const logger = pino({ name: "backfillAutoLink" });

async function main() {
  const all = await db.select().from(playersTable);
  const unlinked = all.filter((p) => !p.clerkUserId);

  logger.info({ total: all.length, unlinked: unlinked.length }, "Starting auto-link backfill");

  let matched = 0;
  let skipped = 0;
  const alreadyLinked = all.length - unlinked.length;

  for (const player of unlinked) {
    const linked = await autoLinkPlayer(player);
    if (linked) {
      matched++;
      logger.info({ playerId: player.id, name: player.name }, "Linked player to user account");
    } else {
      skipped++;
    }
  }

  logger.info({ matched, skipped, alreadyLinked }, "Backfill complete");
  console.log(`Backfill complete: ${matched} linked, ${skipped} skipped (no match or ambiguous), ${alreadyLinked} already linked`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });

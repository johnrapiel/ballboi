// Walkthrough tools (development only): pnpm seed:walkthrough and
// pnpm walkthrough <command>. Run `pnpm walkthrough help` for the list.
//
// - seed: resets the walkthrough's test data, then creates accounts B, C and
//   D, a Private league run by John (A) with B in it, and today's A vs B match.
// - as B|C|D ...: acts as a seeded account through the running API with a
//   real Clerk session, so every rule (Message Requests, first-message
//   filter, join lock, first score stands) applies exactly as in the app.
// - time / pair-now: the same dev-only time controls as Manage > Testing tools.
//
// Refuses to run in production or against a live Clerk instance.

import { pool } from "@workspace/db";
import { runCommand } from "./walkthroughCommands.js";
import { Problem } from "./walkthroughData.js";

runCommand(process.argv.slice(2))
  .then(async (code) => {
    await pool.end();
    process.exit(code);
  })
  .catch(async (err) => {
    const refused = (err as { cause?: { code?: string } })?.cause?.code === "ECONNREFUSED";
    console.error(err instanceof Problem ? err.message : refused ? "Can't reach the database. Start it with: pnpm db:up" : err);
    await pool.end().catch(() => {});
    process.exit(1);
  });

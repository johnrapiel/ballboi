import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./services/scheduler";
import { seedGlobalData } from "./services/seasonService";
import { startModerationAgent } from "./messaging/agentJob";
import { backfillDiscoverAreas } from "./lib/discoverRepo";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function bootstrap(): Promise<void> {
  await seedGlobalData();

  await new Promise<void>((resolve, reject) => {
    app.listen(port, (err) => {
      if (err) {
        reject(err);
        return;
      }
      logger.info({ port }, "Server listening");
      resolve();
    });
  });

  startScheduler();
  startModerationAgent();
  // Discover's point for accounts saved before Discover (once; quick after that).
  backfillDiscoverAreas()
    .then((n) => n && logger.info({ filled: n }, "Filled Discover areas"))
    .catch((err) => logger.error({ err }, "Couldn't fill Discover areas"));
}

bootstrap().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});

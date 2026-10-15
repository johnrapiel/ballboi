import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./services/scheduler";
import { seedGlobalData } from "./services/seasonService";

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
}

bootstrap().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});

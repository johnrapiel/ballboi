import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import { enforceSanctions } from "./messaging/enforceSanctions";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors());
app.use(
  express.json({
    // Webhook signatures (Stream) are checked against the exact bytes received.
    verify: (req, _res, buf) => {
      (req as typeof req & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

// Clerk auth middleware - makes auth available on all routes
app.use(clerkMiddleware());

// Banned and suspended accounts can only check their status, appeal once, or delete the account.
app.use("/api", enforceSanctions);

app.use("/api", router);

export default app;

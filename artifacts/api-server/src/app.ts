import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import { logger } from "./lib/logger";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";

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

// Clerk proxy must be before express.json()
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Clerk auth middleware - makes auth available on all routes
app.use(clerkMiddleware());

app.use("/api", router);

export default app;

import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { getMessagingService } from "../messaging";
import { MessagingError, type MessagingService } from "../messaging/service";
import { logger } from "../lib/logger";

// Direct messages and Message Requests. Spec: Messaging and moderation.
// The app talks only to these routes; the provider behind them can change.

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

type Handler = (svc: MessagingService, me: string, req: Request, res: Response) => Promise<void>;

export function createMessagesRouter(getService: () => MessagingService = getMessagingService): IRouter {
  const router: IRouter = Router();

  const handle =
    (fn: Handler) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(getService(), getAuth(req).userId!, req, res);
      } catch (e) {
        if (e instanceof MessagingError) {
          res.status(e.status).json({ error: e.message, code: e.code });
          return;
        }
        logger.error({ err: e }, "Messaging request failed");
        res.status(500).json({ error: "Something went wrong. Try again." });
      }
    };

  const idParam = (req: Request): number => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new MessagingError(404, "not_found", "This conversation isn't available.");
    return id;
  };

  router.get(
    "/messages",
    requireAuth,
    handle(async (svc, me, req, res) => {
      const box = req.query.box === "requests" ? "requests" : "messages";
      const [conversations, summary] = await Promise.all([svc.list(me, box), svc.summary(me)]);
      res.json({ conversations, ...summary });
    }),
  );

  router.get(
    "/messages/summary",
    requireAuth,
    handle(async (svc, me, _req, res) => {
      res.json(await svc.summary(me));
    }),
  );

  router.get(
    "/messages/contacts",
    requireAuth,
    handle(async (svc, me, _req, res) => {
      res.json({ contacts: await svc.contacts(me) });
    }),
  );

  router.post(
    "/messages",
    requireAuth,
    handle(async (svc, me, req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = await svc.start(me, { playerId: body.playerId, text: body.text, clientMessageId: body.clientMessageId });
      res.status(201).json(result);
    }),
  );

  router.get(
    "/messages/:id",
    requireAuth,
    handle(async (svc, me, req, res) => {
      const before = typeof req.query.before === "string" ? req.query.before : undefined;
      res.json(await svc.thread(me, idParam(req), { before }));
    }),
  );

  router.post(
    "/messages/:id/messages",
    requireAuth,
    handle(async (svc, me, req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.status(201).json(await svc.send(me, idParam(req), { text: body.text, clientMessageId: body.clientMessageId }));
    }),
  );

  router.post(
    "/messages/:id/decline",
    requireAuth,
    handle(async (svc, me, req, res) => {
      await svc.decline(me, idParam(req));
      res.status(204).end();
    }),
  );

  // Development only: sample conversations so every screen can be tried on one phone.
  router.post(
    "/dev/messages/samples",
    requireAuth,
    handle(async (svc, me, _req, res) => {
      if (process.env.NODE_ENV === "production" || svc.provider.name !== "memory") {
        res.status(404).json({ error: "Not found" });
        return;
      }
      await svc.seedSamples(me, async (id, name) => {
        await db.insert(usersTable).values({ clerkUserId: id, displayName: name }).onConflictDoNothing();
      });
      res.status(201).json({ ok: true });
    }),
  );

  return router;
}

export default createMessagesRouter();

import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { getLeagueChats, getMessagingService } from "../messaging";
import type { LeagueChats } from "../messaging/leagueChats";
import { MessagingError, type MessagingService } from "../messaging/service";
import { logger } from "../lib/logger";

// Direct messages. Spec: Messaging and moderation. There are no Message
// Requests (finding 17): every message goes straight to the inbox.
// The app talks only to these routes; the provider behind them can change.

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

type Handler = (svc: MessagingService, me: string, req: Request, res: Response) => Promise<void>;

export function createMessagesRouter(
  getService: () => MessagingService = getMessagingService,
  getChats: () => Pick<LeagueChats, "chatFor"> = getLeagueChats,
): IRouter {
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
    // An older app may still ask for ?box=requests; there's one inbox now.
    handle(async (svc, me, _req, res) => {
      // Group chats (F15) come as their own list, so an older app that only reads conversations still works.
      const [conversations, groups, summary] = await Promise.all([svc.list(me), svc.groups(me), svc.summary(me)]);
      res.json({ conversations, groups, ...summary });
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

  router.get(
    "/messages/with-player/:playerId",
    requireAuth,
    handle(async (svc, me, req, res) => {
      res.json({ conversationId: await svc.conversationWithPlayer(me, req.params.playerId) });
    }),
  );

  router.get(
    "/messages/with-user/:userId",
    requireAuth,
    handle(async (svc, me, req, res) => {
      res.json({ conversationId: await svc.conversationWithUser(me, req.params.userId) });
    }),
  );

  router.post(
    "/messages",
    requireAuth,
    handle(async (svc, me, req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = await svc.start(me, { playerId: body.playerId, userId: body.userId, text: body.text, clientMessageId: body.clientMessageId });
      res.status(201).json(result);
    }),
  );

  // ─── Group chats (F15): an open match's chat, on the same service ─────────

  router.get(
    "/messages/groups/:id",
    requireAuth,
    handle(async (svc, me, req, res) => {
      const before = typeof req.query.before === "string" ? req.query.before : undefined;
      res.json(await svc.groupThread(me, idParam(req), { before }));
    }),
  );

  router.post(
    "/messages/groups/:id/messages",
    requireAuth,
    handle(async (svc, me, req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.status(201).json(await svc.sendToGroup(me, idParam(req), { text: body.text, clientMessageId: body.clientMessageId }));
    }),
  );

  router.get(
    "/messages/groups/:id/members",
    requireAuth,
    handle(async (svc, me, req, res) => {
      res.json({ members: await svc.groupMembers(me, idParam(req)) });
    }),
  );

  // ─── League chats (decisions 145 and 146): admin pins and moderation ─────

  router.post(
    "/messages/groups/:id/pins",
    requireAuth,
    handle(async (svc, me, req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.json(await svc.pin(me, idParam(req), { messageId: body.messageId }));
    }),
  );

  router.delete(
    "/messages/groups/:id/pins/:messageId",
    requireAuth,
    handle(async (svc, me, req, res) => {
      res.json(await svc.unpin(me, idParam(req), String(req.params.messageId)));
    }),
  );

  router.post(
    "/messages/groups/:id/messages/:messageId/delete",
    requireAuth,
    handle(async (svc, me, req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const logged = await svc.adminDelete(me, idParam(req), String(req.params.messageId), { reason: body.reason });
      res.json({ deleted: true, reportId: logged.id });
    }),
  );

  router.post(
    "/messages/groups/:id/mute",
    requireAuth,
    handle(async (svc, me, req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.json(await svc.setMuted(me, idParam(req), { playerId: body.playerId, userId: body.userId }, true));
    }),
  );

  router.post(
    "/messages/groups/:id/unmute",
    requireAuth,
    handle(async (svc, me, req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.json(await svc.setMuted(me, idParam(req), { playerId: body.playerId, userId: body.userId }, false));
    }),
  );

  // The league page's Chat button: the league's chat (made now if it's missing) and its unread counts.
  router.get(
    "/leagues/:leagueId/chat",
    requireAuth,
    handle(async (_svc, me, req, res) => {
      const leagueId = Number(req.params.leagueId);
      const chat = Number.isInteger(leagueId) && leagueId > 0 ? await getChats().chatFor(leagueId, me) : null;
      if (!chat) throw new MessagingError(404, "not_found", "This league's chat isn't available.");
      res.json(chat);
    }),
  );

  router.post(
    "/messages/groups/:id/report",
    requireAuth,
    handle(async (svc, me, req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const report = await svc.reportGroupMessage(me, idParam(req), { messageId: body.messageId, reason: body.reason, details: body.details });
      res.status(201).json({ ...report, status: "open" });
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
    "/messages/:id/report",
    requireAuth,
    handle(async (svc, me, req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const report = await svc.reportMessage(me, idParam(req), { messageId: body.messageId, reason: body.reason, details: body.details });
      res.status(201).json({ ...report, status: "open" });
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

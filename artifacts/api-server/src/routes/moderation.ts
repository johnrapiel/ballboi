import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { getMessagingService } from "../messaging";
import { moderationRepo } from "../messaging/drizzleModeration";
import type { ModerationRepo } from "../messaging/moderation";
import type { MessagingService } from "../messaging/service";
import { requireAdmin } from "../middlewares/requireAdmin";

// Moderator actions for the reports queue. Spec: Enforcement ladder, steps 3
// and 4. Checklist 3a: "Moderator can remove messages". Every action here is
// reversible: hide/unhide, restrict/lift. Suspensions and bans are human-only
// and come later.

export function createModerationRouter(
  getService: () => MessagingService = getMessagingService,
  getRepo: () => ModerationRepo = moderationRepo,
): IRouter {
  const router: IRouter = Router();

  router.post("/admin/messages/:messageId/hide", requireAdmin, async (req, res) => {
    const hidden = req.body?.hidden !== false;
    const ok = await getService().setMessageHidden(String(req.params.messageId), hidden);
    if (!ok) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    res.json({ messageId: req.params.messageId, hidden });
  });

  router.get("/admin/accounts/:clerkUserId/restriction", requireAdmin, async (req, res) => {
    res.json({ restriction: await getRepo().activeRestriction(String(req.params.clerkUserId)) });
  });

  router.post("/admin/accounts/:clerkUserId/restrict", requireAdmin, async (req, res) => {
    const reason = typeof req.body?.reason === "string" && req.body.reason.trim() ? req.body.reason.trim().slice(0, 500) : "Restricted by a moderator";
    const reportId = Number.isInteger(req.body?.reportId) ? (req.body.reportId as number) : null;
    const restriction = await getRepo().restrict({ subject: String(req.params.clerkUserId), reason, source: "admin", reportId });
    res.status(201).json({ restriction });
  });

  router.post("/admin/accounts/:clerkUserId/lift", requireAdmin, async (req, res) => {
    const lifted = await getRepo().lift(String(req.params.clerkUserId), getAuth(req).userId ?? "admin");
    res.json({ lifted });
  });

  return router;
}

export default createModerationRouter();

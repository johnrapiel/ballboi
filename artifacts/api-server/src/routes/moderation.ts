import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { getMessagingService } from "../messaging";
import { moderationRepo } from "../messaging/drizzleModeration";
import type { ModerationRepo } from "../messaging/moderation";
import type { MessagingService } from "../messaging/service";
import { requireAdmin } from "../middlewares/requireAdmin";
import type { ModerationAgent } from "../messaging/agent";
import { getModerationAgent } from "../messaging/agentJob";
import { DrizzleAgentRepo } from "../messaging/drizzleAgent";

// Moderator actions for the reports queue. Spec: Enforcement ladder, steps 3
// and 4. Checklist 3a: "Moderator can remove messages". Every action here is
// reversible: hide/unhide, restrict/lift. Suspensions and bans are human-only
// and come later.

export function createModerationRouter(
  getService: () => MessagingService = getMessagingService,
  getRepo: () => ModerationRepo = moderationRepo,
  getAgent: () => ModerationAgent | null = getModerationAgent,
  listDecisions: (pending: boolean) => Promise<unknown[]> = (pending) => new DrizzleAgentRepo().listDecisions({ pending }),
): IRouter {
  const router: IRouter = Router();

  // ─── Claude moderation agent: John confirms or undoes every decision ─────

  router.get("/admin/agent-decisions", requireAdmin, async (req, res) => {
    res.json(await listDecisions(req.query.pending !== "false"));
  });

  router.post("/admin/agent-decisions/:id/:verb", requireAdmin, async (req, res) => {
    const agent = getAgent();
    const id = Number(req.params.id);
    const verb = req.params.verb;
    if (!agent) {
      res.status(503).json({ error: "The moderation agent is off" });
      return;
    }
    if (!Number.isInteger(id) || (verb !== "confirm" && verb !== "undo")) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const by = getAuth(req).userId ?? "admin";
    const decision = verb === "confirm" ? await agent.confirm(id, by) : await agent.undo(id, by);
    if (!decision) {
      res.status(409).json({ error: "That decision was already confirmed or undone" });
      return;
    }
    res.json(decision);
  });

  /** Runs the agent now, for testing on staging. */
  router.post("/admin/agent/run", requireAdmin, async (_req, res) => {
    const agent = getAgent();
    if (!agent) {
      res.status(503).json({ error: "The moderation agent is off" });
      return;
    }
    res.json({ decisions: await agent.runOnce() });
  });

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

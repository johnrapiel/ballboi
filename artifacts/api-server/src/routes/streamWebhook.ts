import { Router, type IRouter, type Request } from "express";
import type { ReportReason } from "@workspace/db";
import { getMessagingService } from "../messaging";
import type { MessagingService } from "../messaging/service";
import { verifyWebhookSignature } from "../messaging/streamProvider";
import { logger } from "../lib/logger";

// Stream moderation events into Ball Boi's one review queue
// (spec: "Stream's flags and moderation events feed the existing
// /api/admin/reports queue, so there's one review queue").
//
// Set the webhook URL in the Stream dashboard to
// https://<api host>/api/webhooks/stream. Stream signs each request with the
// API secret; unsigned or mis-signed requests are refused.

/** Events that mean "a message looks harmful". */
const FLAG_EVENTS = new Set(["review_queue_item.new", "moderation.flagged", "message.flagged"]);

interface FlagEvent {
  messageId: string;
  labels: string[];
  action: string | null;
}

/** Pulls the message id and harm labels out of the event shapes Stream sends. */
export function parseFlagEvent(body: unknown): FlagEvent | null {
  const b = (body ?? {}) as Record<string, any>;
  if (typeof b.type !== "string" || !FLAG_EVENTS.has(b.type)) return null;
  const item = (b.review_queue_item ?? b.item ?? null) as Record<string, any> | null;
  if (item && typeof item.entity_type === "string" && !item.entity_type.includes("message")) return null;
  const messageId: unknown = item?.entity_id ?? b.message?.id;
  if (typeof messageId !== "string" || !messageId) return null;
  const action: string | null = item?.recommended_action ?? null;
  // Stream sends review items it would let through too; only flag and remove count.
  if (action && action !== "flag" && action !== "remove") return null;
  const flags: any[] = Array.isArray(item?.flags) ? item.flags : [];
  const labels = [
    ...new Set(
      flags
        .flatMap((f) => [...(Array.isArray(f?.labels) ? f.labels : []), f?.reason])
        .filter((l): l is string => typeof l === "string" && l.length > 0),
    ),
  ];
  return { messageId, labels, action };
}

export function reasonForLabels(labels: string[]): ReportReason {
  const text = labels.join(" ").toLowerCase();
  if (/spam|scam|advert/.test(text)) return "spam";
  if (/sexual|nud|explicit|adult/.test(text)) return "inappropriate_content";
  return "harassment";
}

// Recently handled X-Webhook-Id values, so a retry never files twice.
const handled: string[] = [];
const alreadyHandled = (id: string | undefined) => !!id && handled.includes(id);
function markHandled(id: string | undefined) {
  if (!id) return;
  handled.push(id);
  if (handled.length > 500) handled.shift();
}

export function createStreamWebhookRouter(
  getService: () => MessagingService = getMessagingService,
  getSecret: () => string | undefined = () => process.env.STREAM_API_SECRET,
): IRouter {
  const router: IRouter = Router();

  router.post("/webhooks/stream", async (req, res) => {
    const secret = getSecret();
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!secret || !raw) {
      res.status(503).json({ error: "Stream webhook isn't set up" });
      return;
    }
    if (!verifyWebhookSignature(raw, req.header("x-signature"), secret)) {
      res.status(401).json({ error: "Bad signature" });
      return;
    }
    const event = parseFlagEvent(req.body);
    if (!event || alreadyHandled(req.header("x-webhook-id"))) {
      res.status(200).json({ ok: true });
      return;
    }
    try {
      const details = [event.action === "remove" ? "Recommended: remove" : "Flagged", ...event.labels].join(" · ");
      const reportId = await getService().recordProviderFlag({ messageId: event.messageId, details, reason: reasonForLabels(event.labels) });
      markHandled(req.header("x-webhook-id"));
      if (reportId) logger.warn({ reportId, messageId: event.messageId }, "Stream flagged a message");
      res.status(200).json({ ok: true, reportId });
    } catch (err) {
      logger.error({ err }, "Stream webhook failed");
      // 5xx lets Stream retry.
      res.status(500).json({ error: "Try again" });
    }
  });

  return router;
}

export default createStreamWebhookRouter();

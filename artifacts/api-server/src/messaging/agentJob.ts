import cron from "node-cron";
import { logger } from "../lib/logger";
import { getMessagingService } from ".";
import { ModerationAgent } from "./agent";
import { AnthropicModerationModel, DEFAULT_AGENT_MODEL } from "./agentModel";
import { DrizzleAgentRepo } from "./drizzleAgent";
import { moderationRepo } from "./drizzleModeration";

let agent: ModerationAgent | null | undefined;

/** The agent, or null when ANTHROPIC_API_KEY isn't set (then nothing runs). */
export function getModerationAgent(): ModerationAgent | null {
  if (agent !== undefined) return agent;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || process.env.MODERATION_AGENT_ENABLED === "false") {
    agent = null;
    return agent;
  }
  const service = getMessagingService();
  agent = new ModerationAgent({
    repo: new DrizzleAgentRepo(),
    moderation: moderationRepo(),
    model: new AnthropicModerationModel(key, process.env.MODERATION_AGENT_MODEL || DEFAULT_AGENT_MODEL),
    setMessageHidden: (id, hidden) => service.setMessageHidden(id, hidden),
    // Push alert to John comes with APNs; until then it's in the log and the admin queue.
    onDecision: (d) => logger.warn({ decisionId: d.id, reportId: d.reportId, action: d.action }, "Moderation agent decided; confirm or undo"),
  });
  return agent;
}

/** Every 15 minutes, review reports nobody has acted on for 6 hours. */
export function startModerationAgent() {
  const a = getModerationAgent();
  if (!a) {
    logger.info("Moderation agent off (no ANTHROPIC_API_KEY)");
    return;
  }
  let running = false;
  cron.schedule("*/15 * * * *", async () => {
    if (running) return;
    running = true;
    try {
      const decisions = await a.runOnce();
      if (decisions.length) logger.info({ count: decisions.length }, "Moderation agent run");
    } catch (err) {
      logger.error({ err }, "Moderation agent run failed");
    } finally {
      running = false;
    }
  });
  logger.info("Moderation agent on");
}

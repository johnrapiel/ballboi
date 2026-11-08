// Match card reminders (brief item 30, 32, 33). Every 5 minutes: the
// day-before "Still on for tomorrow?", "Did it happen?" 3 hours after, and
// the end of a no-show's 48 hours. The 8 AM day-before and 2-hour reminders
// are the match day reminders every match gets (decision 127,
// services/push/matchReminderJob.ts), behind their Settings switch. Each is sent
// at most once: it's claimed on the plan before the push goes out.

import cron from "node-cron";
import { logger } from "../../lib/logger";
import { dayBeforeAt, didItHappenAt, noShowDeadline } from "../../lib/matchPlan";
import { DrizzleMatchPlanRepo, type MatchPlanRepo } from "../../lib/matchPlanRepo";
import { sendPushToUsers } from "../../routes/notifications";
import { whenLabel, type Push } from "../../routes/matchPlans";

function timeLabel(d: Date, timeZone: string): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone }).replace(":00", "");
}

export async function runMatchPlanJobs(repo: MatchPlanRepo, push: Push, now: Date): Promise<number> {
  let sent = 0;
  for (const { plan, match } of await repo.due(now)) {
    const a = plan.proposerClerkUserId;
    const b = plan.recipientClerkUserId;
    const send = async (title: (other: string) => string, body: string) => {
      const [nameA, nameB] = await Promise.all([repo.name(a), repo.name(b)]);
      await Promise.all([push([a], title(nameB), body, "/messages"), push([b], title(nameA), body, "/messages")]);
      sent++;
    };
    const where = plan.courtName ? ` at ${plan.courtName}` : "";
    if (plan.status === "accepted" && now < plan.startsAt) {
      const dayBefore = dayBeforeAt(plan);
      if (now >= dayBefore && plan.respondedAt && dayBefore > plan.respondedAt && (await repo.claim(plan.id, "dayBeforeSentAt", now))) {
        await send(() => `Still on for tomorrow at ${timeLabel(plan.startsAt, plan.timeZone)}?`, `${whenLabel(plan.startsAt, plan.timeZone)}${where}. No answer means you're still on.`);
      }
    }
    if (plan.status === "accepted" && !match.score && !plan.noShowReportedAt && now >= didItHappenAt(plan) && (await repo.claim(plan.id, "didItHappenSentAt", now))) {
      await send((other) => `Did your match with ${other} happen?`, "Enter the score, or tell us it didn't happen.");
    }
    const deadline = noShowDeadline(plan);
    if (plan.noShowStatus === "pending" && deadline && now >= deadline && !match.score && plan.noShowClerkUserId && (await repo.claim(plan.id, "noShowExpirySentAt", now))) {
      await push([plan.noShowClerkUserId], "A no-show is on your player card", `No answer in 48 hours for ${whenLabel(plan.startsAt, plan.timeZone)}.`, "/messages");
      sent++;
    }
  }
  return sent;
}

export function startMatchPlanJobs(repo: MatchPlanRepo = new DrizzleMatchPlanRepo()) {
  cron.schedule("*/5 * * * *", () => {
    runMatchPlanJobs(repo, sendPushToUsers, new Date()).catch((err) => logger.error({ err }, "Match card reminders failed"));
  });
}

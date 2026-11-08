import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { db, matchesTable, playersTable, supportReportsTable, usersTable } from "@workspace/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import pino from "pino";
import { sendSupportEmail, type SendResult, type SupportEmail } from "../lib/supportEmail";

// "Something not working?" (spec decision 86, B3). Saved server-side and
// emailed to support@ballboi.tennis. Opened from Settings, the ready-to-record
// screen, the processing card and the replay placeholder.

const logger = pino({ name: "feedback" });
const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/** The options on the form, in order. Keys are stored; labels are what the person saw. */
export const FEEDBACK_PROBLEMS = {
  recording_stopped: "Recording stopped on its own",
  upload_stuck: "Upload is stuck",
  camera_mic: "Camera or mic won't turn on",
  match_missing: "My match isn't there to record",
  score_not_saved: "Score didn't save",
  app_froze: "App froze or closed",
  something_else: "Something else",
} as const;
export type FeedbackProblem = keyof typeof FEEDBACK_PROBLEMS;

export const FEEDBACK_SOURCES = ["settings", "ready", "processing", "replay"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];

export const MAX_NOTE = 2000;
const MAX_DEVICE_FIELD = 80;
/** More than this many reports in an hour from one account is refused. */
export const MAX_REPORTS_PER_HOUR = 10;

export interface FeedbackInput {
  problem: FeedbackProblem;
  note: string | null;
  source: FeedbackSource;
  matchId: number | null;
  appVersion: string | null;
  deviceModel: string | null;
  osVersion: string | null;
}

function shortText(v: unknown, max = MAX_DEVICE_FIELD): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/** Checks what the app sent. Pure, for tests. */
export function parseFeedback(body: unknown): { ok: true; value: FeedbackInput } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const problem = typeof b.problem === "string" && b.problem in FEEDBACK_PROBLEMS ? (b.problem as FeedbackProblem) : null;
  if (!problem) return { ok: false, error: "Pick what's not working." };
  const rawNote = typeof b.note === "string" ? b.note.trim() : "";
  if (rawNote.length > MAX_NOTE) return { ok: false, error: `Keep it under ${MAX_NOTE} characters.` };
  if (problem === "something_else" && !rawNote) return { ok: false, error: "Tell us what's not working." };
  const source = (FEEDBACK_SOURCES as readonly string[]).includes(b.source as string) ? (b.source as FeedbackSource) : "settings";
  const matchId = Number(b.matchId);
  return {
    ok: true,
    value: {
      problem,
      note: rawNote || null,
      source,
      matchId: Number.isInteger(matchId) && matchId > 0 ? matchId : null,
      appVersion: shortText(b.appVersion),
      deviceModel: shortText(b.deviceModel),
      osVersion: shortText(b.osVersion),
    },
  };
}

const SOURCE_LABELS: Record<FeedbackSource, string> = {
  settings: "Settings",
  ready: "Ready-to-record screen",
  processing: "Processing card",
  replay: "Replay screen",
};

/** The email to support. Pure, for tests. */
export function feedbackEmail(
  report: FeedbackInput & { id: number; createdAt: Date },
  who: { clerkUserId: string; name: string | null; email: string | null },
): SupportEmail {
  const label = FEEDBACK_PROBLEMS[report.problem];
  const lines = [
    `Problem: ${label}`,
    `Note: ${report.note ?? "(none)"}`,
    "",
    `From: ${who.name ?? "Unknown"}${who.email ? ` <${who.email}>` : ""} (${who.clerkUserId})`,
    `Opened from: ${SOURCE_LABELS[report.source]}`,
    `Match: ${report.matchId ?? "(none)"}`,
    `App version: ${report.appVersion ?? "unknown"}`,
    `iPhone: ${report.deviceModel ?? "unknown"}`,
    `iOS: ${report.osVersion ?? "unknown"}`,
    `Sent: ${report.createdAt.toISOString()}`,
    `Report #${report.id}`,
  ];
  return { subject: `Something not working: ${label} (#${report.id})`, text: lines.join("\n"), replyTo: who.email };
}

export interface FeedbackDeps {
  send(email: SupportEmail): Promise<SendResult>;
}

const defaultDeps: FeedbackDeps = { send: (email) => sendSupportEmail(email) };

export function feedbackRouter(deps: FeedbackDeps = defaultDeps): IRouter {
  const r: IRouter = Router();

  /**
   * POST /feedback { problem, note?, source, matchId?, appVersion, deviceModel, osVersion }
   * Saves the report, then emails support. The email can fail without losing
   * the report: it stays saved with emailed_at empty.
   */
  r.post("/feedback", requireAuth, async (req: Request, res: Response) => {
    const userId = getAuth(req).userId!;
    const parsed = parseFeedback(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const input = parsed.value;
    try {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const [recent] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(supportReportsTable)
        .where(and(eq(supportReportsTable.clerkUserId, userId), gte(supportReportsTable.createdAt, hourAgo)));
      if ((recent?.n ?? 0) >= MAX_REPORTS_PER_HOUR) {
        res.status(429).json({ error: "You've sent a lot of reports this hour. Try again later, or email support@ballboi.tennis." });
        return;
      }

      // Attach the match only when the sender played in it.
      let matchId: number | null = null;
      if (input.matchId != null) {
        const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, input.matchId));
        if (match) {
          const ids = [match.player1Id, match.player2Id, match.player3Id, match.player4Id].filter((id): id is number => id != null);
          const mine = await db
            .select({ id: playersTable.id })
            .from(playersTable)
            .where(and(inArray(playersTable.id, ids), eq(playersTable.clerkUserId, userId)));
          if (mine.length > 0) matchId = match.id;
        }
      }

      const [row] = await db
        .insert(supportReportsTable)
        .values({ ...input, matchId, clerkUserId: userId })
        .returning();
      const [profile] = await db
        .select({ name: usersTable.displayName, email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, userId));
      const sent = await deps.send(
        feedbackEmail(
          { ...input, matchId, id: row.id, createdAt: row.createdAt },
          { clerkUserId: userId, name: profile?.name ?? null, email: profile?.email ?? null },
        ),
      );
      if (sent.sent) {
        await db.update(supportReportsTable).set({ emailedAt: new Date() }).where(eq(supportReportsTable.id, row.id));
      }
      res.status(201).json({ id: row.id });
    } catch (err) {
      logger.error({ err }, "Failed to save a support report");
      res.status(500).json({ error: "Couldn't send your report. Try again, or email support@ballboi.tennis." });
    }
  });

  return r;
}

router.use(feedbackRouter());

export default router;

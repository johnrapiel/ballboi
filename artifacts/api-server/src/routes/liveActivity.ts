// Live Activity on both phones (Wave 2, Session G; acceptance 31 to 35).
//
// The mounted phone sends what its Live Activity shows; the API opens and
// updates the same Live Activity on the other player's phone through Apple,
// and passes Start or Stop from that phone back to the mounted one.

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { logger } from "../lib/logger";
import { commandAllowed, isLiveCommand, parseLiveProps } from "../services/push/liveActivityPlan";
import {
  endSession,
  recorderUpdate,
  saveActivityToken,
  saveStartToken,
  sendCommand,
  viewSession,
} from "../services/push/liveActivity";

const router = Router();

const TOKEN = /^[0-9a-f]{32,512}$/i;
/** The phone's app install id: letters, digits and dashes. */
const INSTALL = /^[A-Za-z0-9-]{8,64}$/;

function matchIdOf(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** PUT /live-activity/start-token { token, installId? }: this phone's push-to-start token. */
router.put("/live-activity/start-token", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const token = String(req.body?.token ?? "");
  if (!TOKEN.test(token)) return res.status(400).json({ error: "Invalid token" });
  const rawInstall = req.body?.installId;
  const installId = typeof rawInstall === "string" && INSTALL.test(rawInstall) ? rawInstall : null;
  try {
    await saveStartToken(userId, token, installId);
    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Couldn't save a push-to-start token");
    return res.status(500).json({ error: "Couldn't save." });
  }
});

/** POST /live-activity/activity-token { token, activityId?, matchId? }: one running Live Activity's update token. */
router.post("/live-activity/activity-token", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const token = String(req.body?.token ?? "");
  if (!TOKEN.test(token)) return res.status(400).json({ error: "Invalid token" });
  const activityId = typeof req.body?.activityId === "string" ? req.body.activityId.slice(0, 200) : null;
  const matchId = req.body?.matchId == null ? null : matchIdOf(req.body.matchId);
  try {
    const saved = await saveActivityToken(userId, token, activityId, matchId);
    return res.json({ saved });
  } catch (err) {
    logger.error({ err }, "Couldn't save a Live Activity token");
    return res.status(500).json({ error: "Couldn't save." });
  }
});

/**
 * PUT /live/:matchId { ...props }: the mounted phone's state, sent on every
 * change and every few seconds. Answers with a Start or Stop from another
 * phone, once.
 */
router.put("/live/:matchId", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const matchId = matchIdOf(req.params.matchId);
  if (!matchId) return res.status(400).json({ error: "Invalid match id" });
  const props = parseLiveProps(matchId, req.body);
  if (!props) return res.status(400).json({ error: "Invalid Live Activity" });
  try {
    const result = await recorderUpdate(matchId, userId, props);
    if (!result) return res.status(404).json({ error: "Match not found" });
    return res.json(result);
  } catch (err) {
    logger.error({ err, matchId }, "Live Activity update failed");
    return res.status(500).json({ error: "Couldn't update the Live Activity." });
  }
});

/** DELETE /live/:matchId { ...finalProps? }: recording stopped or the recorder left. */
router.delete("/live/:matchId", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const matchId = matchIdOf(req.params.matchId);
  if (!matchId) return res.status(400).json({ error: "Invalid match id" });
  try {
    await endSession(matchId, userId, parseLiveProps(matchId, req.body));
    return res.json({ success: true });
  } catch (err) {
    logger.error({ err, matchId }, "Ending the Live Activity failed");
    return res.status(500).json({ error: "Couldn't end the Live Activity." });
  }
});

/** GET /live/:matchId: what the other player's phone shows. */
router.get("/live/:matchId", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const matchId = matchIdOf(req.params.matchId);
  if (!matchId) return res.status(400).json({ error: "Invalid match id" });
  try {
    const view = await viewSession(matchId, userId);
    if (!view) return res.status(404).json({ error: "Match not found" });
    return res.json(view);
  } catch (err) {
    logger.error({ err, matchId }, "Loading the live match failed");
    return res.status(500).json({ error: "Couldn't load the match. Try again." });
  }
});

/** POST /live/:matchId/command { command: "start" | "stop" }: from either player's phone. */
router.post("/live/:matchId/command", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const matchId = matchIdOf(req.params.matchId);
  if (!matchId) return res.status(400).json({ error: "Invalid match id" });
  const command = req.body?.command;
  if (!isLiveCommand(command)) return res.status(400).json({ error: "Invalid command" });
  try {
    const result = await sendCommand(matchId, userId, command, commandAllowed);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json({ success: true });
  } catch (err) {
    logger.error({ err, matchId }, "Live Activity command failed");
    return res.status(500).json({ error: "Couldn't reach the mounted phone. Try again." });
  }
});

export default router;

// DeviceCheck device bans (Wave 2, Session G; acceptance 38).
//
//   POST /api/account/device-check        { token }  Ball Boi opened on a phone.
//        Works while banned (so a banned phone still gets marked). Answers 403
//        "account_banned" when this account was just banned for using a banned
//        phone, which sends the app to the account-blocked screen.
//   GET  /api/admin/device-bans?active=false        the admin queue's phone bans
//   POST /api/admin/device-bans/:id/undo            undo: the phone can make
//        accounts again, and the account ban that came with it is lifted

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { logger } from "../lib/logger";
import { requireAdmin } from "../middlewares/requireAdmin";
import { checkIn, listDeviceBans, undoDeviceBan } from "../services/deviceBans";
import { BLOCKED_ERROR, validDeviceToken } from "../services/deviceBans/plan";

const router = Router();

router.post("/account/device-check", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const token = req.body?.token;
  if (!validDeviceToken(token)) return res.status(400).json({ error: "Invalid token" });
  try {
    const result = await checkIn(userId, token);
    if (result === "blocked") return res.status(403).json({ code: "account_banned", error: BLOCKED_ERROR });
    return res.json({ ok: true });
  } catch (err) {
    // A failed check never stops anyone using Ball Boi.
    logger.error({ err }, "Device check failed");
    return res.json({ ok: true });
  }
});

router.get("/admin/device-bans", requireAdmin, async (req, res) => {
  try {
    return res.json(await listDeviceBans(req.query.active !== "false"));
  } catch (err) {
    logger.error({ err }, "Couldn't load phone bans");
    return res.status(500).json({ error: "Couldn't load phone bans. Try again." });
  }
});

router.post("/admin/device-bans/:id/undo", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: "Not found." });
  try {
    const row = await undoDeviceBan(id, getAuth(req).userId ?? "admin", { liftSanction: true });
    if (!row) return res.status(409).json({ error: "This was already undone." });
    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Couldn't undo a phone ban");
    return res.status(500).json({ error: "Couldn't undo. Try again." });
  }
});

export default router;

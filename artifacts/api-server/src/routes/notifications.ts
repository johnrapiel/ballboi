import { Router } from "express";
import webpush from "web-push";
import { db } from "@workspace/db";
import { pushSubscriptionsTable, expoPushTokensTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { logger } from "../lib/logger";

const router = Router();

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT ?? "mailto:admin@hudsonvalleytennis.app",
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

async function sendExpoPushToUsers(
  userIds: string[],
  title: string,
  body: string,
  link: string = "/"
) {
  for (const userId of userIds) {
    const tokens = await db
      .select()
      .from(expoPushTokensTable)
      .where(
        and(
          eq(expoPushTokensTable.userId, userId),
          eq(expoPushTokensTable.status, "active")
        )
      );

    if (!tokens.length) continue;

    const messages = tokens.map((t) => ({
      to: t.token,
      sound: "default" as const,
      title,
      body,
      data: { link },
    }));

    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(messages),
      });

      if (!response.ok) {
        logger.warn({ userId, status: response.status }, "Expo push send returned non-OK status");
        continue;
      }

      const result = (await response.json()) as { data?: { status: string; message?: string }[] };
      const items = result.data ?? [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const token = tokens[i];
        if (!token) continue;

        if (item.status === "ok") {
          await db
            .update(expoPushTokensTable)
            .set({ lastUsed: new Date() })
            .where(eq(expoPushTokensTable.id, token.id));
        } else if (item.status === "error") {
          if (
            item.message?.includes("DeviceNotRegistered") ||
            item.message?.includes("InvalidCredentials")
          ) {
            await db
              .update(expoPushTokensTable)
              .set({ status: "invalid" })
              .where(eq(expoPushTokensTable.id, token.id));
          }
          logger.warn({ userId, token: token.token, message: item.message }, "Expo push send error for token");
        }
      }
    } catch (err) {
      logger.error({ err, userId }, "Failed to send Expo push notification");
    }
  }
}

export async function sendPushToUsers(
  userIds: string[],
  title: string,
  body: string,
  link: string = "/"
) {
  await Promise.all([
    sendWebPushToUsers(userIds, title, body, link),
    sendExpoPushToUsers(userIds, title, body, link),
  ]);
}

async function sendWebPushToUsers(
  userIds: string[],
  title: string,
  body: string,
  link: string = "/"
) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  for (const userId of userIds) {
    const subs = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(
        and(
          eq(pushSubscriptionsTable.userId, userId),
          eq(pushSubscriptionsTable.status, "active")
        )
      );
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { auth: sub.auth ?? "", p256dh: sub.p256dh ?? "" },
          },
          JSON.stringify({ title, body, link, tag: `match-${Date.now()}` })
        );
        await db
          .update(pushSubscriptionsTable)
          .set({ lastUsed: new Date() })
          .where(eq(pushSubscriptionsTable.id, sub.id));
      } catch (err: any) {
        if (err?.statusCode === 410) {
          await db
            .update(pushSubscriptionsTable)
            .set({ status: "invalid" })
            .where(eq(pushSubscriptionsTable.id, sub.id));
        }
      }
    }
  }
}

router.post("/notifications/subscribe", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { endpoint, keys } = req.body;
  if (!endpoint) return res.status(400).json({ error: "Missing endpoint" });

  const existing = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint));

  if (existing.length > 0) {
    await db
      .update(pushSubscriptionsTable)
      .set({ userId, status: "active" })
      .where(eq(pushSubscriptionsTable.endpoint, endpoint));
  } else {
    await db.insert(pushSubscriptionsTable).values({
      userId,
      endpoint,
      auth: keys?.auth ?? null,
      p256dh: keys?.p256dh ?? null,
      userAgent: req.get("user-agent") ?? null,
      status: "active",
    });
  }

  return res.json({ success: true });
});

router.post("/notifications/unsubscribe", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: "Missing endpoint" });

  await db
    .delete(pushSubscriptionsTable)
    .where(
      and(
        eq(pushSubscriptionsTable.userId, userId),
        eq(pushSubscriptionsTable.endpoint, endpoint)
      )
    );

  return res.json({ success: true });
});

router.get("/notifications/status", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.json({ subscribed: false });

  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(
      and(
        eq(pushSubscriptionsTable.userId, userId),
        eq(pushSubscriptionsTable.status, "active")
      )
    );

  return res.json({
    subscribed: subs.length > 0,
    deviceCount: subs.length,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null,
  });
});

router.post("/notifications/expo-token", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { token } = req.body as { token?: string };
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Missing token" });
  }

  const existing = await db
    .select()
    .from(expoPushTokensTable)
    .where(eq(expoPushTokensTable.token, token));

  if (existing.length > 0) {
    await db
      .update(expoPushTokensTable)
      .set({ userId, status: "active" })
      .where(eq(expoPushTokensTable.token, token));
  } else {
    await db.insert(expoPushTokensTable).values({
      userId,
      token,
      status: "active",
    });
  }

  return res.json({ success: true });
});

router.delete("/notifications/expo-token", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { token } = req.body as { token?: string };
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Missing token" });
  }

  await db
    .update(expoPushTokensTable)
    .set({ status: "invalid" })
    .where(
      and(
        eq(expoPushTokensTable.userId, userId),
        eq(expoPushTokensTable.token, token)
      )
    );

  return res.json({ success: true });
});

router.get("/notifications/expo-token/status", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.json({ registered: false });

  const tokens = await db
    .select()
    .from(expoPushTokensTable)
    .where(
      and(
        eq(expoPushTokensTable.userId, userId),
        eq(expoPushTokensTable.status, "active")
      )
    );

  return res.json({ registered: tokens.length > 0 });
});

export default router;

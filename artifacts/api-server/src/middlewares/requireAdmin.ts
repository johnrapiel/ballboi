import { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const user = await clerkClient.users.getUser(userId);
    const primaryEmail = user.emailAddresses.find(
      (e: { id: string; emailAddress: string }) => e.id === user.primaryEmailAddressId
    )?.emailAddress;

    if (primaryEmail !== ADMIN_EMAIL) {
      res.status(403).json({ error: "Forbidden: admin access required" });
      return;
    }

    next();
  } catch {
    res.status(500).json({ error: "Failed to verify admin status" });
  }
}

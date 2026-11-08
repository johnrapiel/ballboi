import { db, ballBoiSessionsTable, usersTable } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { ObjectNotFoundError, ObjectStorageService } from "./objectStorage";

// A17: profile photos. Uploading needs sign-in and only takes images up to
// 10 MB. The API serves a stored upload to the app only while it is someone's
// current profile photo, so a replaced or removed photo stops loading.

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"] as const;

const TOO_BIG = "Photos can be up to 10 MB.";
const NOT_A_PHOTO = "Choose a JPEG, PNG, HEIC or WebP photo.";

export function isPhotoType(contentType: string | null | undefined): boolean {
  const base = contentType?.split(";")[0].trim().toLowerCase();
  return !!base && (PHOTO_TYPES as readonly string[]).includes(base);
}

/** Checks what the app says it's about to upload. Returns a problem, or null. */
export function uploadRequestProblem(input: { size: number; contentType: string }): string | null {
  if (!isPhotoType(input.contentType)) return NOT_A_PHOTO;
  if (!Number.isFinite(input.size) || input.size <= 0) return "That photo looks empty. Try another one.";
  if (input.size > MAX_PHOTO_BYTES) return TOO_BIG;
  return null;
}

const UPLOAD_PATH = /^\/objects\/uploads\/[A-Za-z0-9-]+$/;

type Storage = Pick<ObjectStorageService, "headObject" | "deleteObject">;
const defaultStorage = new ObjectStorageService();

/**
 * Checks a new `avatarUrl` before it's saved: a fresh upload of this API, not
 * Ball Boi video, not someone else's photo, and actually an image of 10 MB or
 * less. Returns a problem, or null. Clearing the photo, or sending back the
 * one already saved, is always fine.
 */
export async function newPhotoProblem(
  avatarUrl: unknown,
  current: string | null | undefined,
  clerkUserId: string,
  storage: Storage = defaultStorage,
): Promise<string | null> {
  if (avatarUrl === null || avatarUrl === "" || avatarUrl === current) return null;
  if (typeof avatarUrl !== "string" || !UPLOAD_PATH.test(avatarUrl)) return "That photo didn't upload. Try again.";

  const [[video], [taken]] = await Promise.all([
    db.select({ id: ballBoiSessionsTable.id }).from(ballBoiSessionsTable).where(eq(ballBoiSessionsTable.videoObjectPath, avatarUrl)),
    db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.avatarUrl, avatarUrl), ne(usersTable.clerkUserId, clerkUserId))),
  ]);
  if (video || taken) return "That photo didn't upload. Try again.";

  try {
    const head = await storage.headObject(avatarUrl);
    if (!isPhotoType(head.contentType)) return NOT_A_PHOTO;
    if (head.contentLength == null || head.contentLength > MAX_PHOTO_BYTES) return TOO_BIG;
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return "That photo didn't upload. Try again.";
    throw err;
  }
  return null;
}

/** Whether a stored upload is someone's current profile photo. */
export async function isCurrentPhoto(objectPath: string): Promise<boolean> {
  const [row] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.avatarUrl, objectPath));
  return !!row;
}

/**
 * Deletes a replaced or removed photo's file, unless another profile still
 * points at it. Best effort: serving already stops once it isn't current.
 */
export async function deleteOldPhoto(
  previous: string | null | undefined,
  next: string | null | undefined,
  log: { warn: (o: object, m: string) => void },
  storage: Storage = defaultStorage,
): Promise<void> {
  if (!previous || previous === next || !UPLOAD_PATH.test(previous)) return;
  try {
    if (await isCurrentPhoto(previous)) return;
    await storage.deleteObject(previous);
  } catch (err) {
    log.warn({ err }, "Couldn't delete an old profile photo");
  }
}

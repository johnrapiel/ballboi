import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// A17: a profile photo must be a fresh image upload of 10 MB or less, and a
// replaced or removed photo's file is deleted.

let mockUserId: string | null = "user_me";
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mockUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: vi.fn() } },
}));
vi.mock("pino", () => ({ default: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));
const autoLinkPlayersForUser = vi.fn().mockResolvedValue(0);
vi.mock("../lib/autoLinkPlayer.js", () => ({ autoLinkPlayersForUser: (...a: unknown[]) => autoLinkPlayersForUser(...a) }));
vi.mock("../lib/accountDeletion.js", () => ({ deleteAccount: vi.fn() }));

const head = vi.fn();
const deleteObject = vi.fn();
vi.mock("../lib/objectStorage", () => ({
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
  ObjectStorageService: class {
    headObject = (...a: unknown[]) => head(...a);
    deleteObject = (...a: unknown[]) => deleteObject(...a);
  },
}));

// Answers by table: the caller's own profile, other profiles using a photo,
// and Ball Boi sessions using a path.
let myProfile: Record<string, unknown> | undefined;
let otherUsersWithPhoto: unknown[] = [];
let videoSessions: unknown[] = [];
const writes: { op: string; values: Record<string, unknown> }[] = [];

const chain = (value: unknown): unknown =>
  new Proxy({}, { get(_t, prop) {
    if (prop === "then") return (f: (v: unknown) => unknown) => Promise.resolve(value).then(f);
    return () => chain(value);
  } });

vi.mock("@workspace/db", () => ({
  db: {
    select: (fields?: Record<string, unknown>) => ({
      from: (t: { __name: string }) => {
        if (t.__name === "ball_boi_sessions") return chain(videoSessions);
        // A select with picked fields is a lookup of who uses a photo.
        if (fields) return chain(otherUsersWithPhoto);
        return chain(myProfile ? [myProfile] : []);
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        writes.push({ op: "update", values });
        return { where: () => ({ returning: async () => [{ ...myProfile, ...values }] }) };
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        writes.push({ op: "insert", values });
        return { returning: async () => [values] };
      },
    }),
  },
  usersTable: { __name: "users", id: {}, clerkUserId: {}, avatarUrl: {} },
  ballBoiSessionsTable: { __name: "ball_boi_sessions", id: {}, videoObjectPath: {} },
}));

import usersRouter from "../routes/users";
import { isPhotoType, uploadRequestProblem } from "../lib/profilePhoto";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api", usersRouter);
  return supertest(a);
}

const NEW = "/objects/uploads/0b6f8b1e-1111-4c1d-9d5e-000000000001";
const OLD = "/objects/uploads/0b6f8b1e-1111-4c1d-9d5e-000000000000";

beforeEach(() => {
  mockUserId = "user_me";
  myProfile = { id: 1, clerkUserId: "user_me", displayName: "John", avatarUrl: OLD };
  otherUsersWithPhoto = [];
  videoSessions = [];
  writes.length = 0;
  head.mockReset().mockResolvedValue({ contentType: "image/jpeg", contentLength: 900_000 });
  deleteObject.mockReset().mockResolvedValue(undefined);
  autoLinkPlayersForUser.mockClear();
});

describe("photo rules", () => {
  it("knows photo types", () => {
    expect(isPhotoType("image/jpeg")).toBe(true);
    expect(isPhotoType("image/HEIC")).toBe(true);
    expect(isPhotoType("image/svg+xml")).toBe(false);
    expect(isPhotoType("text/html")).toBe(false);
  });

  it("checks what the app is about to upload", () => {
    expect(uploadRequestProblem({ size: 1_000, contentType: "image/png" })).toBeNull();
    expect(uploadRequestProblem({ size: 0, contentType: "image/png" })).not.toBeNull();
    expect(uploadRequestProblem({ size: 11 * 1024 * 1024, contentType: "image/png" })).toMatch(/10 MB/);
    expect(uploadRequestProblem({ size: 1_000, contentType: "application/pdf" })).not.toBeNull();
  });
});

describe("PUT /users/me with a photo", () => {
  it("saves a new photo and deletes the old file", async () => {
    const res = await app().put("/api/users/me").send({ displayName: "John", avatarUrl: NEW });
    expect(res.status).toBe(200);
    expect(writes[0].values.avatarUrl).toBe(NEW);
    expect(deleteObject).toHaveBeenCalledWith(OLD);
  });

  it("removing the photo deletes its file", async () => {
    const res = await app().put("/api/users/me").send({ displayName: "John", avatarUrl: null });
    expect(res.status).toBe(200);
    expect(deleteObject).toHaveBeenCalledWith(OLD);
  });

  it("saving the same photo again keeps the file", async () => {
    const res = await app().put("/api/users/me").send({ displayName: "John", avatarUrl: OLD });
    expect(res.status).toBe(200);
    expect(head).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("refuses a file over 10 MB", async () => {
    head.mockResolvedValue({ contentType: "image/jpeg", contentLength: 10 * 1024 * 1024 + 1 });
    const res = await app().put("/api/users/me").send({ avatarUrl: NEW });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/10 MB/);
    expect(writes).toHaveLength(0);
  });

  it("refuses a file that isn't a photo", async () => {
    head.mockResolvedValue({ contentType: "text/html", contentLength: 100 });
    const res = await app().put("/api/users/me").send({ avatarUrl: NEW });
    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it("refuses someone else's photo or a Ball Boi video", async () => {
    otherUsersWithPhoto = [{ id: 2 }];
    expect((await app().put("/api/users/me").send({ avatarUrl: NEW })).status).toBe(400);
    otherUsersWithPhoto = [];
    videoSessions = [{ id: 9 }];
    expect((await app().put("/api/users/me").send({ avatarUrl: NEW })).status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it("refuses an outside web address", async () => {
    const res = await app().put("/api/users/me").send({ avatarUrl: "https://example.com/pixel.png" });
    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });
});

describe("account linking runs only when the profile is made (A2)", () => {
  it("POST /users/me for a new person links by their account, not the request", async () => {
    myProfile = undefined;
    const res = await app().post("/api/users/me").send({ displayName: "Bob", email: "victim@example.com", avatarUrl: null });
    expect(res.status).toBe(201);
    expect(autoLinkPlayersForUser).toHaveBeenCalledTimes(1);
    expect(autoLinkPlayersForUser).toHaveBeenCalledWith("user_me");
  });

  it("saving an existing profile never links", async () => {
    await app().post("/api/users/me").send({ displayName: "Deleted player", email: "victim@example.com" }).expect(200);
    await app().put("/api/users/me").send({ displayName: "Someone Else", email: "victim@example.com" }).expect(200);
    expect(autoLinkPlayersForUser).not.toHaveBeenCalled();
  });
});

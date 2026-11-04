import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import { Readable } from "stream";

// Spec (Video and training data): match video is never shown in the app.
// Only the ML server, with its secret, can read Ball Boi video from storage.
// A17: uploading needs sign-in and takes only photos up to 10 MB, and only a
// current profile photo loads in the app.

let mockUserId: string | null = "user_recorder";
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: mockUserId }) }));

let storedType = "video/mp4";
const createUploadURL = vi.fn(async () => ({ uploadURL: "https://storage.test/put", objectPath: "/objects/uploads/new-1" }));
vi.mock("../lib/objectStorage", () => ({
  ObjectNotFoundError: class extends Error {},
  ObjectStorageService: class {
    getObject = vi.fn().mockImplementation(async () => ({ contentType: storedType, contentLength: 5, body: Readable.from([Buffer.from("bytes")]) }));
    headObject = vi.fn();
    deleteObject = vi.fn();
    createUploadURL = createUploadURL;
  },
}));

// Each select answers from the table it reads.
let sessions: unknown[] = [];
let users: unknown[] = [];
const chain = (value: unknown): unknown =>
  new Proxy({}, { get(_t, prop) {
    if (prop === "then") return (f: (v: unknown) => unknown) => Promise.resolve(value).then(f);
    return () => chain(value);
  } });
vi.mock("@workspace/db", () => ({
  get db() {
    return {
      select: () => ({
        from: (t: { __name: string }) => chain(t.__name === "users" ? users : sessions),
      }),
    };
  },
  ballBoiSessionsTable: { __name: "ball_boi_sessions", videoObjectPath: {}, id: {} },
  usersTable: { __name: "users", id: {}, avatarUrl: {}, clerkUserId: {} },
}));

async function app() {
  const { default: router } = await import("../routes/storage.js");
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { (req as unknown as { log: unknown }).log = { error: vi.fn(), warn: vi.fn() }; next(); });
  a.use("/api", router);
  return a;
}

beforeEach(() => {
  process.env.ML_SECRET = "s3cret";
  mockUserId = "user_recorder";
  sessions = [];
  users = [];
  storedType = "video/mp4";
  createUploadURL.mockClear();
});

describe("GET /storage/objects", () => {
  it("the ML server can read a match upload", async () => {
    sessions = [{ id: 1, recordedByClerkUserId: "user_recorder", videoObjectPath: "/objects/uploads/match.mp4" }];
    const res = await supertest(await app()).get("/api/storage/objects/uploads/match.mp4").set("x-ml-secret", "s3cret");
    expect(res.status).toBe(200);
  });

  it("the player who recorded it can't, even signed in", async () => {
    sessions = [{ id: 1, recordedByClerkUserId: "user_recorder", videoObjectPath: "/objects/uploads/match.mp4" }];
    const res = await supertest(await app()).get("/api/storage/objects/uploads/match.mp4");
    expect(res.status).toBe(403);
  });

  it("training copies are closed to everyone but the ML server", async () => {
    expect((await supertest(await app()).get("/api/storage/objects/training/session-1.mp4")).status).toBe(403);
    expect((await supertest(await app()).get("/api/storage/objects/training/session-1.mp4").set("x-ml-secret", "s3cret")).status).toBe(200);
  });

  it("a current profile photo loads in the app without a sign-in header", async () => {
    storedType = "image/jpeg";
    users = [{ id: 3 }];
    const res = await supertest(await app()).get("/api/storage/objects/uploads/avatar-1");
    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("a replaced or removed photo no longer loads", async () => {
    storedType = "image/jpeg";
    users = [];
    expect((await supertest(await app()).get("/api/storage/objects/uploads/avatar-old")).status).toBe(404);
  });

  it("a file that isn't an image doesn't load, even if a profile points at it", async () => {
    storedType = "text/html";
    users = [{ id: 3 }];
    expect((await supertest(await app()).get("/api/storage/objects/uploads/page")).status).toBe(404);
  });
});

describe("POST /storage/uploads/request-url", () => {
  const photo = { name: "profile-photo", size: 2_000_000, contentType: "image/jpeg" };

  it("needs sign-in", async () => {
    mockUserId = null;
    expect((await supertest(await app()).post("/api/storage/uploads/request-url").send(photo)).status).toBe(401);
    expect(createUploadURL).not.toHaveBeenCalled();
  });

  it("gives a signed-in player an upload address for a photo", async () => {
    const res = await supertest(await app()).post("/api/storage/uploads/request-url").send(photo);
    expect(res.status).toBe(200);
    expect(res.body.objectPath).toBe("/objects/uploads/new-1");
  });

  it("takes photos only", async () => {
    const res = await supertest(await app()).post("/api/storage/uploads/request-url").send({ ...photo, contentType: "video/mp4" });
    expect(res.status).toBe(400);
    expect(createUploadURL).not.toHaveBeenCalled();
  });

  it("takes photos up to 10 MB", async () => {
    const ok = await supertest(await app()).post("/api/storage/uploads/request-url").send({ ...photo, size: 10 * 1024 * 1024 });
    expect(ok.status).toBe(200);
    const big = await supertest(await app()).post("/api/storage/uploads/request-url").send({ ...photo, size: 10 * 1024 * 1024 + 1 });
    expect(big.status).toBe(400);
    expect(big.body.error).toMatch(/10 MB/);
  });
});

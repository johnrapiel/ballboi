import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import { Readable } from "stream";

// Spec (Video and training data): match video is never shown in the app.
// Only the ML server, with its secret, can read Ball Boi video from storage.

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: "user_recorder" }) }));
vi.mock("../lib/objectStorage", () => ({
  ObjectNotFoundError: class extends Error {},
  ObjectStorageService: class {
    getObject = vi.fn().mockImplementation(async () => ({ contentType: "video/mp4", contentLength: 5, body: Readable.from([Buffer.from("video")]) }));
    createUploadURL = vi.fn();
  },
}));
let sessions: unknown[] = [];
const chain = (value: unknown): unknown =>
  new Proxy({}, { get(_t, prop) {
    if (prop === "then") return (f: (v: unknown) => unknown) => Promise.resolve(value).then(f);
    return () => chain(value);
  } });
vi.mock("@workspace/db", () => ({
  get db() { return { select: () => chain(sessions) }; },
  ballBoiSessionsTable: { videoObjectPath: {} },
}));

async function app() {
  const { default: router } = await import("../routes/storage.js");
  const a = express();
  a.use((req, _res, next) => { (req as unknown as { log: unknown }).log = { error: vi.fn(), warn: vi.fn() }; next(); });
  a.use("/api", router);
  return a;
}

beforeEach(() => {
  process.env.ML_SECRET = "s3cret";
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
    sessions = [];
    expect((await supertest(await app()).get("/api/storage/objects/training/session-1.mp4")).status).toBe(403);
    expect((await supertest(await app()).get("/api/storage/objects/training/session-1.mp4").set("x-ml-secret", "s3cret")).status).toBe(200);
  });

  it("other uploads still work as before", async () => {
    sessions = [];
    expect((await supertest(await app()).get("/api/storage/objects/uploads/avatar.png")).status).toBe(200);
  });
});

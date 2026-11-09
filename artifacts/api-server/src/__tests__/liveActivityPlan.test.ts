import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { appleKeyFrom, signAppleJwt } from "../services/push/appleKey";
import { tokenIsDead } from "../services/push/apns";
import {
  canControl,
  commandAllowed,
  contentState,
  endPayload,
  liveViewers,
  needsStart,
  parseLiveProps,
  startPayload,
  stoppedProps,
  updatePayload,
  worthPushing,
  type LiveProps,
} from "../services/push/liveActivityPlan";

const body = {
  players: "John Rapiel vs. Sam Whitfield",
  stage: "setup",
  status: "Setting up",
  court: "Finding the court",
  battery: "Battery 80%",
  caption: "Mount your phone behind the baseline, camera facing the court.",
  countdownTo: null,
  recordingSince: null,
  canStart: true,
  canStop: false,
};

describe("parseLiveProps", () => {
  it("keeps a good update and builds the links itself", () => {
    const p = parseLiveProps(12, { ...body, startUrl: "https://evil.example" })!;
    expect(p.matchId).toBe(12);
    expect(p.startUrl).toBe("ballboi://live/12?action=start");
    expect(p.stopUrl).toBe("ballboi://live/12?action=stop");
    expect(p.openUrl).toBe("ballboi://live/12");
    expect(p.caption).toBe(body.caption);
  });

  it("refuses an unknown stage or missing words", () => {
    expect(parseLiveProps(1, { ...body, stage: "dancing" })).toBeNull();
    expect(parseLiveProps(1, { ...body, status: "" })).toBeNull();
    expect(parseLiveProps(1, null)).toBeNull();
  });

  it("drops text that's too long and times that aren't times", () => {
    const p = parseLiveProps(1, { ...body, caption: "x".repeat(400), countdownTo: "soon", recordingSince: -5 })!;
    expect(p.caption).toBeNull();
    expect(p.countdownTo).toBeNull();
    expect(p.recordingSince).toBeNull();
  });

  it("only true turns the buttons on", () => {
    const p = parseLiveProps(1, { ...body, canStart: "yes", canStop: 1 })!;
    expect(p.canStart).toBe(false);
    expect(p.canStop).toBe(false);
  });
});

describe("who gets the Live Activity (G7)", () => {
  it("every other player with an account, once", () => {
    expect(
      liveViewers("rec", [{ clerkUserId: "rec" }, { clerkUserId: "b" }, { clerkUserId: null }, { clerkUserId: "b" }, { clerkUserId: "c" }]),
    ).toEqual(["b", "c"]);
  });

  it("a Quick match stranger's stand-in has no account until Yes, so nothing until then (acceptance 33)", () => {
    expect(liveViewers("rec", [{ clerkUserId: "rec" }, { clerkUserId: null }])).toEqual([]);
    // After Yes the stand-in carries their account.
    expect(liveViewers("rec", [{ clerkUserId: "rec" }, { clerkUserId: "stranger" }])).toEqual(["stranger"]);
  });

  it("starts it at most once per person", () => {
    expect(needsStart(["b", "c"], ["b"])).toEqual(["c"]);
    expect(needsStart(["b"], ["b"])).toEqual([]);
  });

  it("either player has full controls; nobody else does (acceptance 32)", () => {
    expect(canControl("rec", "rec", ["b"])).toBe(true);
    expect(canControl("b", "rec", ["b"])).toBe(true);
    expect(canControl("x", "rec", ["b"])).toBe(false);
  });
});

describe("Start and Stop", () => {
  const p = parseLiveProps(3, body)!;
  it("follow what the mounted phone says is possible", () => {
    expect(commandAllowed(p, "start")).toBe(true);
    expect(commandAllowed(p, "stop")).toBe(false);
    const rec: LiveProps = { ...p, stage: "recording", canStart: false, canStop: true };
    expect(commandAllowed(rec, "start")).toBe(false);
    expect(commandAllowed(rec, "stop")).toBe(true);
  });
});

describe("Apple payloads", () => {
  const p = parseLiveProps(3, body)!;

  it("content-state carries the layout name and the props as JSON, as expo-widgets reads them", () => {
    const cs = contentState(p);
    expect(cs.name).toBe("MatchActivity");
    expect(JSON.parse(cs.props).caption).toBe(body.caption);
  });

  it("push-to-start names the attributes type and opens the match", () => {
    const s = startPayload(p, 1000, { title: "Ball Boi", body: "John is setting up Ball Boi for your match." });
    expect(s.aps.event).toBe("start");
    expect(s.aps["attributes-type"]).toBe("LiveActivityAttributes");
    expect(s.aps.attributes.url).toBe("ballboi://live/3");
    expect(s.aps.timestamp).toBe(1000);
  });

  it("update and end", () => {
    expect(updatePayload(p, 5).aps.event).toBe("update");
    const end = endPayload(p, 100);
    expect(end.aps.event).toBe("end");
    expect(end.aps["dismissal-date"]).toBe(400);
  });

  it("the stopped state has no buttons", () => {
    const s = stoppedProps({ ...p, stage: "recording", canStop: true });
    expect(s.stage).toBe("stopped");
    expect(s.canStart || s.canStop).toBe(false);
  });

  it("no captions mention holding the screen (X2)", () => {
    expect(JSON.stringify(startPayload(p, 1, { title: "", body: "" }))).not.toMatch(/hold the screen|press and hold/i);
  });
});

describe("worthPushing", () => {
  const p = parseLiveProps(3, body)!;
  it("skips a heartbeat with nothing new", () => {
    expect(worthPushing(p, { ...p })).toBe(false);
  });
  it("sends a new caption, stage or battery", () => {
    expect(worthPushing(p, { ...p, caption: "Hold your phone there." })).toBe(true);
    expect(worthPushing(p, { ...p, stage: "waiting" })).toBe(true);
    expect(worthPushing(p, { ...p, battery: "Battery 75%" })).toBe(true);
    expect(worthPushing(null, p)).toBe(true);
  });
});

describe("Apple key", () => {
  it("is off until all three secrets are set", () => {
    expect(appleKeyFrom({})).toBeNull();
    expect(appleKeyFrom({ APPLE_KEY_ID: "K", APPLE_TEAM_ID: "T" })).toBeNull();
  });

  it("accepts a key pasted on one line with \\n", () => {
    const k = appleKeyFrom({ APPLE_KEY_ID: "K", APPLE_TEAM_ID: "T", APPLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----" })!;
    expect(k.privateKey.split("\n")).toHaveLength(3);
    expect(k.bundleId).toBe("tennis.ballboi");
  });

  it("signs an ES256 token Apple can check", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const key = appleKeyFrom({ APPLE_KEY_ID: "ABC123DEFG", APPLE_TEAM_ID: "TEAM123456", APPLE_PRIVATE_KEY: pem })!;
    const jwt = signAppleJwt(key, 1_700_000_000);
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toEqual({ iss: "TEAM123456", iat: 1_700_000_000 });
    const ok = crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
    expect(ok).toBe(true);
  });

  it("drops tokens Apple says are gone", () => {
    expect(tokenIsDead({ ok: false, status: 410, reason: "Unregistered", env: "production" })).toBe(true);
    expect(tokenIsDead({ ok: false, status: 400, reason: "BadDeviceToken", env: "production" })).toBe(false);
  });
});

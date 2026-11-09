import { describe, expect, it } from "vitest";

import { RECORD_ANYWAY_MS } from "@/lib/court/aim";
import {
  arm,
  countdownMs,
  fallbackDue,
  lockLineAllowed,
  NOT_RECORDING_YET,
  onCourtLocked,
  onCourtLost,
  startAnyway,
  timeLeft,
} from "@/lib/recording/armedStart";

const GO = 5047;
const T0 = 1_000_000;

describe("armed start", () => {
  it("countdown length: Now is as long as line 19, otherwise the minutes chosen", () => {
    expect(countdownMs(0, GO)).toBe(GO);
    expect(countdownMs(5, GO)).toBe(5 * 60_000);
    expect(countdownMs(15, GO)).toBe(15 * 60_000);
  });

  it("armed: Record tapped without a lock waits for the court, and the clock doesn't run", () => {
    const s = arm(5, T0, GO, false);
    expect(s.stage).toBe("waiting");
    expect(s.waitingSince).toBe(T0);
    expect(timeLeft(s, T0 + 60_000)).toBe(5 * 60_000);
  });

  it("already locked when Record is tapped: counting straight away", () => {
    const s = arm(10, T0, GO, true);
    expect(s.stage).toBe("counting");
    expect(s.startAt).toBe(T0 + 10 * 60_000);
  });

  it("locked: the countdown starts by itself with the whole time chosen", () => {
    const s = onCourtLocked(arm(5, T0, GO, false), T0 + 30_000);
    expect(s.stage).toBe("counting");
    expect(s.anyway).toBe(false);
    expect(timeLeft(s, T0 + 30_000)).toBe(5 * 60_000);
    expect(timeLeft(s, T0 + 90_000)).toBe(4 * 60_000);
  });

  it("Now: locking starts the line 19 countdown", () => {
    const s = onCourtLocked(arm(0, T0, GO, false), T0 + 10_000);
    expect(s.stage).toBe("counting");
    expect(s.startAt).toBe(T0 + 10_000 + GO);
  });

  it("counting: locking again changes nothing", () => {
    const s = arm(5, T0, GO, true);
    expect(onCourtLocked(s, T0 + 5000)).toEqual(s);
  });

  it("paused: a bump mid-countdown keeps the time left and starts a new wait", () => {
    const s = arm(5, T0, GO, true);
    const p = onCourtLost(s, T0 + 60_000, GO, false);
    expect(p.stage).toBe("paused");
    expect(p.msLeft).toBe(4 * 60_000);
    expect(p.waitingSince).toBe(T0 + 60_000);
    // The clock stays put while paused.
    expect(timeLeft(p, T0 + 120_000)).toBe(4 * 60_000);
  });

  it("paused, then locked again: carries on from where it stopped", () => {
    const p = onCourtLost(arm(5, T0, GO, true), T0 + 60_000, GO, false);
    const r = onCourtLocked(p, T0 + 100_000);
    expect(r.stage).toBe("counting");
    expect(timeLeft(r, T0 + 100_000)).toBe(4 * 60_000);
    expect(r.totalMs).toBe(5 * 60_000);
  });

  it("a bump once line 19 has started doesn't pause: capture is moments away", () => {
    const s = arm(5, T0, GO, true);
    expect(onCourtLost(s, s.startAt - 3000, GO, true).stage).toBe("counting");
    // Line 19 is due but not flagged yet: still no pause.
    expect(onCourtLost(s, s.startAt - GO, GO, false).stage).toBe("counting");
  });

  it("a bump while waiting changes nothing", () => {
    const s = arm(5, T0, GO, false);
    expect(onCourtLost(s, T0 + 1000, GO, false)).toEqual(s);
  });

  it("fallback: line 12 is due about 20 seconds after arming, not after opening the camera", () => {
    const s = arm(5, T0, GO, false);
    expect(fallbackDue(s, T0 + RECORD_ANYWAY_MS - 1)).toBe(false);
    expect(fallbackDue(s, T0 + RECORD_ANYWAY_MS)).toBe(true);
    expect(fallbackDue(null, T0 + RECORD_ANYWAY_MS)).toBe(false);
  });

  it("fallback: never while counting", () => {
    const s = arm(5, T0, GO, true);
    expect(fallbackDue(s, T0 + RECORD_ANYWAY_MS * 3)).toBe(false);
  });

  it("fallback: after line 12 the countdown starts anyway, with the whole time chosen", () => {
    const s = arm(10, T0, GO, false);
    const c = startAnyway(s, T0 + 25_000);
    expect(c.stage).toBe("counting");
    expect(c.anyway).toBe(true);
    expect(timeLeft(c, T0 + 25_000)).toBe(10 * 60_000);
  });

  it("fallback while paused: 20 seconds from the bump, then it carries on from where it stopped", () => {
    const p = onCourtLost(arm(5, T0, GO, true), T0 + 60_000, GO, false);
    expect(fallbackDue(p, T0 + 60_000 + RECORD_ANYWAY_MS - 1)).toBe(false);
    expect(fallbackDue(p, T0 + 60_000 + RECORD_ANYWAY_MS)).toBe(true);
    const c = startAnyway(p, T0 + 90_000);
    expect(timeLeft(c, T0 + 90_000)).toBe(4 * 60_000);
  });

  it("counting anyway, then the court locks: no longer an anyway countdown, same time left", () => {
    const c = startAnyway(arm(5, T0, GO, false), T0 + 25_000);
    const l = onCourtLocked(c, T0 + 40_000);
    expect(l.anyway).toBe(false);
    expect(l.startAt).toBe(c.startAt);
  });
});

describe("the lock line never plays once capture is due (Nov 9)", () => {
  it("plays while setting up, before line 19", () => {
    expect(lockLineAllowed(true, false)).toBe(true);
  });

  it("stays quiet once line 19 has started, so it can't land in the recording", () => {
    expect(lockLineAllowed(true, true)).toBe(false);
  });

  it("stays quiet outside setup", () => {
    expect(lockLineAllowed(false, false)).toBe(false);
  });

  it("Record anyway with Start Now: a lock during line 19 doesn't pause it or replay the lock", () => {
    const anyway = startAnyway(arm(0, T0, GO, false), T0 + RECORD_ANYWAY_MS);
    expect(anyway.stage).toBe("counting");
    expect(onCourtLocked(anyway, T0 + RECORD_ANYWAY_MS + 1000).stage).toBe("counting");
    expect(lockLineAllowed(true, true)).toBe(false);
  });

  it("Record with no lock waits: nothing counts down until the court locks or the fallback", () => {
    const s = arm(0, T0, GO, false);
    expect(s.stage).toBe("waiting");
    expect(fallbackDue(s, T0 + RECORD_ANYWAY_MS - 1)).toBe(false);
    expect(timeLeft(s, T0 + 60_000)).toBe(GO);
    expect(NOT_RECORDING_YET).toBe("Not recording yet");
  });
});

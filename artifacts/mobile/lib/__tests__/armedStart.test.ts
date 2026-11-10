import { describe, expect, it } from "vitest";

import { RECORD_ANYWAY_MS } from "@/lib/court/aim";
import { MOVED_DEGREES } from "@/lib/court/motion";
import {
  arm,
  countdownMs,
  fallbackDue,
  nextStillness,
  lockLineAllowed,
  NOT_RECORDING_YET,
  onCourtLocked,
  onCourtLost,
  startAnyway,
  startMatch,
  startStillness,
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

describe("Start match on a Lock Screen arms like Record (Nov 9)", () => {
  it("while waiting for the court it doesn't start capture without a lock", () => {
    const s = startMatch(null, 0, T0, GO, false);
    expect(s).not.toBeNull();
    expect(s!.stage).toBe("waiting");
    // Line 19 and capture don't come: the clock doesn't run.
    expect(timeLeft(s!, T0 + 60_000)).toBe(GO);
    // Tapped again while armed, paused or counting: nothing new.
    expect(startMatch(s, 0, T0 + 5000, GO, false)).toBeNull();
    const counting = arm(5, T0, GO, true);
    expect(startMatch(counting, 0, T0 + 5000, GO, true)).toBeNull();
    const paused = onCourtLost(counting, T0 + 60_000, GO, false);
    expect(startMatch(paused, 0, T0 + 70_000, GO, false)).toBeNull();
  });

  it("then the court locks: the countdown runs, exactly as after Record", () => {
    const s = startMatch(null, 0, T0, GO, false)!;
    const locked = onCourtLocked(s, T0 + 8000);
    expect(locked).toEqual(onCourtLocked(arm(0, T0, GO, false), T0 + 8000));
    expect(locked.startAt).toBe(T0 + 8000 + GO);
  });

  it("after a lock it behaves like Record: counting straight away, with the chosen countdown", () => {
    expect(startMatch(null, 0, T0, GO, true)).toEqual(arm(0, T0, GO, true));
    expect(startMatch(null, 10, T0, GO, true)).toEqual(arm(10, T0, GO, true));
    expect(startMatch(null, 0, T0, GO, true)!.stage).toBe("counting");
  });

  it("the Record anyway fallback still applies after Start match", () => {
    const s = startMatch(null, 0, T0, GO, false)!;
    expect(fallbackDue(s, T0 + RECORD_ANYWAY_MS, T0)).toBe(true);
  });
});

describe("the 20 seconds only run while the phone holds still (Nov 9)", () => {
  const level = { alpha: 0, beta: 0, gamma: 0 };
  const turned = (deg: number) => ({ alpha: (deg * Math.PI) / 180, beta: 0, gamma: 0 });

  it("small wobble counts as still; a move like line 13's restarts it", () => {
    let st = nextStillness(startStillness(T0), level, T0);
    expect(st.since).toBe(T0);
    st = nextStillness(st, turned(MOVED_DEGREES - 1), T0 + 1000);
    expect(st.since).toBe(T0);
    st = nextStillness(st, turned(MOVED_DEGREES + 5), T0 + 2000);
    expect(st.since).toBe(T0 + 2000);
    // No reading: nothing changes.
    expect(nextStillness(st, null, T0 + 3000)).toEqual(st);
  });

  it("don't run while the phone is moving", () => {
    const s = arm(0, T0, GO, false);
    let st = startStillness(T0);
    // Moving the whole time: a new move every second, for a minute.
    for (let t = 0; t <= 60; t++) st = nextStillness(st, turned(t * 10), T0 + t * 1000);
    expect(fallbackDue(s, T0 + 60_000, st.since)).toBe(false);
  });

  it("start once it's still, and restart after a move before the lock", () => {
    const s = arm(0, T0, GO, false);
    // Mounting takes 15 seconds, then it holds still.
    let st = nextStillness(startStillness(T0), turned(30), T0 + 15_000);
    expect(fallbackDue(s, T0 + 15_000 + RECORD_ANYWAY_MS - 1, st.since)).toBe(false);
    // Moved at 25 seconds: the 20 seconds start again from there.
    st = nextStillness(st, turned(50), T0 + 25_000);
    expect(fallbackDue(s, T0 + 35_000, st.since)).toBe(false);
    expect(fallbackDue(s, T0 + 25_000 + RECORD_ANYWAY_MS - 1, st.since)).toBe(false);
    expect(fallbackDue(s, T0 + 25_000 + RECORD_ANYWAY_MS, st.since)).toBe(true);
  });

  it("never earlier than 20 seconds after arming, even if it was already still", () => {
    const s = arm(0, T0, GO, false);
    expect(fallbackDue(s, T0 + RECORD_ANYWAY_MS - 1, T0 - 60_000)).toBe(false);
    expect(fallbackDue(s, T0 + RECORD_ANYWAY_MS, T0 - 60_000)).toBe(true);
  });
});

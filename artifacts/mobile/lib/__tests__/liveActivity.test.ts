import { describe, expect, it } from "vitest";

import { captionFor, COACH_LINES, type CueId } from "@/lib/coachLines";
import { liveClock, liveClockSpoken } from "@/lib/liveActivity/clock";
import {
  batteryText,
  buildLiveProps,
  commandAction,
  leftWithoutRecording,
  liveAction,
  liveStage,
  playersLine,
  sameLive,
  STAGE_TEXT,
  type RecorderPhase,
  type RecorderSnapshot,
} from "@/lib/liveActivity/props";

const snap = (over: Partial<RecorderSnapshot> = {}): RecorderSnapshot => ({
  matchId: 42,
  players: "John Rapiel vs. Sam Whitfield",
  phase: "ready",
  court: "Finding the court",
  batteryLevel: 0.81,
  caption: captionFor("setup"),
  countdownTo: null,
  recordingSince: null,
  startBlocked: false,
  ...over,
});

describe("what the Live Activity shows (acceptance 31)", () => {
  it("setup: stage, court, battery, the coach's caption, and Start match", () => {
    const p = buildLiveProps(snap());
    expect(p.stage).toBe("setup");
    expect(p.status).toBe("Setting up");
    expect(p.court).toBe("Finding the court");
    expect(p.battery).toBe("Phone battery 80%");
    expect(p.caption).toBe("Mount your phone behind the baseline, camera facing the court.");
    expect(p.canStart).toBe(true);
    expect(p.canStop).toBe(false);
    expect(p.startUrl).toBe("ballboi://live/42?action=start");
    expect(p.stopUrl).toBe("ballboi://live/42?action=stop");
  });

  it("counting shows when capture starts; recording shows when it began, and Stop", () => {
    const c = buildLiveProps(snap({ phase: "countdown", countdownTo: 5000, recordingSince: 1 }));
    expect(c.countdownTo).toBe(5000);
    expect(c.recordingSince).toBeNull();
    expect(c.canStart).toBe(true);
    const r = buildLiveProps(snap({ phase: "recording", countdownTo: 5000, recordingSince: 1000 }));
    expect(r.status).toBe("Recording");
    expect(r.recordingSince).toBe(1000);
    expect(r.countdownTo).toBeNull();
    expect(r.canStart).toBe(false);
    expect(r.canStop).toBe(true);
  });

  it("Start is off until the opponent's filming box is ticked (B10)", () => {
    expect(buildLiveProps(snap({ startBlocked: true })).canStart).toBe(false);
  });

  it("every phase maps to a stage, in words (acceptance 35)", () => {
    const phases: RecorderPhase[] = ["ready", "armed", "countdown", "paused", "recording", "rejoining", "interrupted", "saving", "deciding", "courtFix", "error"];
    for (const ph of phases) {
      const p = buildLiveProps(snap({ phase: ph }));
      expect(p.status).toBe(STAGE_TEXT[liveStage(ph)]);
      expect(p.status.length).toBeGreaterThan(0);
    }
    expect(liveStage("saving")).toBe("stopped");
    expect(buildLiveProps(snap({ phase: "saving" })).canStop).toBe(false);
  });

  it("battery moves in 5% steps, and hides when unknown", () => {
    expect(batteryText(0.64)).toBe("Phone battery 65%");
    expect(batteryText(1)).toBe("Phone battery 100%");
    expect(batteryText(-1)).toBeNull();
    expect(batteryText(null)).toBeNull();
  });

  it("names both players so it reads right on either phone", () => {
    expect(playersLine("John Rapiel", "Sam Whitfield")).toBe("John Rapiel vs. Sam Whitfield");
    expect(playersLine(null, "Sam")).toBe("You vs. Sam");
  });
});

describe("captions mirror on the Live Activity (G11, acceptance 34)", () => {
  it("are the manifest's words, never retyped", () => {
    const ids = Object.keys(COACH_LINES) as CueId[];
    for (const id of ids) {
      const caption = captionFor(id);
      if (!caption) continue;
      expect(buildLiveProps(snap({ caption })).caption).toBe(COACH_LINES[id].caption);
    }
  });

  it("never mention holding the screen (X2)", () => {
    const all = (Object.keys(COACH_LINES) as CueId[]).map((id) => buildLiveProps(snap({ caption: captionFor(id) })));
    expect(JSON.stringify(all)).not.toMatch(/hold the screen|press and hold|hold to stop/i);
    expect(JSON.stringify(Object.values(STAGE_TEXT))).not.toMatch(/hold/i);
  });
});

describe("Start and Stop from the other phone (acceptance 32)", () => {
  it("Start begins line 19 now from setup, waiting or a countdown", () => {
    for (const ph of ["ready", "armed", "paused", "countdown"] as RecorderPhase[]) expect(commandAction(ph, "start", false)).toBe("startNow");
    expect(commandAction("recording", "start", false)).toBe("ignore");
    expect(commandAction("ready", "start", true)).toBe("ignore");
  });

  it("Stop stops a recording, saves after an interruption, and does nothing otherwise", () => {
    expect(commandAction("recording", "stop", false)).toBe("stop");
    expect(commandAction("rejoining", "stop", false)).toBe("stop");
    expect(commandAction("interrupted", "stop", false)).toBe("finish");
    expect(commandAction("ready", "stop", false)).toBe("ignore");
    expect(commandAction("saving", "stop", false)).toBe("ignore");
  });

  it("reads the link's action", () => {
    expect(liveAction("start")).toBe("start");
    expect(liveAction(["stop"])).toBe("stop");
    expect(liveAction("hold")).toBeNull();
    expect(liveAction(undefined)).toBeNull();
  });
});

describe("ending", () => {
  it("leaving before recording says nothing was recorded", () => {
    const p = leftWithoutRecording(buildLiveProps(snap({ phase: "armed" })));
    expect(p.stage).toBe("stopped");
    expect(p.status).toBe("Setup ended");
    expect(p.canStart || p.canStop).toBe(false);
  });

  it("leaving mid-match says it stopped", () => {
    const p = leftWithoutRecording(buildLiveProps(snap({ phase: "recording", recordingSince: 1 })));
    expect(p.status).toBe("Recording stopped");
    expect(p.court).toBe("Saved on the mounted phone");
  });
});

describe("sameLive", () => {
  it("nothing new, nothing sent", () => {
    const a = buildLiveProps(snap());
    expect(sameLive(a, buildLiveProps(snap()))).toBe(true);
    expect(sameLive(a, buildLiveProps(snap({ caption: captionFor("hold") })))).toBe(false);
    expect(sameLive(null, a)).toBe(false);
  });
});

describe("the second phone's clock", () => {
  it("counts down to capture and up while recording", () => {
    expect(liveClock({ stage: "counting", countdownTo: 61_000, recordingSince: null }, 1_000)).toBe("1:00");
    expect(liveClock({ stage: "recording", countdownTo: null, recordingSince: 0 }, 3_725_000)).toBe("1:02:05");
    expect(liveClockSpoken({ stage: "recording", countdownTo: null, recordingSince: 0 }, 75_000)).toBe("1 minute 15 seconds");
    expect(liveClock({ stage: "setup", countdownTo: null, recordingSince: null }, 0)).toBeNull();
  });
});

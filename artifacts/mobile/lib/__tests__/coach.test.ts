import { describe, expect, it } from "vitest";

import { captionFor, COACH_LINES, type CueId } from "@/lib/coachLines";
import {
  COACH_START,
  correctionFor,
  countdownCueDue,
  countdownOpening,
  MOVED_GAP_MS,
  nextCoachCue,
  REPEAT_GAP_MS,
  REPEAT_LIMIT,
  type CoachInput,
  type CoachState,
} from "@/lib/court/coach";
import {
  announceCaption,
  captionOnLiveActivity,
  captionOnMountedScreen,
  CAPTION_MIN_MS,
  cueCaptionMs,
} from "@/lib/recording/captions";
import { STOP_CUES, STOP_MESSAGES } from "@/lib/recording/stopMessages";

// Node's fs, without pulling Node's types into the app's TypeScript.
// @ts-ignore -- node:fs has no types in the React Native project; vitest runs in Node.
const fs: { existsSync(p: string): boolean; readdirSync(p: string): string[] } = await import("node:fs");
const COACH_DIR = `${process.cwd()}/assets/audio/coach`;
const join = (...parts: string[]) => parts.join("/");
const { existsSync, readdirSync } = fs;

/** The table in claude/design-decisions/voice-coach.md, confirmed by John on Nov 7, plus the two G10 captions. */
const CONFIRMED: [string, string][] = [
  ["01-setup", "Mount your phone behind the baseline, camera facing the court."],
  ["02-tilt-up", "Please tilt your phone up a little."],
  ["03-tilt-down", "Please tilt your phone down a little."],
  ["04-raise", "Move your phone up a bit."],
  ["05-lower", "Please move your phone down a bit more."],
  ["06-left", "Turn your phone slightly left."],
  ["07-right", "Turn your phone slightly right."],
  ["08-centre", "Move your phone towards the centre of the court."],
  ["09-hold", "Hold your phone there."],
  ["10-locked", "Perfect. Court locked."],
  ["11-no-lock", "I can't see the court. Make sure both sidelines and the far baseline are in view."],
  ["12-record-anyway", "You can record anyway. We'll fix the lines afterwards."],
  ["13-moved", "Your phone just moved. Let's line it up again."],
  ["14-count-5m", "Recording starts in five minutes."],
  ["15-count-10m", "Recording starts in ten minutes."],
  ["16-count-15m", "Recording starts in fifteen minutes."],
  ["17-count-1m", "One minute left."],
  ["18-count-10s", "Ten seconds before recording."],
  ["19-go", "Three. Two. One. Recording has started."],
  ["20-stopped", "Recording stopped. Well played."],
  ["21-auto-stop", "Your phone battery is low, so I've saved the match."],
];

describe("coach manifest", () => {
  it("has every confirmed caption word for word, on its own clip", () => {
    for (const [file, caption] of CONFIRMED) {
      const line = Object.values(COACH_LINES).find((l) => l.file === file && l.caption === caption);
      expect(line, file).toBeDefined();
    }
  });

  it("adds the two silent auto-stop captions (G10), with the chime", () => {
    expect(COACH_LINES.autoStopStorage).toMatchObject({
      file: "22-chime",
      caption: "Your phone is running out of space, so I've saved the match.",
    });
    expect(COACH_LINES.autoStopTime).toMatchObject({
      file: "22-chime",
      caption: "We've hit four hours, so I've saved the match.",
    });
    expect(captionFor("chime")).toBeNull();
  });

  it("points every line at a clip that's in the app", () => {
    for (const line of Object.values(COACH_LINES)) {
      expect(existsSync(join(COACH_DIR, `${line.file}.m4a`)), line.file).toBe(true);
      expect(line.ms).toBeGreaterThan(0);
    }
    expect(readdirSync(COACH_DIR).filter((f) => f.endsWith(".m4a"))).toHaveLength(22);
  });

  it("never mentions holding the screen (X2)", () => {
    for (const line of Object.values(COACH_LINES)) {
      expect(line.caption ?? "").not.toMatch(/press and hold|hold the screen|hold anywhere/i);
    }
  });

  it("uses the manifest's captions for the stop messages and cues (G10)", () => {
    expect(STOP_MESSAGES.battery).toBe(captionFor("autoStopBattery"));
    expect(STOP_MESSAGES.storage).toBe(captionFor("autoStopStorage"));
    expect(STOP_MESSAGES.time).toBe(captionFor("autoStopTime"));
    expect(STOP_CUES).toEqual({ user: "stopped", battery: "autoStopBattery", storage: "autoStopStorage", time: "autoStopTime" });
  });
});

describe("corrections: the repeat rule (G8)", () => {
  const base: CoachInput = { now: 0, step: "tiltUp", stage: "searching", busy: false, movedSinceLast: false };
  const run = (inputs: Partial<CoachInput>[]) => {
    let state: CoachState = COACH_START;
    const said: (CueId | null)[] = [];
    for (const i of inputs) {
      const r = nextCoachCue(state, { ...base, ...i });
      state = r.state;
      said.push(r.cue);
    }
    return said;
  };

  it("maps each step to its line", () => {
    expect(correctionFor("tiltUp")).toBe("tiltUp");
    expect(correctionFor("turnLeft")).toBe("left");
    expect(correctionFor("centre")).toBe("centre");
    expect(correctionFor("none")).toBe("noLock");
    expect(correctionFor("ok")).toBeNull();
  });

  it("repeats no sooner than every 7 seconds while the phone hasn't moved", () => {
    expect(run([{ now: 0 }, { now: 3000 }, { now: REPEAT_GAP_MS - 1 }, { now: REPEAT_GAP_MS }])).toEqual([
      "tiltUp",
      null,
      null,
      "tiltUp",
    ]);
  });

  it("stops after 3 times in a row", () => {
    const times = Array.from({ length: 6 }, (_, i) => ({ now: i * REPEAT_GAP_MS }));
    const said = run(times).filter(Boolean);
    expect(said).toHaveLength(REPEAT_LIMIT);
  });

  it("starts the count over once the phone moves", () => {
    const said = run([
      { now: 0 },
      { now: 7000 },
      { now: 14000 },
      { now: 21000 }, // fourth time: quiet
      { now: 21000 + MOVED_GAP_MS, movedSinceLast: true }, // moved, still wrong: once more
    ]);
    expect(said).toEqual(["tiltUp", "tiltUp", "tiltUp", null, "tiltUp"]);
  });

  it("says a new correction straight away, but never over a line that's playing", () => {
    expect(run([{ now: 0 }, { now: 500, step: "turnLeft" }])).toEqual(["tiltUp", "left"]);
    expect(run([{ now: 0 }, { now: 500, step: "turnLeft", busy: true }])).toEqual(["tiltUp", null]);
  });

  it("says Hold your phone there once when nearly right and steady, then nothing until it locks", () => {
    expect(run([{ step: "ok", stage: "holding" }, { now: 9000, step: "ok", stage: "holding" }])).toEqual(["hold", null]);
    expect(run([{ step: "ok", stage: "locked" }])).toEqual([null]);
  });

  it("applies the same rule to I can't see the court", () => {
    const said = run(Array.from({ length: 5 }, (_, i) => ({ now: i * REPEAT_GAP_MS, step: "none" as const })));
    expect(said.filter(Boolean)).toEqual(["noLock", "noLock", "noLock"]);
  });
});

describe("countdown lines", () => {
  const go = COACH_LINES.go.ms;
  const walk = (totalMs: number) => {
    const played = new Set<CueId>();
    const out: [number, CueId][] = [];
    for (let left = totalMs; left >= 0; left -= 100) {
      const cue = countdownCueDue(left, totalMs, played, go);
      if (cue) {
        played.add(cue);
        out.push([left, cue]);
      }
    }
    return out;
  };

  it("opens with 14, 15 or 16, and Start Now has no opening", () => {
    expect(countdownOpening(5)).toBe("count5m");
    expect(countdownOpening(10)).toBe("count10m");
    expect(countdownOpening(15)).toBe("count15m");
    expect(countdownOpening(0)).toBeNull();
  });

  it("plays 17 at one minute, 18 at ten seconds, then 19 so capture starts as it ends", () => {
    const cues = walk(5 * 60_000);
    expect(cues.map(([, c]) => c)).toEqual(["count1m", "count10s", "go"]);
    const [, , [goAt]] = cues;
    expect(goAt).toBeLessThanOrEqual(go);
    expect(goAt).toBeGreaterThan(go - 200);
  });

  it("Start Now plays 19 only", () => {
    expect(walk(go).map(([, c]) => c)).toEqual(["go"]);
  });
});

describe("captions (G9)", () => {
  it("show on the mounted screen during setup and the countdown, never once recording starts", () => {
    expect(captionOnMountedScreen("setup")).toBe(true);
    expect(captionOnMountedScreen("countdown")).toBe(true);
    expect(captionOnMountedScreen("recording")).toBe(false);
    expect(captionOnMountedScreen("after")).toBe(false);
  });

  it("always go to the Live Activity and Watch", () => {
    expect(captionOnLiveActivity("setup")).toBe(true);
    expect(captionOnLiveActivity("recording")).toBe(true);
  });

  it("stay up at least 2 seconds, or as long as the line plays", () => {
    expect(cueCaptionMs("Hold your phone there.", 1335)).toBe(CAPTION_MIN_MS);
    expect(cueCaptionMs("Three. Two. One. Recording has started.", 5047)).toBe(5047);
  });

  it("are read by VoiceOver only when the line wasn't heard", () => {
    expect(announceCaption(true)).toBe(false);
    expect(announceCaption(false)).toBe(true);
  });
});

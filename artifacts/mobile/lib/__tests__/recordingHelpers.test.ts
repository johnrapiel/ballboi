import { describe, expect, it } from "vitest";

import { CAPTION_MIN_MS, captionDurationMs, captionWaitMs } from "@/lib/recording/captions";
import { recordedDay } from "@/lib/recording/days";
import { batteryTooLow, LOW_BATTERY_START_MESSAGE } from "@/lib/recording/limits";
import {
  elapsedSeconds,
  joinSegments,
  recordingFiles,
  remainingSeconds,
  segmentEnd,
  type RecordedSegment,
} from "@/lib/recording/segments";

describe("batteryTooLow (D14)", () => {
  it("blocks at 9% unplugged", () => {
    expect(batteryTooLow(0.09, false)).toBe(true);
    expect(batteryTooLow(0.01, false)).toBe(true);
  });

  it("records at 10% and up", () => {
    expect(batteryTooLow(0.1, false)).toBe(false);
    expect(batteryTooLow(0.55, false)).toBe(false);
    // 9.6% shows as 10% on the phone.
    expect(batteryTooLow(0.096, false)).toBe(false);
  });

  it("records when plugged in, however low", () => {
    expect(batteryTooLow(0.09, true)).toBe(false);
    expect(batteryTooLow(0.01, true)).toBe(false);
  });

  it("never blocks on an unknown level", () => {
    expect(batteryTooLow(-1, false)).toBe(false);
    expect(batteryTooLow(Number.NaN, false)).toBe(false);
  });

  it("uses the agreed wording", () => {
    expect(LOW_BATTERY_START_MESSAGE).toBe("Charge your phone to at least 10% (or plug it in) to record a match.");
  });
});

describe("segments", () => {
  const a: RecordedSegment = { uri: "file:///a.mov", sizeBytes: 1000, durationSeconds: 600, startedAt: "2026-11-04T18:00:00.000Z" };
  const b: RecordedSegment = { uri: "file:///b.mov", sizeBytes: 500, durationSeconds: 300, startedAt: "2026-11-04T18:11:00.000Z" };

  it("joins pieces into one match, starting when the first piece started", () => {
    expect(joinSegments([b, a])).toEqual({
      durationSeconds: 900,
      sizeBytes: 1500,
      recordedAt: "2026-11-04T18:00:00.000Z",
      segmentCount: 2,
    });
  });

  it("joins a single piece as itself", () => {
    expect(joinSegments([a])).toMatchObject({ durationSeconds: 600, sizeBytes: 1000, segmentCount: 1 });
  });

  it("counts time left under the cap across pieces", () => {
    expect(remainingSeconds([a, b], 4 * 3600)).toBe(4 * 3600 - 900);
    expect(remainingSeconds([{ durationSeconds: 5 * 3600 }], 4 * 3600)).toBe(0);
  });

  it("runs the clock on from the pieces already recorded", () => {
    expect(elapsedSeconds([a, b], null, 0)).toBe(900);
    expect(elapsedSeconds([a], 10_000, 70_000)).toBe(660);
  });

  it("lists every file of a recording, or the one file of an older one", () => {
    expect(recordingFiles({ uri: a.uri, segments: [a, b] })).toEqual([a.uri, b.uri]);
    expect(recordingFiles({ uri: a.uri })).toEqual([a.uri]);
  });

  it("tells a ring (rejoin) from an answered call, lock or app switch (Resume recording)", () => {
    expect(segmentEnd({ stopRequested: false, backgrounded: false, atCap: false })).toBe("rejoin");
    expect(segmentEnd({ stopRequested: false, backgrounded: true, atCap: false })).toBe("interrupted");
    expect(segmentEnd({ stopRequested: true, backgrounded: true, atCap: false })).toBe("stopped");
    expect(segmentEnd({ stopRequested: false, backgrounded: false, atCap: true })).toBe("stopped");
  });
});

describe("recordedDay (D19)", () => {
  const now = new Date(2026, 10, 4, 9, 0);

  it("reads Yesterday for a match recorded last night and uploaded today", () => {
    expect(recordedDay(new Date(2026, 10, 3, 21, 30).toISOString(), now)).toBe("Yesterday");
    expect(recordedDay(new Date(2026, 10, 3, 0, 5).toISOString(), now)).toBe("Yesterday");
  });

  it("reads Today for this morning", () => {
    expect(recordedDay(new Date(2026, 10, 4, 0, 1).toISOString(), now)).toBe("Today");
  });

  it("gives a date further back", () => {
    expect(recordedDay(new Date(2026, 9, 21, 18, 0).toISOString(), now)).toBe("Oct 21");
  });
});

describe("captions (D24)", () => {
  it("stays up at least 2 seconds", () => {
    expect(CAPTION_MIN_MS).toBe(2000);
    expect(captionDurationMs("Recording")).toBe(2000);
    expect(captionDurationMs("Recording stopped")).toBe(2000);
  });

  it("stays longer for a long line", () => {
    expect(captionDurationMs("Battery low. Recording stopped and saved.")).toBeGreaterThanOrEqual(2000);
    expect(captionDurationMs("one two three four five six seven")).toBe(3000);
  });

  it("says how long is left before it may go", () => {
    expect(captionWaitMs("Recording stopped", 1000, 1500)).toBe(1500);
    expect(captionWaitMs("Recording stopped", 1000, 5000)).toBe(0);
  });
});

import { describe, it, expect } from "vitest";

import {
  ANALYSIS_TIMEOUT_ERROR,
  analysisStartedAt,
  failureReason,
  isStuck,
  retryPending,
  STUCK_ANALYSIS_MINUTES,
} from "../lib/analysisFailure.js";
import { mlVideoFields, segmentPathsOf } from "../lib/mlDispatch.js";
import {
  MIB,
  MAX_PARTS,
  missingParts,
  partCountFor,
  partsComplete,
  partSizeFor,
  segmentUploads,
  validSegment,
  validSegmentSize,
} from "../lib/multipartUpload.js";
import { parseRecordedAt, recordingStage } from "../lib/recordableMatches.js";

describe("failed analysis reasons (Q16)", () => {
  it("gives a short reason for each kind of failure", () => {
    expect(failureReason("ML analysis completed without detected shots")).toBe("We couldn't see the court.");
    expect(failureReason("Couldn't find the court lines")).toBe("We couldn't see the court.");
    expect(failureReason("Video is too short")).toBe("The recording is too short.");
    expect(failureReason(ANALYSIS_TIMEOUT_ERROR)).toBe("The analysis didn't finish.");
    expect(failureReason("Analysis service is unavailable. Automatic retry attempts have been exhausted")).toBe(
      "Our analysis service was down.",
    );
    expect(failureReason("boom")).toBe("Something went wrong on our side.");
    expect(failureReason(null)).toBe("Something went wrong on our side.");
  });

  it("never says Ball Boi keeps trying", () => {
    for (const e of ["without detected shots", "too short", ANALYSIS_TIMEOUT_ERROR, "unavailable", "x"]) {
      expect(failureReason(e).toLowerCase()).not.toContain("trying");
    }
  });

  it("shows analyzing while an automatic retry is still coming", () => {
    const waiting = {
      status: "failed",
      processingError: "Analysis service is temporarily unavailable",
      metadata: { retryCount: 1, nextRetryAt: "2026-11-04T10:00:00Z" },
    };
    expect(retryPending(waiting, 3)).toBe(true);
    expect(recordingStage("failed", "failed", retryPending(waiting, 3))).toBe("analyzing");
    expect(retryPending({ ...waiting, metadata: { retryCount: 3, nextRetryAt: null } }, 3)).toBe(false);
    expect(retryPending({ ...waiting, processingError: "too short" }, 3)).toBe(false);
  });
});

describe("stuck analysis (D11)", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  const at = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

  it("waits under an hour, counting the 5-minute sweep", () => {
    expect(STUCK_ANALYSIS_MINUTES + 5).toBeLessThan(60);
  });

  it("is stuck only once processing has waited long enough", () => {
    const s = (m: number) => ({ status: "processing", metadata: { analysisStartedAt: at(m) }, updatedAt: at(0) });
    expect(isStuck(s(STUCK_ANALYSIS_MINUTES - 1), now)).toBe(false);
    expect(isStuck(s(STUCK_ANALYSIS_MINUTES), now)).toBe(true);
    expect(isStuck({ ...s(500), status: "completed" }, now)).toBe(false);
  });

  it("falls back to the last update for older sessions", () => {
    expect(analysisStartedAt({ metadata: {}, updatedAt: at(10) }).toISOString()).toBe(at(10));
    expect(analysisStartedAt({ metadata: { analysisStartedAt: "nonsense" }, updatedAt: at(10) }).toISOString()).toBe(at(10));
  });
});

describe("multipart helpers (D4)", () => {
  it("uses 64 MB parts, bigger only when 10,000 wouldn't be enough", () => {
    expect(partSizeFor(1)).toBe(64 * MIB);
    expect(partSizeFor(6 * 1024 * MIB)).toBe(64 * MIB);
    const huge = 700 * 1024 * MIB;
    expect(partCountFor(huge, partSizeFor(huge))).toBeLessThanOrEqual(MAX_PARTS);
  });

  it("counts parts and finds the missing ones", () => {
    expect(partCountFor(0, 64 * MIB)).toBe(1);
    expect(partCountFor(64 * MIB, 64 * MIB)).toBe(1);
    expect(partCountFor(64 * MIB + 1, 64 * MIB)).toBe(2);
    expect(missingParts(4, [1, 3])).toEqual([2, 4]);
  });

  it("is complete only when every part is in and the sizes add up", () => {
    const up = { sizeBytes: 100 * MIB, partSize: 64 * MIB };
    expect(partsComplete(up, [{ partNumber: 1, size: 64 * MIB }])).toBe(false);
    expect(partsComplete(up, [{ partNumber: 1, size: 64 * MIB }, { partNumber: 2, size: 36 * MIB }])).toBe(true);
    expect(partsComplete(up, [{ partNumber: 1, size: 64 * MIB }, { partNumber: 2, size: 30 * MIB }])).toBe(false);
  });

  it("checks what the phone sends", () => {
    expect(validSegmentSize(10)).toBe(true);
    expect(validSegmentSize(0)).toBe(false);
    expect(validSegmentSize(1.5)).toBe(false);
    expect(validSegmentSize("10")).toBe(false);
    expect(validSegment(0)).toBe(true);
    expect(validSegment(-1)).toBe(false);
    expect(validSegment(40)).toBe(false);
  });

  it("reads saved uploads safely", () => {
    expect(segmentUploads(null)).toEqual({});
    expect(segmentUploads({ uploads: { "0": { uploadId: "a", objectPath: "/o", sizeBytes: 1, partSize: 2 }, "1": { bad: true } } })).toEqual({
      "0": { uploadId: "a", objectPath: "/o", sizeBytes: 1, partSize: 2 },
    });
  });
});

describe("sending pieces to the analysis server", () => {
  it("sends one URL for one piece, and the list for several", () => {
    expect(mlVideoFields("https://api", "/objects/a", [])).toEqual({ video_url: "https://api/api/storage/objects/a" });
    expect(mlVideoFields("https://api", "/objects/a", ["/objects/b"])).toEqual({
      video_url: "https://api/api/storage/objects/a",
      video_urls: ["https://api/api/storage/objects/a", "https://api/api/storage/objects/b"],
    });
    expect(segmentPathsOf({ segmentPaths: ["/objects/b", 4] })).toEqual(["/objects/b"]);
  });
});

describe("parseRecordedAt (D19)", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  it("keeps when the match was recorded", () => {
    expect(parseRecordedAt("2026-11-03T21:00:00Z", now).toISOString()).toBe("2026-11-03T21:00:00.000Z");
  });
  it("falls back to now for nonsense, the future, or long ago", () => {
    expect(parseRecordedAt("nope", now)).toBe(now);
    expect(parseRecordedAt("2026-11-05T12:00:00Z", now)).toBe(now);
    expect(parseRecordedAt("2025-01-01T12:00:00Z", now)).toBe(now);
    expect(parseRecordedAt(undefined, now)).toBe(now);
  });
});

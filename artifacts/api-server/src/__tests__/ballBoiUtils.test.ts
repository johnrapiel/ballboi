import { describe, it, expect } from "vitest";
import {
  normalizeNumber,
  asRecord,
  stringOrNull,
  computeStats,
  buildShotFromResult,
  structuredShotFields,
  buildNarrative,
  courtCalibrationFromMetadata,
  type ShotInsert,
} from "../lib/ballBoiUtils";

describe("normalizeNumber", () => {
  it("returns the number when finite", () => {
    expect(normalizeNumber(42)).toBe(42);
    expect(normalizeNumber("3.14")).toBeCloseTo(3.14);
    expect(normalizeNumber(0)).toBe(0);
  });

  it("returns fallback for non-finite values", () => {
    expect(normalizeNumber(NaN)).toBe(0);
    expect(normalizeNumber(Infinity)).toBe(0);
    expect(normalizeNumber(null)).toBe(0);
    expect(normalizeNumber(undefined)).toBe(0);
    expect(normalizeNumber("abc", 99)).toBe(99);
  });

  it("uses custom fallback for truly non-numeric inputs", () => {
    expect(normalizeNumber(undefined, 55)).toBe(55);
    expect(normalizeNumber("abc", 0.5)).toBeCloseTo(0.5);
    expect(normalizeNumber(NaN, 99)).toBe(99);
  });
});

describe("asRecord", () => {
  it("returns the object as-is when it is a non-null object", () => {
    const obj = { foo: "bar" };
    expect(asRecord(obj)).toBe(obj);
  });

  it("returns an empty record for null, undefined, and primitives", () => {
    expect(asRecord(null)).toEqual({});
    expect(asRecord(undefined)).toEqual({});
    expect(asRecord("string")).toEqual({});
    expect(asRecord(42)).toEqual({});
  });
});

describe("stringOrNull", () => {
  it("returns the string when given a string", () => {
    expect(stringOrNull("hello")).toBe("hello");
    expect(stringOrNull("")).toBe("");
  });

  it("returns null for non-string values", () => {
    expect(stringOrNull(null)).toBeNull();
    expect(stringOrNull(undefined)).toBeNull();
    expect(stringOrNull(42)).toBeNull();
    expect(stringOrNull({ x: 1 })).toBeNull();
  });
});

describe("buildShotFromResult", () => {
  it("extracts all standard ML fields", () => {
    const mlResult = {
      shotType: "forehand",
      shotTypeConfidence: 0.9,
      outcome: "winner",
      outcomeConfidence: 0.85,
      courtZone: { name: "deuce_service_box", x: 0.7, y: 0.3 },
      contactPoint: { x: 0.5, y: 0.6 },
      ballTrajectory: { estimatedSpeedMph: 78, spin: "topspin", depth: "deep", angle: 15 },
      playerPose: { stance: "open" },
      playerId: 7,
    };

    const shot = buildShotFromResult(mlResult, 3, 42, 10, 25.5, 2);

    expect(shot.shotType).toBe("forehand");
    expect(shot.shotTypeConfidence).toBeCloseTo(0.9);
    expect(shot.outcome).toBe("winner");
    expect(shot.outcomeConfidence).toBeCloseTo(0.85);
    expect(shot.courtZoneName).toBe("deuce_service_box");
    expect(shot.courtZoneX).toBeCloseTo(0.7);
    expect(shot.courtZoneY).toBeCloseTo(0.3);
    expect(shot.speedMph).toBeCloseTo(78);
    expect(shot.spinType).toBe("topspin");
    expect(shot.depth).toBe("deep");
    expect(shot.angleDegrees).toBe(15);
    expect(shot.playerStance).toBe("open");
    expect(shot.playerId).toBe(7);
    expect(shot.sequenceNumber).toBe(3);
    expect(shot.matchId).toBe(42);
    expect(shot.sessionId).toBe(10);
    expect(shot.timestampSeconds).toBeCloseTo(25.5);
    expect(shot.rallyNumber).toBe(2);
    expect(shot.clipStartSeconds).toBeCloseTo(21.5);
    expect(shot.clipEndSeconds).toBeCloseTo(29.5);
  });

  it("uses safe defaults when ML fields are missing", () => {
    const shot = buildShotFromResult({}, 1, 1, 1, 0, 1);

    expect(shot.shotType).toBe("unknown");
    expect(shot.shotTypeConfidence).toBeCloseTo(0.5);
    expect(shot.outcome).toBe("rally_continuation");
    expect(shot.courtZoneX).toBeCloseTo(0.5);
    expect(shot.courtZoneY).toBeCloseTo(0.5);
    expect(shot.speedMph).toBeNull();                 // never a made-up speed
    expect(shot.playerId).toBeNull();
    expect(shot.clipStartSeconds).toBe(0);
  });

  it("sets clipStartSeconds to 0 when timestamp is less than 4", () => {
    const shot = buildShotFromResult({}, 1, 1, 1, 2, 1);
    expect(shot.clipStartSeconds).toBe(0);
    expect(shot.clipEndSeconds).toBe(6);
  });
});

const SAMPLE_SHOTS: ShotInsert[] = [
  { rallyNumber: 1, shotType: "serve", outcome: "winner", speedMph: 110, courtZoneX: 0.2, courtZoneY: 0.1, playerId: 1, timestampSeconds: 5 },
  { rallyNumber: 1, shotType: "forehand", outcome: "rally_continuation", speedMph: 70, courtZoneX: 0.5, courtZoneY: 0.5, playerId: 2, timestampSeconds: 7 },
  { rallyNumber: 2, shotType: "backhand", outcome: "error", speedMph: 60, courtZoneX: 0.8, courtZoneY: 0.9, playerId: 1, timestampSeconds: 15 },
  { rallyNumber: 2, shotType: "forehand", outcome: "winner", speedMph: 85, courtZoneX: 0.3, courtZoneY: 0.4, playerId: 2, timestampSeconds: 18 },
  { rallyNumber: 3, shotType: "volley", outcome: "unforced_error", speedMph: 45, courtZoneX: 0.6, courtZoneY: 0.7, playerId: 1, timestampSeconds: 25 },
];

describe("computeStats", () => {
  it("counts total shots and rallies", () => {
    const stats = computeStats(SAMPLE_SHOTS);
    expect(stats.totalShots).toBe(5);
    expect(stats.totalRallies).toBe(3);
  });

  it("counts winners and errors correctly", () => {
    const stats = computeStats(SAMPLE_SHOTS);
    expect(stats.winners).toBe(2);
    expect(stats.errors).toBe(2);
  });

  it("counts shot types", () => {
    const stats = computeStats(SAMPLE_SHOTS);
    expect(stats.serves).toBe(1);
    expect(stats.forehands).toBe(2);
    expect(stats.backhands).toBe(1);
    expect(stats.volleys).toBe(1);
    expect(stats.overheads).toBe(0);
  });

  it("calculates speed statistics", () => {
    const stats = computeStats(SAMPLE_SHOTS);
    expect(stats.fastestShotMph).toBe(110);
    const avgSpeed = (110 + 70 + 60 + 85 + 45) / 5;
    expect(stats.avgShotSpeedMph).toBeCloseTo(avgSpeed);
  });

  it("calculates average rally length", () => {
    const stats = computeStats(SAMPLE_SHOTS);
    expect(stats.avgRallyLength).toBeCloseTo(5 / 3);
  });

  it("returns zero stats for empty shot array", () => {
    const stats = computeStats([]);
    expect(stats.totalShots).toBe(0);
    expect(stats.totalRallies).toBe(0);
    expect(stats.winners).toBe(0);
    expect(stats.fastestShotMph).toBe(0);
    expect(stats.avgShotSpeedMph).toBe(0);
    expect(stats.avgRallyLength).toBe(0);
  });

  it("builds heatmap data with court positions", () => {
    const stats = computeStats(SAMPLE_SHOTS);
    expect(stats.heatmapData).toHaveLength(5);
    expect(stats.heatmapData[0]).toMatchObject({ x: 0.2, y: 0.1, outcome: "winner" });
  });

  it("preserves every courtZoneX and courtZoneY value without distortion", () => {
    const stats = computeStats(SAMPLE_SHOTS);
    SAMPLE_SHOTS.forEach((shot, i) => {
      expect(stats.heatmapData[i].x).toBe(shot.courtZoneX);
      expect(stats.heatmapData[i].y).toBe(shot.courtZoneY);
    });
  });

  it("falls back to 0.5 for heatmap x/y when courtZoneX/Y are null", () => {
    const shots: ShotInsert[] = [
      { rallyNumber: 1, shotType: "serve", outcome: "winner", speedMph: 100, courtZoneX: null, courtZoneY: null },
      { rallyNumber: 1, shotType: "forehand", outcome: "rally_continuation", speedMph: 70, courtZoneX: 0.3, courtZoneY: null },
    ];
    const stats = computeStats(shots);
    expect(stats.heatmapData[0].x).toBe(0.5);
    expect(stats.heatmapData[0].y).toBe(0.5);
    expect(stats.heatmapData[1].x).toBe(0.3);
    expect(stats.heatmapData[1].y).toBe(0.5);
  });

  it("includes shotType, outcome, and speedMph alongside coordinates in every heatmap entry", () => {
    const stats = computeStats(SAMPLE_SHOTS);
    SAMPLE_SHOTS.forEach((shot, i) => {
      const entry = stats.heatmapData[i];
      expect(entry.shotType).toBe(shot.shotType);
      expect(entry.outcome).toBe(shot.outcome);
      expect(entry.speedMph).toBe(shot.speedMph);
    });
  });

  it("passes ML-supplied coordinates through buildShotFromResult then computeStats unchanged", () => {
    const mlResults = [
      { shotType: "serve",    outcome: "winner",             courtZone: { x: 0.15, y: 0.08 }, ballTrajectory: { estimatedSpeedMph: 115 } },
      { shotType: "forehand", outcome: "rally_continuation", courtZone: { x: 0.62, y: 0.44 }, ballTrajectory: { estimatedSpeedMph: 72  } },
      { shotType: "backhand", outcome: "error",              courtZone: { x: 0.81, y: 0.93 }, ballTrajectory: { estimatedSpeedMph: 58  } },
    ];

    const shots = mlResults.map((result, i) =>
      buildShotFromResult(result, i, 1, 1, (i + 1) * 10, 1),
    );
    const stats = computeStats(shots);

    expect(stats.heatmapData).toHaveLength(3);
    mlResults.forEach((result, i) => {
      expect(stats.heatmapData[i].x).toBeCloseTo(result.courtZone.x);
      expect(stats.heatmapData[i].y).toBeCloseTo(result.courtZone.y);
      expect(stats.heatmapData[i].shotType).toBe(result.shotType);
      expect(stats.heatmapData[i].outcome).toBe(result.outcome);
    });
  });

  it("preserves coordinate precision for fractional values across the pipeline", () => {
    const preciseShots: ShotInsert[] = [
      { rallyNumber: 1, courtZoneX: 0.123456, courtZoneY: 0.987654, shotType: "serve", outcome: "winner", speedMph: 100 },
      { rallyNumber: 1, courtZoneX: 0.000001, courtZoneY: 0.999999, shotType: "forehand", outcome: "rally_continuation", speedMph: 70 },
    ];
    const stats = computeStats(preciseShots);
    expect(stats.heatmapData[0].x).toBe(0.123456);
    expect(stats.heatmapData[0].y).toBe(0.987654);
    expect(stats.heatmapData[1].x).toBe(0.000001);
    expect(stats.heatmapData[1].y).toBe(0.999999);
  });

  it("splits player comparisons by playerId", () => {
    const players = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ];
    const stats = computeStats(SAMPLE_SHOTS, players);
    const alice = stats.playerComparisons["1"] as { totalShots: number; winners: number; errors: number };
    const bob = stats.playerComparisons["2"] as { totalShots: number; winners: number; errors: number };

    expect(alice.totalShots).toBe(3);
    expect(alice.winners).toBe(1);
    expect(alice.errors).toBe(2);
    expect(bob.totalShots).toBe(2);
    expect(bob.winners).toBe(1);
    expect(bob.errors).toBe(0);
  });
});

describe("buildNarrative", () => {
  it("produces a non-empty narrative string", () => {
    const stats = computeStats(SAMPLE_SHOTS);
    const narrative = buildNarrative("Alice vs Bob", stats, SAMPLE_SHOTS);
    expect(typeof narrative).toBe("string");
    expect(narrative.length).toBeGreaterThan(50);
  });

  it("includes the match title", () => {
    const stats = computeStats(SAMPLE_SHOTS);
    const narrative = buildNarrative("Alice vs Bob", stats, SAMPLE_SHOTS);
    expect(narrative).toContain("Alice vs Bob");
  });

  it("includes the total shot count", () => {
    const stats = computeStats(SAMPLE_SHOTS);
    const narrative = buildNarrative("Match", stats, SAMPLE_SHOTS);
    expect(narrative).toContain("5 tracked shots");
  });

  it("mentions winners when they exist", () => {
    const stats = computeStats(SAMPLE_SHOTS);
    const narrative = buildNarrative("Match", stats, SAMPLE_SHOTS);
    expect(narrative).toContain("2 winners");
  });

  it("references steady play when there are no winners", () => {
    const noWinnerShots: ShotInsert[] = [
      { rallyNumber: 1, shotType: "forehand", outcome: "rally_continuation", speedMph: 70, timestampSeconds: 5 },
    ];
    const stats = computeStats(noWinnerShots);
    const narrative = buildNarrative("Match", stats, noWinnerShots);
    expect(narrative).toContain("steady rally continuation");
  });

  it("includes the fastest speed", () => {
    const stats = computeStats(SAMPLE_SHOTS);
    const narrative = buildNarrative("Match", stats, SAMPLE_SHOTS);
    expect(narrative).toContain("110 mph");
  });
});

describe("courtCalibrationFromMetadata", () => {
  const validCalibration = {
    courtCalibration: {
      version: 1,
      pointOrder: [
        "Near left baseline",
        "Near right baseline",
        "Far right baseline",
        "Far left baseline",
      ],
      points: [
        { x: 0.1, y: 0.9 },
        { x: 0.9, y: 0.9 },
        { x: 0.9, y: 0.1 },
        { x: 0.1, y: 0.1 },
      ],
    },
  };

  it("returns calibration for valid metadata", () => {
    const result = courtCalibrationFromMetadata(validCalibration);
    expect(result).not.toBeNull();
    expect(result?.points).toHaveLength(4);
  });

  it("preserves all four calibration point x/y values without modification", () => {
    const result = courtCalibrationFromMetadata(validCalibration);
    const expected = validCalibration.courtCalibration.points;
    expect(result).not.toBeNull();
    result!.points.forEach((point: { x: number; y: number }, i: number) => {
      expect(point.x).toBe(expected[i].x);
      expect(point.y).toBe(expected[i].y);
    });
  });

  it("preserves fractional calibration coordinates with full precision", () => {
    const precise = {
      courtCalibration: {
        pointOrder: [
          "Near left baseline",
          "Near right baseline",
          "Far right baseline",
          "Far left baseline",
        ],
        points: [
          { x: 0.123456, y: 0.876543 },
          { x: 0.987654, y: 0.876543 },
          { x: 0.987654, y: 0.123456 },
          { x: 0.123456, y: 0.123456 },
        ],
      },
    };
    const result = courtCalibrationFromMetadata(precise);
    expect(result).not.toBeNull();
    result!.points.forEach((point: { x: number; y: number }, i: number) => {
      expect(point.x).toBe(precise.courtCalibration.points[i].x);
      expect(point.y).toBe(precise.courtCalibration.points[i].y);
    });
  });

  it("returns null when metadata is null or not an object", () => {
    expect(courtCalibrationFromMetadata(null)).toBeNull();
    expect(courtCalibrationFromMetadata("bad")).toBeNull();
    expect(courtCalibrationFromMetadata({})).toBeNull();
  });

  it("returns null when point order is wrong", () => {
    const bad = {
      courtCalibration: {
        ...validCalibration.courtCalibration,
        pointOrder: ["Wrong", "Order", "Here", "Fail"],
      },
    };
    expect(courtCalibrationFromMetadata(bad)).toBeNull();
  });

  it("returns null when fewer than 4 points are provided", () => {
    const bad = {
      courtCalibration: {
        ...validCalibration.courtCalibration,
        points: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      },
    };
    expect(courtCalibrationFromMetadata(bad)).toBeNull();
  });

  it("returns null when points form a degenerate shape (zero area)", () => {
    const bad = {
      courtCalibration: {
        ...validCalibration.courtCalibration,
        points: [
          { x: 0, y: 0 },
          { x: 0.1, y: 0 },
          { x: 0.2, y: 0 },
          { x: 0.3, y: 0 },
        ],
      },
    };
    expect(courtCalibrationFromMetadata(bad)).toBeNull();
  });

  it("returns null for non-convex (concave) quadrilateral", () => {
    const bad = {
      courtCalibration: {
        ...validCalibration.courtCalibration,
        points: [
          { x: 0.5, y: 0.5 },
          { x: 0.9, y: 0.9 },
          { x: 0.5, y: 0.7 },
          { x: 0.1, y: 0.9 },
        ],
      },
    };
    expect(courtCalibrationFromMetadata(bad)).toBeNull();
  });
});

describe("structuredShotFields", () => {
  // Shaped like services/pipeline/shots.py to_dict() in the ML server.
  const pipelineShot = {
    id: "p0003", time: 12.4, hitter: "far", type: "serve", typeConfidence: 0.94, serveNumber: 2,
    bounce: { time: 12.9, image: [0.41, 0.63], court: [-1.2, -5.8] },
    result: "in", resultConfidence: 0.88, closeCall: true, lineDistanceMeters: 0.07,
    pointEnd: "winner", serveZone: "deuce_t",
    shotType: "serve", timestampSeconds: 12.4, outcome: "winner",
  };

  it("keeps hitter side, landing spot, line call, serve and point ending", () => {
    expect(structuredShotFields(pipelineShot, "abc123")).toEqual({
      hitterSide: "far",
      landingXM: -1.2,
      landingYM: -5.8,
      landingSeconds: 12.9,
      lineCall: "in",
      lineCallConfidence: 0.88,
      closeCall: true,
      lineDistanceM: 0.07,
      serveNumber: 2,
      serveZone: "deuce_t",
      pointEnd: "winner",
      modelVersion: "abc123",
    });
  });

  it("leaves missing or odd values empty instead of guessing", () => {
    const f = structuredShotFields({ hitter: "left", result: "maybe", bounce: { court: [1] }, serveNumber: 3, closeCall: "yes" });
    expect(f).toMatchObject({
      hitterSide: null, lineCall: null, landingXM: null, landingYM: null,
      serveNumber: null, closeCall: false, pointEnd: null, modelVersion: null,
    });
  });

  it("a shot that never landed (volleyed) has no landing spot or line call", () => {
    const f = structuredShotFields({ ...pipelineShot, bounce: null, result: null, serveZone: null });
    expect(f.landingXM).toBeNull();
    expect(f.lineCall).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { GATED_STATS, gateNarrative, gateSession, gateShot, gateStatistics, hiddenStats, shownStats } from "../lib/statGates";

const gates = (shown: string[]) => ({
  statGates: { stats: Object.fromEntries(GATED_STATS.map((n) => [n, { shown: shown.includes(n) }])) },
});

const shot = {
  id: 1, sequenceNumber: 3, rallyNumber: 2, timestampSeconds: 12.4, hitterSide: "far",
  shotType: "serve", shotTypeConfidence: 0.9, outcome: "winner", outcomeConfidence: 0.8, pointEnd: "winner",
  courtZoneName: "service_box_deuce", courtZoneX: 0.3, courtZoneY: 0.4, landingXM: 1.1, landingYM: 5.2,
  lineCall: "in", lineCallConfidence: 0.97, closeCall: true, lineDistanceM: 0.05, serveNumber: 1, serveZone: "deuce_t",
  speedMph: 101, spinType: "unknown", angleDegrees: 0, playerStance: "unknown", rawMlData: { a: 1 },
};

const stats = {
  totalShots: 40, totalRallies: 9, avgRallyLength: 4.4, avgShotSpeedMph: 51, fastestShotMph: 101,
  winners: 6, errors: 8, serves: 12, forehands: 14, backhands: 10, volleys: 3, overheads: 1,
  heatmapData: [{ x: 0.3, y: 0.4, shotType: "serve", outcome: "winner", speedMph: 101 }],
  shotTypeBreakdown: { serve: 12 }, outcomeBreakdown: { winner: 6 },
  playerComparisons: { "1": { name: "Alice", totalShots: 20, winners: 3, errors: 4, avgSpeedMph: 50, shotTypes: { serve: 6 } } },
};

describe("stat gates", () => {
  it("no gates on the session means every stat is hidden", () => {
    expect(shownStats({}).size).toBe(0);
    expect(shownStats(null).size).toBe(0);
    expect(hiddenStats(shownStats(undefined))).toEqual([...GATED_STATS]);
  });

  it("reads only stats marked shown", () => {
    expect([...shownStats(gates(["shot_type", "line_calls"]))]).toEqual(["shot_type", "line_calls"]);
  });

  it("a shot keeps its structure but loses every hidden stat", () => {
    const out = gateShot(shot, new Set());
    expect(out).toMatchObject({ id: 1, sequenceNumber: 3, rallyNumber: 2, timestampSeconds: 12.4, hitterSide: "far" });
    for (const f of ["shotType", "outcome", "pointEnd", "courtZoneX", "landingXM", "lineCall", "lineDistanceM",
      "serveNumber", "serveZone", "speedMph", "spinType", "rawMlData"]) {
      expect(out[f as keyof typeof out]).toBeNull();
    }
    expect(out.closeCall).toBe(false);
    expect(shot.shotType).toBe("serve"); // input untouched
  });

  it("shows exactly the stats that met their bar", () => {
    const out = gateShot(shot, shownStats(gates(["shot_type", "line_calls"])));
    expect(out).toMatchObject({ shotType: "serve", lineCall: "in", closeCall: true, outcome: null, speedMph: null, serveZone: null });
  });

  it("statistics, heatmap entries and player comparisons follow the same gates", () => {
    const out = gateStatistics(stats, shownStats(gates(["shot_type"])))!;
    expect(out).toMatchObject({ totalShots: 40, serves: 12, forehands: 14, winners: null, totalRallies: null, avgShotSpeedMph: null, heatmapData: null });
    expect(out.playerComparisons["1"]).toMatchObject({ name: "Alice", totalShots: 20, shotTypes: { serve: 6 }, winners: null, avgSpeedMph: null });
    const withMap = gateStatistics(stats, shownStats(gates(["placement_heatmap"])))!;
    expect(withMap.heatmapData).toEqual([{ x: 0.3, y: 0.4, shotType: null, outcome: null, speedMph: null }]);
    expect(gateStatistics(null, new Set())).toBeNull();
  });

  it("the written summary needs every stat it quotes", () => {
    const all = shownStats(gates([...GATED_STATS]));
    expect(gateNarrative("text", all)).toBe("text");
    expect(gateNarrative("text", shownStats(gates(["shot_type", "point_ending", "rally_length"])))).toBeNull();
    expect(gateSession({ id: 1, aiNarrative: "text" }, new Set())).toEqual({ id: 1, aiNarrative: null });
  });
});

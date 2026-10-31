// Spec (Ball Boi > Shot analysis build): "A stat that misses its bar is hidden
// at launch, not shown with a disclaimer."
//
// The ML server sends `statGates` with every result, decided from the eval
// report for the exact pipeline that ran (ml-server evaluation/gates.py). It's
// saved on the session's metadata. Everything the app reads goes through the
// functions below, which blank every field belonging to a hidden stat. A
// session with no gates (older analyses, or no eval report yet) shows none.

export const GATED_STATS = [
  "shot_type",
  "line_calls",
  "serve_placement",
  "placement_heatmap",
  "point_ending",
  "rally_length",
  "first_serve_pct",
  "serve_speed",
] as const;
export type GatedStat = (typeof GATED_STATS)[number];

type Row = Record<string, unknown>;

// Shot fields per stat. Fields not listed under any stat (ids, sequence and
// rally numbers, timestamps, hitter side) are structure, not stats.
const SHOT_FIELDS: Record<GatedStat, string[]> = {
  shot_type: ["shotType", "shotTypeConfidence"],
  line_calls: ["lineCall", "lineCallConfidence", "closeCall", "lineDistanceM"],
  serve_placement: ["serveZone"],
  placement_heatmap: ["courtZoneName", "courtZoneX", "courtZoneY", "landingXM", "landingYM", "landingSeconds",
    "contactX", "contactY", "depth"],
  point_ending: ["outcome", "outcomeConfidence", "pointEnd"],
  rally_length: [],
  first_serve_pct: ["serveNumber"],
  serve_speed: ["speedMph"],
};

// Deferred in the spec (spin, swing, footwork), or never measured: always hidden.
const ALWAYS_HIDDEN_SHOT_FIELDS = ["spinType", "angleDegrees", "playerStance", "rawMlData"];

const STATISTICS_FIELDS: Record<GatedStat, string[]> = {
  shot_type: ["serves", "forehands", "backhands", "volleys", "overheads", "shotTypeBreakdown"],
  line_calls: [],
  serve_placement: [],
  placement_heatmap: ["heatmapData"],
  point_ending: ["winners", "errors", "outcomeBreakdown"],
  rally_length: ["totalRallies", "avgRallyLength"],
  first_serve_pct: [],
  serve_speed: ["avgShotSpeedMph", "fastestShotMph"],
};

const COMPARISON_FIELDS: Partial<Record<GatedStat, string[]>> = {
  shot_type: ["shotTypes"],
  point_ending: ["winners", "errors"],
  serve_speed: ["avgSpeedMph"],
};

function asRow(value: unknown): Row {
  return value != null && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}

/** The stats this session's analysis may show. */
export function shownStats(sessionMetadata: unknown): Set<GatedStat> {
  const stats = asRow(asRow(asRow(sessionMetadata).statGates).stats);
  return new Set(GATED_STATS.filter((name) => asRow(stats[name]).shown === true));
}

export function hiddenStats(shown: Set<GatedStat>): GatedStat[] {
  return GATED_STATS.filter((name) => !shown.has(name));
}

function blank(row: Row, fields: string[]) {
  for (const f of fields) if (f in row) row[f] = null;
}

export function gateShot<T extends object>(shot: T, shown: Set<GatedStat>): T {
  const out: Row = { ...(shot as Row) };
  for (const name of GATED_STATS) if (!shown.has(name)) blank(out, SHOT_FIELDS[name]);
  blank(out, ALWAYS_HIDDEN_SHOT_FIELDS);
  if (out.closeCall === null) out.closeCall = false;
  return out as T;
}

export function gateStatistics<T extends object>(stats: T | null | undefined, shown: Set<GatedStat>): T | null {
  if (!stats) return null;
  const out: Row = { ...(stats as Row) };
  for (const name of GATED_STATS) if (!shown.has(name)) blank(out, STATISTICS_FIELDS[name]);
  if (Array.isArray(out.heatmapData)) {
    out.heatmapData = (out.heatmapData as unknown[]).map((entry) => {
      const e: Row = { ...asRow(entry) };
      if (!shown.has("shot_type")) e.shotType = null;
      if (!shown.has("point_ending")) e.outcome = null;
      if (!shown.has("serve_speed")) e.speedMph = null;
      return e;
    });
  }
  if (out.playerComparisons && typeof out.playerComparisons === "object") {
    const comparisons: Row = {};
    for (const [id, value] of Object.entries(asRow(out.playerComparisons))) {
      const p: Row = { ...asRow(value) };
      for (const [name, fields] of Object.entries(COMPARISON_FIELDS) as Array<[GatedStat, string[]]>) {
        if (!shown.has(name)) blank(p, fields);
      }
      comparisons[id] = p;
    }
    out.playerComparisons = comparisons;
  }
  return out as T;
}

/** The written summary quotes shot types, winners, errors, rallies and speeds, so it needs all of them. */
export function gateNarrative(narrative: string | null | undefined, shown: Set<GatedStat>): string | null {
  const needs: GatedStat[] = ["shot_type", "point_ending", "rally_length", "serve_speed"];
  return narrative && needs.every((n) => shown.has(n)) ? narrative : null;
}

export function gateSession<T extends object>(session: T | null, shown: Set<GatedStat>): T | null {
  if (!session) return null;
  const out: Row = { ...(session as Row) };
  if ("aiNarrative" in out) out.aiNarrative = gateNarrative(out.aiNarrative as string | null, shown);
  return out as T;
}

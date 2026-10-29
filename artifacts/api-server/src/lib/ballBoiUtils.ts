export type UnknownRecord = Record<string, unknown>;

export type ShotInsert = {
  sessionId?: number | null;
  matchId?: number | null;
  sequenceNumber?: number | null;
  rallyNumber?: number | null;
  playerId?: number | null;
  timestampSeconds?: number | null;
  shotType?: string | null;
  shotTypeConfidence?: number | null;
  outcome?: string | null;
  outcomeConfidence?: number | null;
  courtZoneName?: string | null;
  courtZoneX?: number | null;
  courtZoneY?: number | null;
  contactX?: number | null;
  contactY?: number | null;
  speedMph?: number | null;
  spinType?: string | null;
  depth?: string | null;
  angleDegrees?: number | null;
  playerStance?: string | null;
  clipStartSeconds?: number | null;
  clipEndSeconds?: number | null;
  rawMlData?: unknown;
  [key: string]: unknown;
};

export function asRecord(value: unknown): UnknownRecord {
  return value != null && typeof value === "object" ? (value as UnknownRecord) : {};
}

export function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

export function normalizeNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const COURT_CALIBRATION_POINT_ORDER = [
  "Near left baseline",
  "Near right baseline",
  "Far right baseline",
  "Far left baseline",
];

export function courtCalibrationFromMetadata(metadata: unknown) {
  const record = asRecord(metadata);
  const calibration = asRecord(record.courtCalibration);
  if (
    !Array.isArray(calibration.points) ||
    calibration.points.length !== 4
  )
    return null;
  const pointOrder = calibration.pointOrder as unknown[];
  if (
    !Array.isArray(calibration.pointOrder) ||
    COURT_CALIBRATION_POINT_ORDER.some(
      (label, index) => pointOrder[index] !== label,
    )
  )
    return null;
  const points = (calibration.points as unknown[]).map((point) => {
    const p = asRecord(point);
    return { x: normalizeNumber(p.x, NaN), y: normalizeNumber(p.y, NaN) };
  });
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)))
    return null;
  const area = Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
  if (area < 0.01) return null;
  const crossProducts = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const afterNext = points[(index + 2) % points.length];
    return (
      (next.x - point.x) * (afterNext.y - next.y) -
      (next.y - point.y) * (afterNext.x - next.x)
    );
  });
  if (crossProducts.some((cross) => Math.abs(cross) < 0.001)) return null;
  const hasPositive = crossProducts.some((cross) => cross > 0);
  const hasNegative = crossProducts.some((cross) => cross < 0);
  if (hasPositive && hasNegative) return null;
  return { ...calibration, points };
}

export function buildShotFromResult(
  result: unknown,
  index: number,
  matchId: number,
  sessionId: number,
  timestampSeconds: number,
  rallyNumber: number,
) {
  const data = asRecord(result);
  const courtZone = asRecord(data.courtZone);
  const contactPoint = asRecord(data.contactPoint);
  const ballTrajectory = asRecord(data.ballTrajectory);
  const playerPose = asRecord(data.playerPose);
  return {
    sessionId,
    matchId,
    sequenceNumber: index,
    rallyNumber,
    timestampSeconds,
    shotType: stringOrNull(data.shotType) ?? "unknown",
    shotTypeConfidence: normalizeNumber(data.shotTypeConfidence, 0.5),
    outcome: stringOrNull(data.outcome) ?? "rally_continuation",
    outcomeConfidence: normalizeNumber(data.outcomeConfidence, 0.5),
    courtZoneName: stringOrNull(courtZone.name),
    courtZoneX: normalizeNumber(courtZone.x, 0.5),
    courtZoneY: normalizeNumber(courtZone.y, 0.5),
    contactX: normalizeNumber(contactPoint.x, 0.5),
    contactY: normalizeNumber(contactPoint.y, 0.5),
    speedMph: normalizeNumber(ballTrajectory.estimatedSpeedMph, 55),
    spinType: stringOrNull(ballTrajectory.spin),
    depth: stringOrNull(ballTrajectory.depth),
    angleDegrees: normalizeNumber(ballTrajectory.angle, 0),
    playerStance: stringOrNull(playerPose.stance),
    playerId: typeof data.playerId === "number" ? data.playerId : null,
    clipStartSeconds: Math.max(0, timestampSeconds - 4),
    clipEndSeconds: timestampSeconds + 4,
    rawMlData: (data.rawMlData ?? data) as Record<string, unknown>,
  };
}

export function computeStats(
  shots: Array<ShotInsert>,
  players: Array<{ id: number; name: string }> = [],
) {
  const totalShots = shots.length;
  const rallyCounts = shots.reduce<Record<number, number>>((acc, shot) => {
    acc[shot.rallyNumber ?? 1] = (acc[shot.rallyNumber ?? 1] ?? 0) + 1;
    return acc;
  }, {});
  const speeds = shots
    .map((shot) => Number(shot.speedMph ?? 0))
    .filter((n) => n > 0);
  const shotTypeBreakdown = shots.reduce<Record<string, number>>((acc, shot) => {
    const key = shot.shotType ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const outcomeBreakdown = shots.reduce<Record<string, number>>((acc, shot) => {
    const key = shot.outcome ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return {
    totalShots,
    totalRallies: Object.keys(rallyCounts).length,
    avgRallyLength:
      totalShots > 0
        ? totalShots / Math.max(Object.keys(rallyCounts).length, 1)
        : 0,
    avgShotSpeedMph: speeds.length
      ? speeds.reduce((a, b) => a + b, 0) / speeds.length
      : 0,
    fastestShotMph: speeds.length ? Math.max(...speeds) : 0,
    winners: outcomeBreakdown.winner ?? 0,
    errors:
      (outcomeBreakdown.error ?? 0) + (outcomeBreakdown.unforced_error ?? 0),
    serves: shotTypeBreakdown.serve ?? 0,
    forehands: shotTypeBreakdown.forehand ?? 0,
    backhands: shotTypeBreakdown.backhand ?? 0,
    volleys: shotTypeBreakdown.volley ?? 0,
    overheads: shotTypeBreakdown.overhead ?? 0,
    heatmapData: shots.map((shot) => ({
      x: shot.courtZoneX ?? 0.5,
      y: shot.courtZoneY ?? 0.5,
      shotType: shot.shotType,
      outcome: shot.outcome,
      speedMph: shot.speedMph,
    })),
    shotTypeBreakdown,
    outcomeBreakdown,
    playerComparisons: players.reduce<Record<string, unknown>>((acc, player) => {
      const playerShots = shots.filter((shot) => shot.playerId === player.id);
      const playerSpeeds = playerShots
        .map((shot) => Number(shot.speedMph ?? 0))
        .filter((n) => n > 0);
      acc[String(player.id)] = {
        playerId: player.id,
        name: player.name,
        totalShots: playerShots.length,
        winners: playerShots.filter((shot) => shot.outcome === "winner").length,
        errors: playerShots.filter((shot) =>
          shot.outcome?.includes("error"),
        ).length,
        avgSpeedMph: playerSpeeds.length
          ? playerSpeeds.reduce((a, b) => a + b, 0) / playerSpeeds.length
          : 0,
        shotTypes: playerShots.reduce<Record<string, number>>(
          (shotAcc, shot) => {
            const key = shot.shotType ?? "unknown";
            shotAcc[key] = (shotAcc[key] ?? 0) + 1;
            return shotAcc;
          },
          {},
        ),
      };
      return acc;
    }, {}),
  };
}

export function buildNarrative(
  matchTitle: string,
  stats: ReturnType<typeof computeStats>,
  shots: Array<ShotInsert>,
) {
  const dominantShot =
    Object.entries(stats.shotTypeBreakdown).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    "groundstroke";
  const fastest = Math.round(stats.fastestShotMph);
  const rallyText =
    stats.totalRallies > 0
      ? `${stats.totalRallies} rallies averaging ${stats.avgRallyLength.toFixed(1)} shots`
      : "short rally samples";
  const winnerText =
    stats.winners > 0 ? `${stats.winners} winners` : "steady rally continuation";
  const lateShots = shots.filter(
    (shot) =>
      (shot.timestampSeconds ?? 0) >
      (shots.at(-1)?.timestampSeconds ?? 0) * 0.65,
  ).length;
  return `${matchTitle} featured ${stats.totalShots} tracked shots across ${rallyText}. The most common pattern was ${dominantShot}, with ${winnerText} and a fastest detected ball speed of ${fastest} mph. ${lateShots} shots came in the closing phase, giving the replay enough density to review finishing patterns, court targets, and shot selection trends.`;
}

import { apiFetch, apiUrl } from "./scheduleApi";

export type BallBoiSessionMetadata = {
  retryCount?: number;
  nextRetryAt?: string | null;
  mlCallbackToken?: string;
  chunks?: unknown[];
  [key: string]: unknown;
};

export type BallBoiSession = {
  id: number;
  matchId: number;
  recordedByClerkUserId: string;
  status: string;
  recordingStartedAt: string;
  recordingStoppedAt: string | null;
  videoObjectPath: string | null;
  videoContentType: string | null;
  videoSizeBytes: number | null;
  durationSeconds: number | null;
  processingStatus: string;
  processingError: string | null;
  aiNarrative: string | null;
  metadata?: BallBoiSessionMetadata | null;
  createdAt: string;
  updatedAt: string;
};

export type CourtCalibrationPoint = {
  x: number;
  y: number;
};

export type CourtCalibration = {
  version: number;
  pointOrder: string[];
  points: CourtCalibrationPoint[];
  capturedAt: string;
};

export type MatchShot = {
  id: number;
  sessionId: number;
  matchId: number;
  sequenceNumber: number;
  rallyNumber: number;
  playerId: number | null;
  timestampSeconds: number;
  shotType: string;
  shotTypeConfidence: number | null;
  outcome: string | null;
  courtZoneName: string | null;
  courtZoneX: number | null;
  courtZoneY: number | null;
  contactX: number | null;
  contactY: number | null;
  speedMph: number | null;
  spinType: string | null;
  depth: string | null;
  angleDegrees: number | null;
  playerStance: string | null;
  clipStartSeconds: number | null;
  clipEndSeconds: number | null;
};

export type MatchStatistics = {
  id: number;
  sessionId: number;
  matchId: number;
  totalShots: number;
  totalRallies: number;
  avgRallyLength: number;
  avgShotSpeedMph: number;
  fastestShotMph: number;
  winners: number;
  errors: number;
  serves: number;
  forehands: number;
  backhands: number;
  volleys: number;
  overheads: number;
  heatmapData: Array<Record<string, unknown>>;
  shotTypeBreakdown: Record<string, number>;
  outcomeBreakdown: Record<string, number>;
  playerComparisons: Record<string, { playerId: number; name: string; totalShots: number; winners: number; errors: number; avgSpeedMph: number; shotTypes: Record<string, number> }>;
};

export type BallBoiReplay = {
  match: Record<string, unknown>;
  session: BallBoiSession | null;
  shots: MatchShot[];
  statistics: MatchStatistics | null;
};

export type BallBoiStatus = {
  sessionId: number;
  status: string;
  processingStatus: string;
  processingError: string | null;
  shotCount: number;
  progress: number;
  retryCount: number | null;
  nextRetryAt: string | null;
};

async function parseJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? "Request failed");
  return body as T;
}

export function objectUrl(objectPath: string | null | undefined) {
  if (!objectPath) return null;
  return apiUrl(`/storage${objectPath}`);
}

export async function startBallBoiSession(matchId: number, token: string | null, courtCalibration?: CourtCalibration | null) {
  const res = await apiFetch(`/ball-boi/matches/${matchId}/sessions/start`, token, {
    method: "POST",
    body: JSON.stringify({ metadata: { source: "browser-camera", ...(courtCalibration ? { courtCalibration } : {}) } }),
  });
  return parseJson<BallBoiSession>(res);
}

export async function cancelBallBoiSession(sessionId: number, token: string | null, reason: string) {
  const res = await apiFetch(`/ball-boi/sessions/${sessionId}/cancel`, token, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
  return parseJson<BallBoiSession>(res);
}

export async function requestBallBoiUploadUrl(sessionId: number, token: string | null) {
  const res = await apiFetch(`/ball-boi/sessions/${sessionId}/upload-url`, token, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return parseJson<{ uploadURL: string; objectPath: string }>(res);
}

export async function sendLiveShot(sessionId: number, token: string | null, timestampSeconds: number, frameImage: string | null) {
  const res = await apiFetch(`/ball-boi/sessions/${sessionId}/live-shot`, token, {
    method: "POST",
    body: JSON.stringify({ timestampSeconds, frameImage }),
  });
  if (res.status === 204) return null;
  return parseJson<MatchShot>(res);
}

export async function completeBallBoiSession(
  sessionId: number,
  token: string | null,
  data: { objectPath: string; contentType: string; sizeBytes: number; durationSeconds: number; chunks?: Array<Record<string, unknown>> },
) {
  const res = await apiFetch(`/ball-boi/sessions/${sessionId}/complete`, token, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return parseJson<BallBoiSession>(res);
}

export async function getBallBoiReplay(matchId: number, token: string | null) {
  const res = await apiFetch(`/ball-boi/matches/${matchId}/replay`, token);
  return parseJson<BallBoiReplay>(res);
}

export async function getBallBoiStatus(sessionId: number, token: string | null) {
  const res = await apiFetch(`/ball-boi/sessions/${sessionId}/status`, token);
  return parseJson<BallBoiStatus>(res);
}

export async function getBallBoiVideoUrl(sessionId: number, token: string | null) {
  const res = await apiFetch(`/ball-boi/sessions/${sessionId}/video-url`, token);
  return parseJson<{ sessionId: number; videoUrl: string }>(res);
}

export type DetectCourtResult =
  | { success: true; corners: CourtCalibrationPoint[]; confidence: number; linesDetected: number }
  | { success: false; error: string };

export async function detectCourt(frameImage: string, token: string | null): Promise<DetectCourtResult> {
  const res = await apiFetch("/ball-boi/detect-court", token, {
    method: "POST",
    body: JSON.stringify({ frameImage }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    return { success: false, error: body?.error ?? "Court detection failed" };
  }
  return {
    success: true,
    corners: (body.corners as CourtCalibrationPoint[]) ?? [],
    confidence: body.confidence ?? 0,
    linesDetected: body.lines_detected ?? 0,
  };
}

export async function getBallBoiVideoBlob(signedUrl: string, onProgress?: (percent: number) => void) {
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error("Video failed to load");

  const contentLength = res.headers?.get("Content-Length") ?? null;
  const rawTotal = contentLength ? parseInt(contentLength, 10) : NaN;
  const total = Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : null;

  if (!res.body || total === null) {
    const blob = await res.blob();
    onProgress?.(100);
    return blob;
  }

  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(Math.min(99, Math.round((received / total) * 100)));
  }

  onProgress?.(100);
  return new Blob(chunks, { type: res.headers.get("Content-Type") ?? "video/mp4" });
}

export async function getMlHealth(): Promise<{ reachable: boolean }> {
  try {
    const res = await apiFetch("/ball-boi/ml-health", null);
    const body = await res.json().catch(() => ({ reachable: false }));
    return { reachable: body?.reachable === true };
  } catch {
    return { reachable: false };
  }
}
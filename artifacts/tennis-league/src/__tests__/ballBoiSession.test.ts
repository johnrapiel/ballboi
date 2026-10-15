import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/scheduleApi", () => ({
  apiFetch: vi.fn(),
  apiUrl: (path: string) => `http://localhost:8080/api${path}`,
}));

import { apiFetch } from "@/lib/scheduleApi";
import {
  startBallBoiSession,
  cancelBallBoiSession,
  sendLiveShot,
  completeBallBoiSession,
  getBallBoiReplay,
  getBallBoiStatus,
  getBallBoiVideoUrl,
  getBallBoiVideoBlob,
  type BallBoiSession,
  type BallBoiReplay,
} from "@/lib/ballBoiApi";

const TOKEN = "clerk-test-token";

function mockResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    blob: async () => new Blob([JSON.stringify(body)], { type: "application/json" }),
  } as Response;
}

describe("Ball Boi API: startBallBoiSession", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("POSTs to the correct session start endpoint", async () => {
    const session: BallBoiSession = {
      id: 1,
      matchId: 42,
      recordedByClerkUserId: "user_abc",
      status: "recording",
      processingStatus: "pending",
      processingError: null,
      aiNarrative: null,
      videoObjectPath: null,
      videoContentType: null,
      videoSizeBytes: null,
      durationSeconds: null,
      recordingStartedAt: new Date().toISOString(),
      recordingStoppedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(apiFetch).mockResolvedValue(mockResponse(session, 201));

    const result = await startBallBoiSession(42, TOKEN);

    expect(apiFetch).toHaveBeenCalledWith(
      "/ball-boi/matches/42/sessions/start",
      TOKEN,
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.id).toBe(1);
    expect(result.status).toBe("recording");
    expect(result.matchId).toBe(42);
  });

  it("includes court calibration in the request body when provided", async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      mockResponse({ id: 2, matchId: 10, status: "recording", processingStatus: "pending" }, 201),
    );

    const calibration = {
      version: 1,
      pointOrder: ["Near left baseline", "Near right baseline", "Far right baseline", "Far left baseline"],
      points: [
        { x: 0.1, y: 0.9 },
        { x: 0.9, y: 0.9 },
        { x: 0.9, y: 0.1 },
        { x: 0.1, y: 0.1 },
      ],
      capturedAt: new Date().toISOString(),
    };

    await startBallBoiSession(10, TOKEN, calibration);

    const [, , options] = vi.mocked(apiFetch).mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.metadata.courtCalibration).toEqual(calibration);
    expect(body.metadata.source).toBe("browser-camera");
  });

  it("throws when the server returns an error", async () => {
    vi.mocked(apiFetch).mockResolvedValue(mockResponse({ error: "Forbidden" }, 403));
    await expect(startBallBoiSession(99, TOKEN)).rejects.toThrow("Forbidden");
  });
});

describe("Ball Boi API: cancelBallBoiSession", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("POSTs to the cancel endpoint with the reason", async () => {
    const cancelled = { id: 5, status: "failed", processingStatus: "failed" };
    vi.mocked(apiFetch).mockResolvedValue(mockResponse(cancelled));

    const result = await cancelBallBoiSession(5, TOKEN, "User stopped the recording");

    expect(apiFetch).toHaveBeenCalledWith(
      "/ball-boi/sessions/5/cancel",
      TOKEN,
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(vi.mocked(apiFetch).mock.calls[0][2]!.body as string);
    expect(body.reason).toBe("User stopped the recording");
    expect(result.status).toBe("failed");
  });
});

describe("Ball Boi API: sendLiveShot", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("returns null when the server responds with 204 (no shot detected)", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, status: 204, json: async () => null } as Response);

    const result = await sendLiveShot(1, TOKEN, 15.5, null);
    expect(result).toBeNull();
  });

  it("returns the detected shot when the server responds with 201", async () => {
    const shot = {
      id: 99,
      sessionId: 1,
      matchId: 10,
      sequenceNumber: 3,
      rallyNumber: 1,
      playerId: 1,
      timestampSeconds: 15.5,
      shotType: "forehand",
      outcome: "winner",
      speedMph: 78,
      courtZoneX: 0.6,
      courtZoneY: 0.3,
    };
    vi.mocked(apiFetch).mockResolvedValue(mockResponse(shot, 201));

    const result = await sendLiveShot(1, TOKEN, 15.5, "data:image/jpeg;base64,abc");

    expect(apiFetch).toHaveBeenCalledWith(
      "/ball-boi/sessions/1/live-shot",
      TOKEN,
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).not.toBeNull();
    expect(result!.shotType).toBe("forehand");
    expect(result!.outcome).toBe("winner");
    expect(result!.speedMph).toBe(78);
  });

  it("includes the frame image and timestamp in the request body", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, status: 204, json: async () => null } as Response);

    await sendLiveShot(1, TOKEN, 22.3, "data:image/jpeg;base64,testdata");

    const body = JSON.parse(vi.mocked(apiFetch).mock.calls[0][2]!.body as string);
    expect(body.timestampSeconds).toBeCloseTo(22.3);
    expect(body.frameImage).toBe("data:image/jpeg;base64,testdata");
  });
});

describe("Ball Boi API: completeBallBoiSession", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("POSTs video metadata to the complete endpoint", async () => {
    const updatedSession = { id: 1, status: "processing", processingStatus: "processing", videoObjectPath: "/objects/test.webm" };
    vi.mocked(apiFetch).mockResolvedValue(mockResponse(updatedSession));

    const result = await completeBallBoiSession(1, TOKEN, {
      objectPath: "/objects/test.webm",
      contentType: "video/webm",
      sizeBytes: 204800,
      durationSeconds: 90,
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/ball-boi/sessions/1/complete",
      TOKEN,
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(vi.mocked(apiFetch).mock.calls[0][2]!.body as string);
    expect(body.objectPath).toBe("/objects/test.webm");
    expect(body.contentType).toBe("video/webm");
    expect(body.sizeBytes).toBe(204800);
    expect(body.durationSeconds).toBe(90);
    expect(result.status).toBe("processing");
  });
});

describe("Ball Boi API: getBallBoiReplay", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("GETs the replay endpoint and returns structured data", async () => {
    const replayData: BallBoiReplay = {
      match: { id: 10, player1Id: 1, player2Id: 2 },
      session: {
        id: 3,
        matchId: 10,
        recordedByClerkUserId: "user_abc",
        status: "completed",
        processingStatus: "completed",
        processingError: null,
        aiNarrative: "This was a great match with 20 shots.",
        videoObjectPath: "/objects/video.webm",
        videoContentType: "video/webm",
        videoSizeBytes: 1048576,
        durationSeconds: 120,
        recordingStartedAt: new Date().toISOString(),
        recordingStoppedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      shots: [
        { id: 1, sessionId: 3, matchId: 10, sequenceNumber: 1, rallyNumber: 1, playerId: 1, timestampSeconds: 5, shotType: "serve", outcome: "winner", shotTypeConfidence: 0.9, courtZoneName: "service_box", courtZoneX: 0.3, courtZoneY: 0.2, contactX: 0.4, contactY: 0.5, speedMph: 110, spinType: "flat", depth: "deep", angleDegrees: 10, playerStance: "neutral", clipStartSeconds: 1, clipEndSeconds: 9 },
      ],
      statistics: {
        id: 1,
        sessionId: 3,
        matchId: 10,
        totalShots: 1,
        totalRallies: 1,
        avgRallyLength: 1,
        avgShotSpeedMph: 110,
        fastestShotMph: 110,
        winners: 1,
        errors: 0,
        serves: 1,
        forehands: 0,
        backhands: 0,
        volleys: 0,
        overheads: 0,
        heatmapData: [],
        shotTypeBreakdown: { serve: 1 },
        outcomeBreakdown: { winner: 1 },
        playerComparisons: {},
      },
    };
    vi.mocked(apiFetch).mockResolvedValue(mockResponse(replayData));

    const result = await getBallBoiReplay(10, TOKEN);

    expect(apiFetch).toHaveBeenCalledWith("/ball-boi/matches/10/replay", TOKEN);
    expect(result.session?.id).toBe(3);
    expect(result.shots).toHaveLength(1);
    expect(result.statistics?.totalShots).toBe(1);
    expect(result.statistics?.winners).toBe(1);
  });

  it("returns null session when no replay exists", async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      mockResponse({ match: { id: 10 }, session: null, shots: [], statistics: null }),
    );

    const result = await getBallBoiReplay(10, TOKEN);
    expect(result.session).toBeNull();
    expect(result.shots).toEqual([]);
    expect(result.statistics).toBeNull();
  });
});

describe("Camera and MediaRecorder API integration", () => {
  beforeEach(() => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getUserMedia is available with the correct mock", async () => {
    expect(navigator.mediaDevices.getUserMedia).toBeDefined();
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    expect(stream).toBeDefined();
    expect(stream.getTracks).toBeDefined();
  });

  it("getUserMedia is called with environment-facing camera constraints", async () => {
    await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: true,
    });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: "environment" },
      audio: true,
    });
  });

  it("MediaRecorder can be created from a stream and started", async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });

    expect(recorder.state).toBe("inactive");
    recorder.start(5000);
    expect(recorder.state).toBe("recording");
  });

  it("MediaRecorder.isTypeSupported returns true for webm", () => {
    expect(MediaRecorder.isTypeSupported("video/webm")).toBe(true);
    expect(MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")).toBe(true);
  });

  it("MediaRecorder stop triggers onstop callback", async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const recorder = new MediaRecorder(stream);

    const stopCallback = vi.fn();
    recorder.onstop = stopCallback;
    recorder.start();
    recorder.stop();

    expect(stopCallback).toHaveBeenCalledOnce();
    expect(recorder.state).toBe("inactive");
  });

  it("starting a Ball Boi session requires camera access and calls the API", async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      mockResponse({ id: 1, matchId: 5, status: "recording", processingStatus: "pending" }, 201),
    );

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: true,
    });

    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm",
    });
    recorder.start(5000);

    const session = await startBallBoiSession(5, TOKEN);

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    expect(recorder.state).toBe("recording");
    expect(session.status).toBe("recording");
    expect(session.matchId).toBe(5);

    recorder.stop();
    expect(recorder.state).toBe("inactive");
  });

  it("stopping the session cancels the API session when no video was uploaded", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(mockResponse({ id: 2, matchId: 5, status: "recording", processingStatus: "pending" }, 201))
      .mockResolvedValueOnce(mockResponse({ id: 2, status: "failed", processingStatus: "failed" }));

    const session = await startBallBoiSession(5, TOKEN);
    expect(session.status).toBe("recording");

    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const recorder = new MediaRecorder(stream);
    recorder.start();

    const cancelled = await cancelBallBoiSession(session.id, TOKEN, "Recording setup failed");

    recorder.stop();
    expect(cancelled.status).toBe("failed");
    expect(recorder.state).toBe("inactive");
  });
});

describe("getBallBoiStatus", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("GETs the status endpoint and returns structured data", async () => {
    const status = { sessionId: 3, status: "processing", processingStatus: "processing", processingError: null, shotCount: 12, progress: 45 };
    vi.mocked(apiFetch).mockResolvedValue(mockResponse(status));

    const result = await getBallBoiStatus(3, TOKEN);

    expect(result.shotCount).toBe(12);
    expect(result.progress).toBe(45);
    expect(result.processingStatus).toBe("processing");
  });
});

describe("getBallBoiVideoUrl", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("GETs the video-url endpoint and returns a signed URL", async () => {
    const payload = { sessionId: 7, videoUrl: "https://storage.example.com/signed-view-url?token=abc" };
    vi.mocked(apiFetch).mockResolvedValue(mockResponse(payload));

    const result = await getBallBoiVideoUrl(7, TOKEN);

    expect(apiFetch).toHaveBeenCalledWith("/ball-boi/sessions/7/video-url", TOKEN);
    expect(result.sessionId).toBe(7);
    expect(result.videoUrl).toBe("https://storage.example.com/signed-view-url?token=abc");
  });

  it("throws when the session is not found (404)", async () => {
    vi.mocked(apiFetch).mockResolvedValue(mockResponse({ error: "Session not found" }, 404));
    await expect(getBallBoiVideoUrl(999, TOKEN)).rejects.toThrow("Session not found");
  });

  it("throws when the user does not have access (403)", async () => {
    vi.mocked(apiFetch).mockResolvedValue(mockResponse({ error: "Forbidden" }, 403));
    await expect(getBallBoiVideoUrl(5, TOKEN)).rejects.toThrow("Forbidden");
  });

  it("throws when the session has no video yet (404 with specific message)", async () => {
    vi.mocked(apiFetch).mockResolvedValue(mockResponse({ error: "No video available for this session" }, 404));
    await expect(getBallBoiVideoUrl(3, TOKEN)).rejects.toThrow("No video available for this session");
  });
});

describe("getBallBoiVideoBlob", () => {
  const SIGNED_URL = "https://storage.example.com/signed-view-url?token=abc&expires=999";

  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("fetches the signed URL directly (not through the API proxy) and returns a Blob", async () => {
    const videoContent = new Uint8Array([0, 1, 2, 3]).buffer;
    const blob = new Blob([videoContent], { type: "video/webm" });
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => blob,
    } as Response);

    const result = await getBallBoiVideoBlob(SIGNED_URL);

    expect(fetchSpy).toHaveBeenCalledWith(SIGNED_URL);
    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("video/webm");
    expect(result.size).toBeGreaterThan(0);
  });

  it("throws when the signed URL returns a non-ok response", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      blob: async () => new Blob(),
    } as Response);

    await expect(getBallBoiVideoBlob(SIGNED_URL)).rejects.toThrow("Video failed to load");
  });

  it("end-to-end: getBallBoiVideoUrl then getBallBoiVideoBlob returns a usable Blob", async () => {
    const fakeData = "fake video bytes for testing";
    const blob = new Blob([fakeData], { type: "video/webm" });

    vi.mocked(apiFetch).mockResolvedValue(mockResponse({ sessionId: 5, videoUrl: SIGNED_URL }));
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => blob,
    } as Response);

    const { videoUrl } = await getBallBoiVideoUrl(5, TOKEN);
    const result = await getBallBoiVideoBlob(videoUrl);

    expect(videoUrl).toBe(SIGNED_URL);
    expect(fetchSpy).toHaveBeenCalledWith(SIGNED_URL);
    expect(result.size).toBe(fakeData.length);
    expect(result.type).toBe("video/webm");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BallBoiReplay as BallBoiReplayData } from "@/lib/ballBoiApi";

vi.mock("wouter", () => ({
  useParams: () => ({ id: "10" }),
  useLocation: () => ["/matches/10/replay", vi.fn()],
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
    React.createElement("a", { href, ...props }, children),
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue("test-token") }),
  useUser: () => ({ user: { id: "user_123", firstName: "Test" } }),
  SignedIn: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  SignedOut: () => null,
}));

vi.mock("@/lib/ballBoiApi", () => ({
  getBallBoiReplay: vi.fn(),
  getBallBoiVideoUrl: vi.fn().mockResolvedValue({ sessionId: 3, videoUrl: "https://storage.example.com/signed-view-url" }),
  getBallBoiVideoBlob: vi.fn().mockResolvedValue(new Blob([], { type: "video/webm" })),
}));

import { getBallBoiReplay } from "@/lib/ballBoiApi";
import BallBoiReplay from "@/pages/BallBoiReplay";

const sampleReplay: BallBoiReplayData = {
  match: { id: 10, player1Id: 1, player2Id: 2, leagueId: null },
  session: {
    id: 3,
    matchId: 10,
    recordedByClerkUserId: "user_123",
    status: "completed",
    processingStatus: "completed",
    processingError: null,
    aiNarrative:
      "Alice vs Bob featured 12 tracked shots across 4 rallies averaging 3.0 shots. The most common pattern was forehand, with 4 winners and a fastest detected ball speed of 95 mph.",
    videoObjectPath: "/objects/match-video.webm",
    videoContentType: "video/webm",
    videoSizeBytes: 2097152,
    durationSeconds: 180,
    recordingStartedAt: "2026-04-22T14:00:00Z",
    recordingStoppedAt: "2026-04-22T14:03:00Z",
    createdAt: "2026-04-22T14:00:00Z",
    updatedAt: "2026-04-22T14:05:00Z",
  },
  shots: [
    {
      id: 1, sessionId: 3, matchId: 10, sequenceNumber: 1, rallyNumber: 1,
      playerId: 1, timestampSeconds: 10, shotType: "serve", outcome: "winner",
      shotTypeConfidence: 0.95, courtZoneName: "deuce_service_box",
      courtZoneX: 0.3, courtZoneY: 0.2, contactX: 0.4, contactY: 0.5,
      speedMph: 95, spinType: "flat", depth: "deep", angleDegrees: 5,
      playerStance: "neutral", clipStartSeconds: 6, clipEndSeconds: 14,
    },
    {
      id: 2, sessionId: 3, matchId: 10, sequenceNumber: 2, rallyNumber: 1,
      playerId: 2, timestampSeconds: 15, shotType: "forehand", outcome: "rally_continuation",
      shotTypeConfidence: 0.88, courtZoneName: "baseline_center",
      courtZoneX: 0.5, courtZoneY: 0.8, contactX: 0.5, contactY: 0.7,
      speedMph: 72, spinType: "topspin", depth: "deep", angleDegrees: 20,
      playerStance: "semi_open", clipStartSeconds: 11, clipEndSeconds: 19,
    },
    {
      id: 3, sessionId: 3, matchId: 10, sequenceNumber: 3, rallyNumber: 2,
      playerId: 1, timestampSeconds: 30, shotType: "backhand", outcome: "error",
      shotTypeConfidence: 0.82, courtZoneName: "net",
      courtZoneX: 0.5, courtZoneY: 0.5, contactX: 0.6, contactY: 0.5,
      speedMph: 55, spinType: "slice", depth: "short", angleDegrees: -10,
      playerStance: "closed", clipStartSeconds: 26, clipEndSeconds: 34,
    },
    {
      id: 4, sessionId: 3, matchId: 10, sequenceNumber: 4, rallyNumber: 2,
      playerId: 2, timestampSeconds: 45, shotType: "volley", outcome: "winner",
      shotTypeConfidence: 0.91, courtZoneName: "net_zone",
      courtZoneX: 0.7, courtZoneY: 0.3, contactX: 0.7, contactY: 0.4,
      speedMph: 65, spinType: null, depth: "short", angleDegrees: 0,
      playerStance: "neutral", clipStartSeconds: 41, clipEndSeconds: 49,
    },
  ],
  statistics: {
    id: 1, sessionId: 3, matchId: 10,
    totalShots: 4, totalRallies: 2, avgRallyLength: 2,
    avgShotSpeedMph: 71.75, fastestShotMph: 95,
    winners: 2, errors: 1, serves: 1, forehands: 1, backhands: 1, volleys: 1, overheads: 0,
    heatmapData: [
      { x: 0.3, y: 0.2, shotType: "serve", outcome: "winner", speedMph: 95 },
      { x: 0.5, y: 0.8, shotType: "forehand", outcome: "rally_continuation", speedMph: 72 },
      { x: 0.5, y: 0.5, shotType: "backhand", outcome: "error", speedMph: 55 },
      { x: 0.7, y: 0.3, shotType: "volley", outcome: "winner", speedMph: 65 },
    ],
    shotTypeBreakdown: { serve: 1, forehand: 1, backhand: 1, volley: 1 },
    outcomeBreakdown: { winner: 2, rally_continuation: 1, error: 1 },
    playerComparisons: {
      "1": { playerId: 1, name: "Alice", totalShots: 2, winners: 1, errors: 1, avgSpeedMph: 75, shotTypes: { serve: 1, backhand: 1 } },
      "2": { playerId: 2, name: "Bob", totalShots: 2, winners: 1, errors: 0, avgSpeedMph: 68.5, shotTypes: { forehand: 1, volley: 1 } },
    },
  },
};

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function renderReplay(overrideData?: Partial<BallBoiReplayData>) {
  const data = overrideData
    ? { ...sampleReplay, ...overrideData }
    : sampleReplay;
  vi.mocked(getBallBoiReplay).mockResolvedValue(data);

  const queryClient = makeQueryClient();
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(BallBoiReplay),
    ),
  );
}

describe("BallBoiReplay — loading and no-session states", () => {
  beforeEach(() => {
    vi.mocked(getBallBoiReplay).mockReset();
  });

  it("shows a loading skeleton while data is being fetched", () => {
    vi.mocked(getBallBoiReplay).mockReturnValue(new Promise(() => undefined));

    const queryClient = makeQueryClient();
    const { container } = render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(BallBoiReplay),
      ),
    );

    const pulsingElements = container.querySelectorAll(".animate-pulse");
    expect(pulsingElements.length).toBeGreaterThan(0);
  });

  it("shows the 'No Ball Boi replay yet' message when session is null", async () => {
    vi.mocked(getBallBoiReplay).mockResolvedValue({
      match: { id: 10 },
      session: null,
      shots: [],
      statistics: null,
    });

    const queryClient = makeQueryClient();
    render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(BallBoiReplay),
      ),
    );

    await waitFor(() => {
      expect(screen.getByText("No Ball Boi replay yet")).toBeInTheDocument();
    });
  });
});

describe("BallBoiReplay — session with completed data", () => {
  beforeEach(() => {
    vi.mocked(getBallBoiReplay).mockReset();
  });

  it("renders the page title when a session is available", async () => {
    renderReplay();
    await waitFor(() => {
      expect(screen.getByText("Ball Boi Replay")).toBeInTheDocument();
    });
  });

  it("renders the processing status badge", async () => {
    renderReplay();
    await waitFor(() => {
      expect(screen.getByText("Completed")).toBeInTheDocument();
    });
  });

  it("renders stat cards with shots and rallies count", async () => {
    renderReplay();
    await waitFor(() => {
      expect(screen.getByText("Shots")).toBeInTheDocument();
      expect(screen.getByText("Rallies")).toBeInTheDocument();
      expect(screen.getByText("Avg Speed")).toBeInTheDocument();
      expect(screen.getByText("Fastest")).toBeInTheDocument();
    });
  });

  it("renders all seven tab triggers", async () => {
    renderReplay();
    await waitFor(() => {
      expect(screen.getByText("Full Video")).toBeInTheDocument();
      expect(screen.getByText("Shot-by-Shot")).toBeInTheDocument();
      expect(screen.getByText("Rally Replay")).toBeInTheDocument();
      expect(screen.getByText("Heatmap")).toBeInTheDocument();
      expect(screen.getByText("Timeline")).toBeInTheDocument();
      expect(screen.getByText("Stats")).toBeInTheDocument();
      expect(screen.getByText("Comparison")).toBeInTheDocument();
    });
  });

  it("renders the AI narrative text", async () => {
    renderReplay();
    await waitFor(() => {
      expect(screen.getByText(/Alice vs Bob featured/)).toBeInTheDocument();
    });
  });

  it("renders the set filter buttons (Full match, Set 1, Set 2, Set 3)", async () => {
    renderReplay();
    await waitFor(() => {
      expect(screen.getByText("Full match")).toBeInTheDocument();
      expect(screen.getByText("Set 1")).toBeInTheDocument();
      expect(screen.getByText("Set 2")).toBeInTheDocument();
      expect(screen.getByText("Set 3")).toBeInTheDocument();
    });
  });

  it("renders shot list items in the shot-by-shot tab content", async () => {
    const user = userEvent.setup();
    renderReplay();
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Shot-by-Shot" })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("tab", { name: "Shot-by-Shot" }));
    await waitFor(() => {
      expect(screen.getByText(/#1 Serve/i)).toBeInTheDocument();
      expect(screen.getByText(/#2 Forehand/i)).toBeInTheDocument();
    });
  });

  it("renders rally groups in the rally replay section", async () => {
    const user = userEvent.setup();
    renderReplay();
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Rally Replay" })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("tab", { name: "Rally Replay" }));
    await waitFor(() => {
      expect(screen.getByText("Rally 1")).toBeInTheDocument();
      expect(screen.getByText("Rally 2")).toBeInTheDocument();
    });
  });

  it("renders player comparison cards", async () => {
    const user = userEvent.setup();
    renderReplay();
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Comparison" })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("tab", { name: "Comparison" }));
    await waitFor(() => {
      expect(screen.getAllByText("Alice").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Bob").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows the processing error when one is present", async () => {
    renderReplay({
      session: {
        ...sampleReplay.session!,
        processingStatus: "failed",
        processingError: "ML analysis completed without detected shots",
      },
    });

    await waitFor(() => {
      expect(
        screen.getByText("ML analysis completed without detected shots"),
      ).toBeInTheDocument();
    });
  });

  it("shows the yellow warming-up banner when processingError matches the ML unavailability pattern", async () => {
    renderReplay({
      session: {
        ...sampleReplay.session!,
        processingStatus: "failed",
        processingError:
          "Analysis service is temporarily unavailable — your video has been saved and results will appear once the service is back online.",
      },
    });

    await waitFor(() => {
      expect(
        screen.getByText("Analysis service is warming up — try again in a moment."),
      ).toBeInTheDocument();
    });
  });

  it("does not show the generic red error banner when the error is an ML unavailability message", async () => {
    renderReplay({
      session: {
        ...sampleReplay.session!,
        processingStatus: "failed",
        processingError:
          "Analysis service is temporarily unavailable — your video has been saved and results will appear once the service is back online.",
      },
    });

    await waitFor(() => {
      expect(
        screen.queryByText(
          "Analysis service is temporarily unavailable — your video has been saved and results will appear once the service is back online.",
        ),
      ).not.toBeInTheDocument();
    });
  });

  it("shows the warming-up secondary message about saved video", async () => {
    renderReplay({
      session: {
        ...sampleReplay.session!,
        processingStatus: "failed",
        processingError:
          "Analysis service is temporarily unavailable — your video has been saved and results will appear once the service is back online.",
      },
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "Your video has been saved. Shot data will appear here once the analysis service is available.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("shows the generic red error banner for non-ML-unavailability errors", async () => {
    renderReplay({
      session: {
        ...sampleReplay.session!,
        processingStatus: "failed",
        processingError: "ML analysis completed without detected shots",
      },
    });

    await waitFor(() => {
      expect(
        screen.getByText("ML analysis completed without detected shots"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Analysis service is warming up — try again in a moment."),
      ).not.toBeInTheDocument();
    });
  });
});

describe("BallBoiReplay — Watch Video button", () => {
  beforeEach(() => {
    vi.mocked(getBallBoiReplay).mockReset();
  });

  it("shows the Watch Video button when the session has a videoObjectPath", async () => {
    renderReplay();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /watch video/i })).toBeInTheDocument();
    });
  });

  it("shows 'No video recorded' text when videoObjectPath is null", async () => {
    renderReplay({
      session: {
        ...sampleReplay.session!,
        videoObjectPath: null,
      },
    });
    await waitFor(() => {
      expect(screen.getByText("No video recorded")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /watch video/i })).not.toBeInTheDocument();
    });
  });

  it("clicking Watch Video switches the active tab to the Full Video tab", async () => {
    const user = userEvent.setup();
    renderReplay();

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Stats" })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("tab", { name: "Stats" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Full Video" })).toHaveAttribute("aria-selected", "false");
    });

    await user.click(screen.getByRole("button", { name: /watch video/i }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Full Video" })).toHaveAttribute("aria-selected", "true");
    });
  });

  it("renders a video element after clicking Watch Video", async () => {
    const user = userEvent.setup();
    renderReplay();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /watch video/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /watch video/i }));

    await waitFor(() => {
      const videoEl = document.querySelector("video");
      expect(videoEl).not.toBeNull();
      expect(videoEl!.src).toContain("signed-view-url");
    });
  });
});

describe("BallBoiReplay — Download Video button", () => {
  beforeEach(() => {
    vi.mocked(getBallBoiReplay).mockReset();
  });

  it("shows the Download Video button when the session has a videoObjectPath", async () => {
    renderReplay();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /download video/i })).toBeInTheDocument();
    });
  });

  it("Download Video button is not disabled when the session has a videoObjectPath", async () => {
    renderReplay();
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /download video/i });
      expect(btn).not.toBeDisabled();
    });
  });

  it("shows 'No video recorded' text and hides Download Video when videoObjectPath is null", async () => {
    renderReplay({
      session: {
        ...sampleReplay.session!,
        videoObjectPath: null,
      },
    });
    await waitFor(() => {
      expect(screen.getByText("No video recorded")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /download video/i })).not.toBeInTheDocument();
    });
  });

  it("clicking Download Video calls getBallBoiVideoUrl with the session id", async () => {
    const { getBallBoiVideoUrl, getBallBoiVideoBlob } = await import("@/lib/ballBoiApi");
    const user = userEvent.setup();
    renderReplay();

    const createObjectURLSpy = vi.fn().mockReturnValue("blob:fake-url");
    const revokeObjectURLSpy = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURLSpy, writable: true, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURLSpy, writable: true, configurable: true });

    const appendChildSpy = vi.spyOn(document.body, "appendChild").mockImplementation((el) => el);
    const removeChildSpy = vi.spyOn(document.body, "removeChild").mockImplementation((el) => el);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /download video/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /download video/i }));

    await waitFor(() => {
      expect(getBallBoiVideoUrl).toHaveBeenCalledWith(sampleReplay.session!.id, "test-token");
    });

    await waitFor(() => {
      expect(getBallBoiVideoBlob).toHaveBeenCalledWith("https://storage.example.com/signed-view-url", expect.any(Function));
    });

    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it("clicking Download Video triggers a download anchor click", async () => {
    const user = userEvent.setup();
    renderReplay();

    const createObjectURLSpy = vi.fn().mockReturnValue("blob:fake-url");
    const revokeObjectURLSpy = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURLSpy, writable: true, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURLSpy, writable: true, configurable: true });

    const anchorClicks: string[] = [];
    const appendChildSpy = vi.spyOn(document.body, "appendChild").mockImplementation((el) => {
      if (el instanceof HTMLAnchorElement) {
        anchorClicks.push(el.download);
      }
      return el;
    });
    const removeChildSpy = vi.spyOn(document.body, "removeChild").mockImplementation((el) => el);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /download video/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /download video/i }));

    await waitFor(() => {
      expect(anchorClicks.length).toBeGreaterThan(0);
      expect(anchorClicks[0]).toMatch(/match-10-replay\.mp4/);
    });

    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:fake-url");

    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
    clickSpy.mockRestore();
  });
});

describe("BallBoiReplay — retry countdown", () => {
  beforeEach(() => {
    vi.mocked(getBallBoiReplay).mockReset();
  });

  it("shows retry countdown banner when session has nextRetryAt metadata", async () => {
    const futureTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    renderReplay({
      session: {
        ...sampleReplay.session!,
        processingStatus: "failed",
        processingError:
          "Analysis service is temporarily unavailable — your video has been saved and results will appear once the service is back online.",
        metadata: { retryCount: 0, nextRetryAt: futureTime },
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/Retry 1 of 3 scheduled in/)).toBeInTheDocument();
    });
  });

  it("shows the correct retry number for subsequent retries", async () => {
    const futureTime = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    renderReplay({
      session: {
        ...sampleReplay.session!,
        processingStatus: "failed",
        processingError:
          "Analysis service is temporarily unavailable — your video has been saved and results will appear once the service is back online.",
        metadata: { retryCount: 2, nextRetryAt: futureTime },
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/Retry 3 of 3 scheduled in/)).toBeInTheDocument();
    });
  });

  it("shows the auto-retry secondary message when a retry is pending", async () => {
    const futureTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    renderReplay({
      session: {
        ...sampleReplay.session!,
        processingStatus: "failed",
        processingError:
          "Analysis service is temporarily unavailable — your video has been saved and results will appear once the service is back online.",
        metadata: { retryCount: 0, nextRetryAt: futureTime },
      },
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "Your video has been saved. Analysis will restart automatically — this page will update when results are ready.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("falls back to warming-up message when no nextRetryAt metadata is present", async () => {
    renderReplay({
      session: {
        ...sampleReplay.session!,
        processingStatus: "failed",
        processingError:
          "Analysis service is temporarily unavailable — your video has been saved and results will appear once the service is back online.",
        metadata: null,
      },
    });

    await waitFor(() => {
      expect(
        screen.getByText("Analysis service is warming up — try again in a moment."),
      ).toBeInTheDocument();
    });
  });
});

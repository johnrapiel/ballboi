import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("wouter", () => ({
  useParams: () => ({}),
  useLocation: () => ["/my-matches", vi.fn()],
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement("a", { href, ...props }, children),
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue("test-token") }),
  useUser: () => ({ user: { id: "user_123", firstName: "Test" } }),
  SignedIn: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  SignedOut: () => null,
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      ...props
    }: {
      children: React.ReactNode;
      initial?: unknown;
      animate?: unknown;
      [key: string]: unknown;
    }) => React.createElement("div", props, children),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

const mockMutate = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useGetMyMatches: vi.fn(),
  useUpdateMatch: vi.fn(),
  getGetMyMatchesQueryKey: vi.fn().mockReturnValue(["my-matches"]),
}));

import { useGetMyMatches, useUpdateMatch } from "@workspace/api-client-react";
import MyMatches from "@/pages/MyMatches";

const scheduledMatch = {
  matchId: 42,
  playerId: 1,
  player1Id: 1,
  player1Name: "Alice",
  player2Id: 2,
  player2Name: "Bob",
  opponentId: 2,
  opponentName: "Bob",
  scheduledAt: "2026-05-10T14:00:00Z",
  status: "scheduled",
  leagueId: null,
  leagueName: null,
  location: "Court A",
  score: null,
  winnerId: null,
};

const completedMatch = {
  matchId: 43,
  playerId: 1,
  player1Id: 1,
  player1Name: "Alice",
  player2Id: 2,
  player2Name: "Bob",
  opponentId: 2,
  opponentName: "Bob",
  scheduledAt: "2026-04-01T14:00:00Z",
  status: "completed",
  leagueId: null,
  leagueName: null,
  location: "Court B",
  score: "6-3, 6-2",
  winnerId: 1,
};

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function renderPage(queryClient?: QueryClient) {
  const qc = queryClient ?? makeQueryClient();
  return {
    qc,
    ...render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(MyMatches),
      ),
    ),
  };
}

describe("MyMatches — page structure", () => {
  beforeEach(() => {
    vi.mocked(useGetMyMatches).mockReturnValue({
      data: {
        playerId: 1,
        playerIds: [1],
        upcoming: [scheduledMatch],
        past: [completedMatch],
      },
      isLoading: false,
    } as ReturnType<typeof useGetMyMatches>);
    vi.mocked(useUpdateMatch).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateMatch>);
    mockMutate.mockReset();
  });

  it("renders the My Matches heading", () => {
    renderPage();
    expect(screen.getByText("My Matches")).toBeInTheDocument();
  });

  it("shows the four stat summary cards", () => {
    renderPage();
    expect(screen.getByText("Completed Matches")).toBeInTheDocument();
    expect(screen.getByText("W-L Record")).toBeInTheDocument();
    expect(screen.getByText("Win %")).toBeInTheDocument();
    expect(screen.getByText("Current Streak")).toBeInTheDocument();
  });

  it("shows an Upcoming section and a Past section", () => {
    renderPage();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    expect(screen.getByText("Past")).toBeInTheDocument();
  });

  it("displays the opponent name for the upcoming match", () => {
    renderPage();
    expect(screen.getAllByText("Bob").length).toBeGreaterThan(0);
  });

  it("renders the Log button for a scheduled match that has no result", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /^log$/i })).toBeInTheDocument();
  });

  it("shows loading skeletons while data is fetching", () => {
    vi.mocked(useGetMyMatches).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof useGetMyMatches>);
    const { container } = renderPage();
    const pulsingElements = container.querySelectorAll(".animate-pulse");
    expect(pulsingElements.length).toBeGreaterThan(0);
  });
});

describe("MyMatches — inline result logging form", () => {
  beforeEach(() => {
    vi.mocked(useGetMyMatches).mockReturnValue({
      data: {
        playerId: 1,
        playerIds: [1],
        upcoming: [scheduledMatch],
        past: [],
      },
      isLoading: false,
    } as ReturnType<typeof useGetMyMatches>);
    vi.mocked(useUpdateMatch).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateMatch>);
    mockMutate.mockReset();
  });

  it("opens the inline form when the Log button is clicked", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /^log$/i }));

    expect(screen.getByText("Log result")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("6-4, 3-6, 7-5")).toBeInTheDocument();
  });

  it("shows winner-selection buttons for 'You' and the opponent inside the form", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /^log$/i }));

    const youBtn = screen.getByRole("button", { name: /^you$/i });
    const opponentBtn = screen.getByRole("button", { name: /^bob$/i });
    expect(youBtn).toBeInTheDocument();
    expect(opponentBtn).toBeInTheDocument();
  });

  it("closes the form when the Cancel button is clicked", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /^log$/i }));
    expect(screen.getByText("Log result")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByText("Log result")).not.toBeInTheDocument();
  });

  it("keeps the Save Result button disabled until a winner is chosen", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /^log$/i }));

    const saveBtn = screen.getByRole("button", { name: /save result/i });
    expect(saveBtn).toBeDisabled();
  });

  it("enables the Save Result button after a winner is selected", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /^log$/i }));
    await user.click(screen.getByRole("button", { name: /^you$/i }));

    const saveBtn = screen.getByRole("button", { name: /save result/i });
    expect(saveBtn).not.toBeDisabled();
  });

  it("calls mutate with the correct matchId, status, winnerId, and score on submission", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /^log$/i }));
    await user.click(screen.getByRole("button", { name: /^you$/i }));

    const scoreInput = screen.getByPlaceholderText("6-4, 3-6, 7-5");
    await user.type(scoreInput, "6-3, 6-2");

    await user.click(screen.getByRole("button", { name: /save result/i }));

    expect(mockMutate).toHaveBeenCalledOnce();
    const [payload] = mockMutate.mock.calls[0] as [{ matchId: number; data: { status: string; winnerId: number; score: string } }, unknown];
    expect(payload.matchId).toBe(42);
    expect(payload.data.status).toBe("completed");
    expect(payload.data.score).toBe("6-3, 6-2");
    expect(payload.data.winnerId).toBe(1);
  });

  it("shows a score validation error and does not submit for a malformed score", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /^log$/i }));
    await user.click(screen.getByRole("button", { name: /^you$/i }));

    const scoreInput = screen.getByPlaceholderText("6-4, 3-6, 7-5");
    await user.type(scoreInput, "bad-score");

    await user.click(screen.getByRole("button", { name: /save result/i }));

    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/isn't a valid set score/i)).toBeInTheDocument();
  });

  it("shows a winner-mismatch error when score sets contradict the selected winner", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /^log$/i }));
    await user.click(screen.getByRole("button", { name: /^bob$/i }));

    const scoreInput = screen.getByPlaceholderText("6-4, 3-6, 7-5");
    await user.type(scoreInput, "6-3, 6-2");

    await user.click(screen.getByRole("button", { name: /save result/i }));

    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/score shows/i)).toBeInTheDocument();
  });

  it("closes the form and invalidates the matches query after a successful save", async () => {
    mockMutate.mockImplementation(
      (_payload: unknown, callbacks: { onSuccess?: () => void }) => {
        callbacks?.onSuccess?.();
      },
    );

    const user = userEvent.setup();
    const qc = makeQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { rerender } = renderPage(qc);

    await user.click(screen.getByRole("button", { name: /^log$/i }));
    await user.click(screen.getByRole("button", { name: /^you$/i }));
    await user.click(screen.getByRole("button", { name: /save result/i }));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["my-matches"] }),
      );
    });

    expect(screen.queryByText("Log result")).not.toBeInTheDocument();
  });

  it("reflects the saved result on the page after data refresh", async () => {
    const nowCompletedMatch = {
      ...scheduledMatch,
      status: "completed" as const,
      winnerId: 1,
      score: "6-3, 6-2",
    };

    mockMutate.mockImplementation(
      (_payload: unknown, callbacks: { onSuccess?: () => void }) => {
        callbacks?.onSuccess?.();
      },
    );

    const user = userEvent.setup();
    const qc = makeQueryClient();

    const { rerender } = renderPage(qc);

    await user.click(screen.getByRole("button", { name: /^log$/i }));
    await user.click(screen.getByRole("button", { name: /^you$/i }));

    const scoreInput = screen.getByPlaceholderText("6-4, 3-6, 7-5");
    await user.type(scoreInput, "6-3, 6-2");

    await user.click(screen.getByRole("button", { name: /save result/i }));

    vi.mocked(useGetMyMatches).mockReturnValue({
      data: {
        playerId: 1,
        playerIds: [1],
        upcoming: [],
        past: [nowCompletedMatch],
      },
      isLoading: false,
    } as ReturnType<typeof useGetMyMatches>);

    rerender(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(MyMatches),
      ),
    );

    await waitFor(() => {
      expect(screen.getByText("Won")).toBeInTheDocument();
    });
    expect(screen.getByText("6-3, 6-2")).toBeInTheDocument();
  });
});

describe("MyMatches — summary stat values", () => {
  beforeEach(() => {
    vi.mocked(useUpdateMatch).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateMatch>);
    mockMutate.mockReset();
  });

  function statCard(label: string) {
    return within(screen.getByText(label).closest("div")!);
  }

  it("shows correct totals, W-L record, win %, and streak from initial data", () => {
    vi.mocked(useGetMyMatches).mockReturnValue({
      data: {
        playerId: 1,
        playerIds: [1],
        upcoming: [],
        past: [completedMatch],
      },
      isLoading: false,
    } as ReturnType<typeof useGetMyMatches>);

    renderPage();

    expect(statCard("Completed Matches").getByText("1")).toBeInTheDocument();
    expect(statCard("W-L Record").getByText("1-0")).toBeInTheDocument();
    expect(statCard("Win %").getByText("100%")).toBeInTheDocument();
    expect(statCard("Current Streak").getByText("W1")).toBeInTheDocument();
    expect(statCard("Current Streak").getByText("Winning streak")).toBeInTheDocument();
  });

  it("shows zero-state summary when there are no completed matches", () => {
    vi.mocked(useGetMyMatches).mockReturnValue({
      data: {
        playerId: 1,
        playerIds: [1],
        upcoming: [scheduledMatch],
        past: [],
      },
      isLoading: false,
    } as ReturnType<typeof useGetMyMatches>);

    renderPage();

    expect(statCard("Completed Matches").getByText("0")).toBeInTheDocument();
    expect(statCard("W-L Record").getByText("0-0")).toBeInTheDocument();
    expect(statCard("Win %").getByText("0%")).toBeInTheDocument();
    expect(statCard("Current Streak").getByText("—")).toBeInTheDocument();
    expect(statCard("Current Streak").getByText("No results yet")).toBeInTheDocument();
  });

  it("updates summary values after logging a result and the list refreshes", async () => {
    vi.mocked(useGetMyMatches).mockReturnValue({
      data: {
        playerId: 1,
        playerIds: [1],
        upcoming: [scheduledMatch],
        past: [],
      },
      isLoading: false,
    } as ReturnType<typeof useGetMyMatches>);

    mockMutate.mockImplementation(
      (_payload: unknown, callbacks: { onSuccess?: () => void }) => {
        callbacks?.onSuccess?.();
      },
    );

    const user = userEvent.setup();
    const qc = makeQueryClient();
    const { rerender } = renderPage(qc);

    expect(statCard("Completed Matches").getByText("0")).toBeInTheDocument();
    expect(statCard("W-L Record").getByText("0-0")).toBeInTheDocument();
    expect(statCard("Win %").getByText("0%")).toBeInTheDocument();
    expect(statCard("Current Streak").getByText("—")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^log$/i }));
    await user.click(screen.getByRole("button", { name: /^you$/i }));
    const scoreInput = screen.getByPlaceholderText("6-4, 3-6, 7-5");
    await user.type(scoreInput, "6-3, 6-2");
    await user.click(screen.getByRole("button", { name: /save result/i }));

    const nowCompleted = {
      ...scheduledMatch,
      status: "completed" as const,
      winnerId: 1,
      score: "6-3, 6-2",
    };

    vi.mocked(useGetMyMatches).mockReturnValue({
      data: {
        playerId: 1,
        playerIds: [1],
        upcoming: [],
        past: [nowCompleted],
      },
      isLoading: false,
    } as ReturnType<typeof useGetMyMatches>);

    rerender(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(MyMatches),
      ),
    );

    await waitFor(() => {
      expect(statCard("Completed Matches").getByText("1")).toBeInTheDocument();
    });
    expect(statCard("W-L Record").getByText("1-0")).toBeInTheDocument();
    expect(statCard("Win %").getByText("100%")).toBeInTheDocument();
    expect(statCard("Current Streak").getByText("W1")).toBeInTheDocument();
    expect(statCard("Current Streak").getByText("Winning streak")).toBeInTheDocument();
  });
});

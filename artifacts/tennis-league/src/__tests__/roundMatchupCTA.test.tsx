import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("wouter", () => ({
  useParams: () => ({ id: "1" }),
  useLocation: () => ["/leagues/1", vi.fn()],
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement("a", { href, ...props }, children),
  useRouter: () => ({ base: "" }),
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue("test-token") }),
  useUser: () => ({
    user: { id: "user_clerk_123", firstName: "Alice", fullName: "Alice Smith" },
  }),
  SignedIn: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  SignedOut: () => null,
}));

vi.mock("framer-motion", () => {
  function makeMotion(tag: string) {
    return ({
      children,
      initial: _i,
      animate: _a,
      exit: _e,
      ...props
    }: {
      children?: React.ReactNode;
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      [key: string]: unknown;
    }) => React.createElement(tag, props, children);
  }
  return {
    motion: {
      div: makeMotion("div"),
      tr: makeMotion("tr"),
      span: makeMotion("span"),
      section: makeMotion("section"),
      ul: makeMotion("ul"),
      li: makeMotion("li"),
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock("qrcode.react", () => ({
  QRCodeSVG: () => React.createElement("svg", { "data-testid": "qr-code" }),
}));

vi.mock("@/components/PlayoffBracket", () => ({
  default: () => React.createElement("div", { "data-testid": "playoff-bracket" }),
}));

vi.mock("@/lib/scheduleApi", () => ({
  apiFetch: vi.fn().mockResolvedValue({ ok: false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/useIsAdmin", () => ({
  useIsAdmin: () => false,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetLeague: vi.fn(),
  useGetLeagueStandings: vi.fn(),
  useGetMatches: vi.fn(),
  useGetPlayers: vi.fn(),
  useGetLeagueInvites: vi.fn(),
  useGetCurrentLeagueRound: vi.fn(),
  useGetLeagueRounds: vi.fn().mockReturnValue({ data: [], isLoading: false }),
  useGetLeaguePlayoffs: vi.fn(),
  useCreateMatch: vi.fn(),
  useCreateLeagueInvite: vi.fn(),
  useGenerateLeagueRound: vi.fn(),
  useGenerateLeaguePlayoffs: vi.fn(),
  useResetLeagueRecords: vi.fn(),
  getGetMatchesQueryKey: vi.fn().mockReturnValue(["matches"]),
  useGetMyMatches: vi.fn(),
  useUpdateMatch: vi.fn(),
  getGetMyMatchesQueryKey: vi.fn().mockReturnValue(["my-matches"]),
  useGetLeagueSeasons: vi.fn().mockReturnValue({ data: [], isLoading: false }),
  useGetActiveLeagueSeason: vi.fn().mockReturnValue({ data: null, isLoading: false }),
  useCreateLeagueSeason: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useUpdateSeason: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useDeleteSeason: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
}));

import {
  useGetLeague,
  useGetLeagueStandings,
  useGetMatches,
  useGetPlayers,
  useGetLeagueInvites,
  useGetCurrentLeagueRound,
  useGetLeaguePlayoffs,
  useCreateMatch,
  useCreateLeagueInvite,
  useGenerateLeagueRound,
  useGenerateLeaguePlayoffs,
  useResetLeagueRecords,
  useGetMyMatches,
  useUpdateMatch,
} from "@workspace/api-client-react";

import LeagueDetail from "@/pages/LeagueDetail";
import MyMatches from "@/pages/MyMatches";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function renderWithQC(element: React.ReactElement, qc?: QueryClient) {
  const client = qc ?? makeQueryClient();
  return render(
    React.createElement(QueryClientProvider, { client }, element),
  );
}

const mockLeague = {
  id: 1,
  name: "Test League",
  description: null,
  createdByClerkUserId: "other_user",
  createdAt: "2026-01-01T00:00:00Z",
};

const mockPlayer = {
  id: 10,
  name: "Alice",
  leagueId: 1,
  clerkUserId: "user_clerk_123",
  email: null,
  phone: null,
  rating: null,
  wins: 0,
  losses: 0,
};

const mockRoundMatchup = {
  matchId: 99,
  player1Id: 10,
  player1Name: "Alice",
  player2Id: 20,
  player2Name: "Bob",
  scheduledAt: null,
  status: "scheduled",
  score: null,
  winnerId: null,
};

const mockCurrentRound = {
  id: 5,
  leagueId: 1,
  roundNumber: 1,
  startDate: "2026-05-01",
  endDate: "2099-12-31",
  status: "active",
  matchups: [mockRoundMatchup],
};

function setupLeagueDetailMocks() {
  vi.mocked(useGetLeague).mockReturnValue({
    data: mockLeague,
    isLoading: false,
  } as ReturnType<typeof useGetLeague>);

  vi.mocked(useGetLeagueStandings).mockReturnValue({
    data: [],
    isLoading: false,
  } as ReturnType<typeof useGetLeagueStandings>);

  vi.mocked(useGetMatches).mockReturnValue({
    data: [],
    isLoading: false,
  } as ReturnType<typeof useGetMatches>);

  vi.mocked(useGetPlayers).mockReturnValue({
    data: [mockPlayer as any],
    isLoading: false,
  } as ReturnType<typeof useGetPlayers>);

  vi.mocked(useGetLeagueInvites).mockReturnValue({
    data: [],
    isLoading: false,
  } as ReturnType<typeof useGetLeagueInvites>);

  vi.mocked(useGetCurrentLeagueRound).mockReturnValue({
    data: mockCurrentRound as any,
    isLoading: false,
  } as ReturnType<typeof useGetCurrentLeagueRound>);

  vi.mocked(useGetLeaguePlayoffs).mockReturnValue({
    data: undefined,
    isLoading: false,
  } as ReturnType<typeof useGetLeaguePlayoffs>);

  vi.mocked(useCreateMatch).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useCreateMatch>);

  vi.mocked(useCreateLeagueInvite).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useCreateLeagueInvite>);

  vi.mocked(useGenerateLeagueRound).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useGenerateLeagueRound>);

  vi.mocked(useGenerateLeaguePlayoffs).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useGenerateLeaguePlayoffs>);

  vi.mocked(useResetLeagueRecords).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useResetLeagueRecords>);
}

describe("LeagueDetail — Current Round unscheduled matchup CTA", () => {
  beforeEach(() => {
    setupLeagueDetailMocks();
  });

  it("shows 'Arrange match' button for the current user's unscheduled round matchup", () => {
    renderWithQC(React.createElement(LeagueDetail));
    expect(screen.getAllByText("Arrange match").length).toBeGreaterThan(0);
  });

  it("links the 'Arrange match' button to /matches/:id", () => {
    renderWithQC(React.createElement(LeagueDetail));
    const links = screen
      .getAllByRole("link", { name: /arrange match/i });
    expect(links.length).toBeGreaterThan(0);
    links.forEach((link) => {
      expect(link).toHaveAttribute("href", `/matches/${mockRoundMatchup.matchId}`);
    });
  });

  it("does not show 'Arrange match' when the matchup is already scheduled", () => {
    vi.mocked(useGetCurrentLeagueRound).mockReturnValue({
      data: {
        ...mockCurrentRound,
        matchups: [
          {
            ...mockRoundMatchup,
            scheduledAt: "2026-06-15T10:00:00Z",
          },
        ],
      } as any,
      isLoading: false,
    } as ReturnType<typeof useGetCurrentLeagueRound>);

    renderWithQC(React.createElement(LeagueDetail));
    expect(screen.queryByText("Arrange match")).not.toBeInTheDocument();
  });

  it("does not show 'Arrange match' when the matchup is completed", () => {
    vi.mocked(useGetCurrentLeagueRound).mockReturnValue({
      data: {
        ...mockCurrentRound,
        matchups: [
          {
            ...mockRoundMatchup,
            status: "completed",
            scheduledAt: "2026-06-15T10:00:00Z",
            score: "6-3, 6-2",
            winnerId: 10,
          },
        ],
      } as any,
      isLoading: false,
    } as ReturnType<typeof useGetCurrentLeagueRound>);

    renderWithQC(React.createElement(LeagueDetail));
    expect(screen.queryByText("Arrange match")).not.toBeInTheDocument();
  });
});

const roundScheduledMatch = {
  matchId: 55,
  playerId: 1,
  player1Id: 1,
  player1Name: "Alice",
  player2Id: 2,
  player2Name: "Bob",
  opponentId: 2,
  opponentName: "Bob",
  scheduledAt: null as string | null,
  roundId: 3,
  status: "scheduled",
  leagueId: 1,
  leagueName: "Test League",
  location: null,
  score: null,
  winnerId: null,
};

const mockMutate = vi.fn();

function setupMyMatchesMocks(upcomingMatches: typeof roundScheduledMatch[]) {
  vi.mocked(useGetMyMatches).mockReturnValue({
    data: {
      playerId: 1,
      playerIds: [1],
      upcoming: upcomingMatches,
      past: [],
    },
    isLoading: false,
  } as ReturnType<typeof useGetMyMatches>);

  vi.mocked(useUpdateMatch).mockReturnValue({
    mutate: mockMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateMatch>);
}

describe("MyMatches — Needs scheduling badge for round matchups", () => {
  beforeEach(() => {
    mockMutate.mockReset();
  });

  it("shows 'Needs scheduling' badge for an upcoming match with roundId and no scheduledAt", () => {
    setupMyMatchesMocks([roundScheduledMatch]);
    renderWithQC(React.createElement(MyMatches));
    expect(screen.getByText(/needs scheduling/i)).toBeInTheDocument();
  });

  it("shows an 'Arrange' link to /matches/:id next to the badge", () => {
    setupMyMatchesMocks([roundScheduledMatch]);
    renderWithQC(React.createElement(MyMatches));
    const arrangeLink = screen.getByRole("link", { name: /arrange/i });
    expect(arrangeLink).toHaveAttribute(
      "href",
      `/matches/${roundScheduledMatch.matchId}`,
    );
  });

  it("does not show 'Needs scheduling' badge when the match has a scheduledAt date", () => {
    setupMyMatchesMocks([
      { ...roundScheduledMatch, scheduledAt: "2026-06-20T09:00:00Z" },
    ]);
    renderWithQC(React.createElement(MyMatches));
    expect(screen.queryByText(/needs scheduling/i)).not.toBeInTheDocument();
  });

  it("does not show 'Needs scheduling' badge when the match has no roundId", () => {
    setupMyMatchesMocks([
      { ...roundScheduledMatch, roundId: null as any },
    ]);
    renderWithQC(React.createElement(MyMatches));
    expect(screen.queryByText(/needs scheduling/i)).not.toBeInTheDocument();
  });
});

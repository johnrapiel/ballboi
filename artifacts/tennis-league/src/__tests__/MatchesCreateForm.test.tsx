import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("wouter", () => ({
  useSearch: () => "",
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

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      initial: _i,
      animate: _a,
      exit: _e,
      transition: _t,
      ...props
    }: {
      children?: React.ReactNode;
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
      [key: string]: unknown;
    }) => React.createElement("div", props, children),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const mockCreateMutate = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useGetMatches: vi.fn().mockReturnValue({ data: [], isLoading: false }),
  useCreateMatch: vi.fn(),
  useUpdateMatch: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useDeleteMatch: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  getGetMatchesQueryKey: vi.fn().mockReturnValue(["matches"]),
  useGetPlayers: vi.fn(),
  useGetLeagues: vi.fn(),
}));

import {
  useCreateMatch,
  useGetPlayers,
  useGetLeagues,
} from "@workspace/api-client-react";

import Matches from "@/pages/Matches";

const PLAYER_ALICE = { id: 10, name: "Alice", wins: 0, losses: 0 };
const PLAYER_BOB = { id: 20, name: "Bob", wins: 0, losses: 0 };
const LEAGUE = { id: 1, name: "Test League" };

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function renderPage() {
  const qc = makeQueryClient();
  return {
    qc,
    ...render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(Matches),
      ),
    ),
  };
}

async function openDialogAndFillPlayers() {
  const user = userEvent.setup();
  renderPage();

  await user.click(screen.getByTestId("schedule-match-btn"));

  // Select Player 1
  await user.click(screen.getByTestId("select-player1"));
  await user.click(screen.getByRole("option", { name: "Alice" }));

  // Select Player 2
  await user.click(screen.getByTestId("select-player2"));
  await user.click(screen.getByRole("option", { name: "Bob" }));

  return user;
}

beforeEach(() => {
  vi.mocked(useGetPlayers).mockReturnValue({
    data: [PLAYER_ALICE as any, PLAYER_BOB as any],
    isLoading: false,
  } as ReturnType<typeof useGetPlayers>);

  vi.mocked(useGetLeagues).mockReturnValue({
    data: [LEAGUE as any],
    isLoading: false,
  } as ReturnType<typeof useGetLeagues>);

  vi.mocked(useCreateMatch).mockReturnValue({
    mutate: mockCreateMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateMatch>);

  mockCreateMutate.mockReset();
});

describe("Matches — Schedule Match dialog opens", () => {
  it("opens the Schedule Match dialog when the button is clicked", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId("schedule-match-btn"));
    // The dialog title is rendered as an h2 inside a DialogTitle
    expect(screen.getByRole("heading", { name: "Schedule Match" })).toBeInTheDocument();
  });

  it("closes the dialog on Cancel", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId("schedule-match-btn"));
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    await waitFor(() => {
      expect(screen.queryByTestId("submit-match")).not.toBeInTheDocument();
    });
  });
});

describe("Matches — create form score validation", () => {
  it("shows an error and does not call mutate for a malformed score", async () => {
    const user = await openDialogAndFillPlayers();

    await user.type(screen.getByTestId("create-input-score"), "bad-score");
    await user.click(screen.getByTestId("submit-match"));

    expect(mockCreateMutate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId("create-score-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("create-score-error")).toHaveTextContent(
      /isn't a valid set score/i,
    );
  });

  it("shows an error for tied sets without a tiebreak", async () => {
    const user = await openDialogAndFillPlayers();

    await user.type(screen.getByTestId("create-input-score"), "6-3, 3-6");

    // Select winner (Alice)
    await user.click(screen.getByTestId("create-select-winner"));
    await user.click(screen.getByRole("option", { name: "Alice" }));

    await user.click(screen.getByTestId("submit-match"));

    expect(mockCreateMutate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId("create-score-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("create-score-error")).toHaveTextContent(/tied/i);
  });

  it("shows an error when the score implies a different winner than selected", async () => {
    const user = await openDialogAndFillPlayers();

    // Score implies Alice (player1) wins, but we select Bob as winner
    await user.type(screen.getByTestId("create-input-score"), "6-3, 6-2");

    await user.click(screen.getByTestId("create-select-winner"));
    await user.click(screen.getByRole("option", { name: "Bob" }));

    await user.click(screen.getByTestId("submit-match"));

    expect(mockCreateMutate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId("create-score-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("create-score-error")).toHaveTextContent(
      /score shows/i,
    );
  });

  it("clears the score error when the score input changes", async () => {
    const user = await openDialogAndFillPlayers();

    await user.type(screen.getByTestId("create-input-score"), "bad-score");
    await user.click(screen.getByTestId("submit-match"));

    await waitFor(() => {
      expect(screen.getByTestId("create-score-error")).toBeInTheDocument();
    });

    // Changing the score clears the error
    await user.clear(screen.getByTestId("create-input-score"));
    await waitFor(() => {
      expect(screen.queryByTestId("create-score-error")).not.toBeInTheDocument();
    });
  });

  it("calls mutate when a valid score and matching winner are provided", async () => {
    mockCreateMutate.mockImplementation(
      (_payload: unknown, callbacks: { onSuccess?: () => void }) => {
        callbacks?.onSuccess?.();
      },
    );

    const user = await openDialogAndFillPlayers();

    // Alice (player1) wins both sets
    await user.type(screen.getByTestId("create-input-score"), "6-3, 6-2");

    await user.click(screen.getByTestId("create-select-winner"));
    await user.click(screen.getByRole("option", { name: "Alice" }));

    await user.click(screen.getByTestId("submit-match"));

    await waitFor(() => {
      expect(mockCreateMutate).toHaveBeenCalledOnce();
    });

    const [payload] = mockCreateMutate.mock.calls[0] as [
      { data: { score: string; winnerId: number; player1Id: number; player2Id: number } },
      unknown,
    ];
    expect(payload.data.score).toBe("6-3, 6-2");
    expect(payload.data.winnerId).toBe(PLAYER_ALICE.id);
    expect(payload.data.player1Id).toBe(PLAYER_ALICE.id);
    expect(payload.data.player2Id).toBe(PLAYER_BOB.id);
  });

  it("calls mutate when no score is entered (schedule without result)", async () => {
    mockCreateMutate.mockImplementation(
      (_payload: unknown, callbacks: { onSuccess?: () => void }) => {
        callbacks?.onSuccess?.();
      },
    );

    const user = await openDialogAndFillPlayers();

    // No score entered — just scheduling
    await user.click(screen.getByTestId("submit-match"));

    await waitFor(() => {
      expect(mockCreateMutate).toHaveBeenCalledOnce();
    });

    expect(screen.queryByTestId("create-score-error")).not.toBeInTheDocument();
  });
});

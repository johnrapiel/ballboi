import { useGetMyMatches, useUpdateMatch, getGetMyMatchesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useMemo, useState } from "react";
import { validateTennisScore, formatDisplayScore } from "@/lib/tennisScore";
import {
  CalendarDays,
  Trophy,
  Clock,
  ChevronLeft,
  ClipboardEdit,
  Video,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { MyMatchItem } from "@workspace/api-client-react";

type WinnerSide = "me" | "opponent";

function getMyTeamAnchorId(match: MyMatchItem) {
  return match.opponentId === match.player2Id ? match.player1Id : match.player2Id;
}

function getResultForMe(match: MyMatchItem) {
  if (match.status !== "completed" || match.winnerId == null) return null;
  if (match.winnerId === match.playerId || match.winnerId === getMyTeamAnchorId(match)) return "win";
  return "loss";
}

function formatCurrentStreak(streak: { result: "win" | "loss"; count: number } | null) {
  if (!streak) return "—";
  return `${streak.result === "win" ? "W" : "L"}${streak.count}`;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "Time TBD";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}


interface MatchRowProps {
  match: MyMatchItem;
  emphasizeUnlogged: boolean;
  isLogging: boolean;
  winnerSide: WinnerSide | null;
  score: string;
  scoreError: string | null;
  isSaving: boolean;
  isLogActionDisabled: boolean;
  onStartLog: (match: MyMatchItem) => void;
  onCancelLog: () => void;
  onWinnerSideChange: (side: WinnerSide) => void;
  onScoreChange: (score: string) => void;
  onSubmitResult: (match: MyMatchItem) => void;
}

interface MatchSummaryCardProps {
  label: string;
  value: string | number;
  detail?: string;
}

function MatchSummaryCard({ label, value, detail }: MatchSummaryCardProps) {
  return (
    <div className="rounded-lg border border-card-border bg-card px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight text-foreground">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function MatchRow({
  match,
  emphasizeUnlogged,
  isLogging,
  winnerSide,
  score,
  scoreError,
  isSaving,
  isLogActionDisabled,
  onStartLog,
  onCancelLog,
  onWinnerSideChange,
  onScoreChange,
  onSubmitResult,
}: MatchRowProps) {
  const ballBoi = match as MyMatchItem & { hasBallBoiReplay?: boolean; ballBoiProcessingStatus?: string | null; ballBoiShotCount?: number | null; ballBoiAvgShotSpeedMph?: number | null };

  const resultForMe = getResultForMe(match);
  const isWon = resultForMe === "win";
  const isLost = resultForMe === "loss";
  const isCompleted = match.status === "completed";
  const isCancelled = match.status === "cancelled";
  const canLogResult = !isCompleted && !isCancelled;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "px-5 py-4 transition-colors",
        canLogResult && emphasizeUnlogged ? "bg-primary/[0.03] hover:bg-primary/[0.06]" : "hover:bg-accent/30",
        isLogging && "bg-primary/[0.07]"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0 space-y-1.5">
          {isCompleted && isWon && (
            <div>
              <span className="text-xs font-semibold border border-primary/40 text-primary px-2 py-0.5 rounded-full">
                Won
              </span>
            </div>
          )}
          {isCompleted && isLost && (
            <div>
              <span className="text-xs font-semibold border border-border text-muted-foreground px-2 py-0.5 rounded-full">
                Lost
              </span>
            </div>
          )}

          <div>
            <span className="text-sm font-semibold text-foreground">You</span>
            <span className="text-xs font-bold text-muted-foreground mx-1.5">vs</span>
            <Link
              href={`/players/${match.opponentId}`}
              className="text-sm font-semibold text-foreground hover:text-primary transition-colors"
            >
              {match.opponentName}
            </Link>
          </div>

          {match.scheduledAt && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays className="w-3 h-3" />
              {formatDate(match.scheduledAt)}
            </div>
          )}
          {!match.scheduledAt && match.roundId != null && !isCompleted && !isCancelled && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold border border-warning/40 text-warning px-2 py-0.5 rounded uppercase tracking-wider">
                Needs scheduling
              </span>
              <Link
                href={`/matches/${match.matchId}`}
                className="text-[11px] text-primary hover:underline font-semibold"
              >
                Arrange
              </Link>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            {match.leagueName && (
              <span className="text-xs text-muted-foreground">{match.leagueName}</span>
            )}
            {match.roundNumber != null && (match as any).playoffRound == null && (
              <span className="text-[11px] font-semibold border border-border text-muted-foreground px-1.5 py-0.5 rounded uppercase tracking-wider">
                Round {match.roundNumber}
              </span>
            )}
            {(match as any).playoffRound != null && (
              <span className="text-[11px] font-semibold border border-primary/40 text-primary/80 px-1.5 py-0.5 rounded uppercase tracking-wider">
                {(match as any).playoffRound === "quarterfinal"
                  ? "Playoff — QF"
                  : (match as any).playoffRound === "semifinal"
                  ? "Playoff — SF"
                  : "Playoff — Final"}
              </span>
            )}
          </div>

          {(match as any).season && (
            <div>
              <span className={cn(
                "text-[11px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider border",
                (match as any).season === "Summer League"
                  ? "border-primary/40 text-primary/80"
                  : "border-border text-muted-foreground"
              )}>
                {(match as any).season}
              </span>
            </div>
          )}

          {match.location && (
            <div className="text-xs text-muted-foreground/70">{match.location}</div>
          )}

          {isCompleted && match.score && (
            <div className="text-sm font-semibold text-foreground font-mono tracking-tight">{formatDisplayScore(match.score)}</div>
          )}

          {isCompleted && ballBoi.hasBallBoiReplay && (
            <div>
              {ballBoi.ballBoiProcessingStatus === "completed" ? (
                <Link
                  href={`/matches/${match.matchId}/replay`}
                  className="text-xs text-primary hover:underline"
                >
                  → View Ball Boi Recording
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Video className="w-3 h-3" />
                  Processing...
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          {canLogResult && emphasizeUnlogged && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground border border-white/20 px-2 py-0.5 rounded-full">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              Needs result
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <Link
              href={`/matches/${match.matchId}`}
              className="text-xs text-primary hover:underline"
            >
              View
            </Link>
            {!isCompleted && !isCancelled && (
              <Button
                size="sm"
                variant={isLogging ? "secondary" : "outline"}
                className="h-10 text-xs px-3 gap-1.5"
                onClick={() => (isLogging ? onCancelLog() : onStartLog(match))}
                disabled={isLogActionDisabled}
              >
                <ClipboardEdit className="w-3.5 h-3.5" />
                {isLogging ? "Editing" : "Log"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {canLogResult && isLogging && (
        <div className="mt-4 rounded-lg border border-primary/20 bg-background/70 p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Log result</p>
              <p className="text-xs text-muted-foreground mt-0.5">Choose the winner and add the set scores.</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onCancelLog}
              aria-label="Cancel logging result"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.8fr)_auto] md:items-end">
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Who won?</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-pressed={winnerSide === "me"}
                  onClick={() => onWinnerSideChange("me")}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold transition-colors",
                    winnerSide === "me"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/40 text-foreground"
                  )}
                >
                  <Trophy className={cn("h-3.5 w-3.5", winnerSide === "me" ? "text-primary" : "text-muted-foreground")} />
                  You
                </button>
                <button
                  type="button"
                  aria-pressed={winnerSide === "opponent"}
                  onClick={() => onWinnerSideChange("opponent")}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold transition-colors",
                    winnerSide === "opponent"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/40 text-foreground"
                  )}
                >
                  <Trophy className={cn("h-3.5 w-3.5", winnerSide === "opponent" ? "text-primary" : "text-muted-foreground")} />
                  <span className="truncate">{match.opponentName}</span>
                </button>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Score</p>
              <Input
                placeholder="6-4, 3-6, 7-5"
                value={score}
                onChange={(e) => onScoreChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && winnerSide !== null && !isSaving) {
                    onSubmitResult(match);
                  }
                }}
                className={scoreError ? "border-destructive focus-visible:ring-destructive" : ""}
              />
              {scoreError ? (
                <p className="text-[11px] text-destructive mt-1">{scoreError}</p>
              ) : (
                <p className="text-[11px] text-muted-foreground mt-1">Optional, comma-separated sets</p>
              )}
            </div>

            <div className="flex items-center gap-2 md:justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCancelLog}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => onSubmitResult(match)}
                disabled={winnerSide === null || isSaving}
              >
                {isSaving ? "Saving..." : "Save Result"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default function MyMatches() {
  const { data, isLoading } = useGetMyMatches();
  const updateMatch = useUpdateMatch();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [logTargetId, setLogTargetId] = useState<number | null>(null);
  const [winnerSide, setWinnerSide] = useState<WinnerSide | null>(null);
  const [score, setScore] = useState("");
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [expandedArchivedSeasons, setExpandedArchivedSeasons] = useState<Set<string>>(new Set());
  const toggleArchivedSeason = (season: string) => {
    setExpandedArchivedSeasons((prev) => {
      const next = new Set(prev);
      if (next.has(season)) next.delete(season);
      else next.add(season);
      return next;
    });
  };

  function startLogging(match: MyMatchItem) {
    setLogTargetId(match.matchId);
    setWinnerSide(null);
    setScore("");
    setScoreError(null);
  }

  function cancelLogging() {
    setLogTargetId(null);
    setWinnerSide(null);
    setScore("");
    setScoreError(null);
  }

  function handleWinnerSideChange(side: WinnerSide) {
    setWinnerSide(side);
    setScoreError(null);
  }

  function handleScoreChange(value: string) {
    setScore(value);
    setScoreError(null);
  }

  function handleLogSubmit(match: MyMatchItem) {
    if (winnerSide === null || !match.playerId) return;

    const validation = validateTennisScore(score, winnerSide);
    if (!validation.valid) {
      setScoreError(validation.error ?? "Invalid score.");
      return;
    }

    const myTeamAnchorId =
      match.opponentId === match.player2Id
        ? match.player1Id
        : match.player2Id;
    const winnerId = winnerSide === "me" ? myTeamAnchorId : match.opponentId;
    updateMatch.mutate(
      {
        matchId: match.matchId,
        data: {
          status: "completed",
          winnerId,
          score: score.trim() || undefined,
          completedAt: new Date().toISOString(),
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetMyMatchesQueryKey() });
          toast({ title: "Result logged!", description: "Match result recorded." });
          cancelLogging();
        },
        onError: (err: unknown) => {
          const status = (err as { status?: number })?.status;
          if (status === 409) {
            toast({
              title: "Result already recorded",
              description: "This match result has already been logged. Refresh the page to see the latest status.",
              variant: "destructive",
            });
          } else {
            toast({ title: "Error", description: "Failed to log result.", variant: "destructive" });
          }
        },
      }
    );
  }

  const upcoming = data?.upcoming ?? [];
  const past = data?.past ?? [];
  const matchSummary = useMemo(() => {
    const completedMatches = past.filter((match) => getResultForMe(match) !== null);
    const wins = completedMatches.filter((match) => getResultForMe(match) === "win").length;
    const losses = completedMatches.length - wins;
    const winRate = completedMatches.length > 0 ? Math.round((wins / completedMatches.length) * 100) : 0;
    const latestResult = completedMatches.length > 0 ? getResultForMe(completedMatches[0]) : null;
    let streakCount = 0;

    if (latestResult) {
      for (const match of completedMatches) {
        if (getResultForMe(match) !== latestResult) break;
        streakCount++;
      }
    }

    return {
      totalMatches: completedMatches.length,
      wins,
      losses,
      winRate,
      currentStreak: latestResult ? { result: latestResult as "win" | "loss", count: streakCount } : null,
    };
  }, [past]);

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/leagues" className="text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="page-heading text-foreground">My Matches</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Your complete match history</p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-card border border-card-border rounded-lg p-5 animate-pulse">
                <div className="h-4 w-48 bg-muted rounded mb-2" />
                <div className="h-3 w-32 bg-muted rounded" />
              </div>
            ))}
          </div>
        ) : !data?.playerId ? (
          <div className="bg-card border border-card-border rounded-lg p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Your account isn't linked to a player profile yet. Link your profile to see your matches.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <MatchSummaryCard
                label="Completed Matches"
                value={matchSummary.totalMatches}
                detail="Completed results"
              />
              <MatchSummaryCard
                label="W-L Record"
                value={`${matchSummary.wins}-${matchSummary.losses}`}
                detail={`${matchSummary.wins} wins, ${matchSummary.losses} losses`}
              />
              <MatchSummaryCard
                label="Win %"
                value={`${matchSummary.winRate}%`}
                detail={matchSummary.totalMatches > 0 ? "Based on completed matches" : "No results yet"}
              />
              <MatchSummaryCard
                label="Current Streak"
                value={formatCurrentStreak(matchSummary.currentStreak)}
                detail={matchSummary.currentStreak ? (matchSummary.currentStreak.result === "win" ? "Winning streak" : "Losing streak") : "No results yet"}
              />
            </div>

            {/* Upcoming */}
            <div className="bg-card border border-card-border rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-primary/5">
                <CalendarDays className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                  Upcoming
                </h2>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {upcoming.length} {upcoming.length === 1 ? "match" : "matches"}
                </span>
              </div>
              {upcoming.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm text-muted-foreground">No upcoming matches scheduled.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {upcoming.map((match) => (
                    <MatchRow
                      key={match.matchId}
                      match={match}
                      emphasizeUnlogged
                      isLogging={logTargetId === match.matchId}
                      winnerSide={logTargetId === match.matchId ? winnerSide : null}
                      score={logTargetId === match.matchId ? score : ""}
                      scoreError={logTargetId === match.matchId ? scoreError : null}
                      isSaving={logTargetId === match.matchId && updateMatch.isPending}
                      isLogActionDisabled={updateMatch.isPending}
                      onStartLog={startLogging}
                      onCancelLog={cancelLogging}
                      onWinnerSideChange={handleWinnerSideChange}
                      onScoreChange={handleScoreChange}
                      onSubmitResult={handleLogSubmit}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Past */}
            {(() => {
              // Seasons that appear in upcoming matches are still active
              const activeSeasonNames = new Set(
                upcoming.map((m) => m.season).filter((s): s is string => !!s)
              );
              // Current past: untagged OR tagged with a season still active (has upcoming matches)
              const currentPast = past.filter(
                (m) => !m.season || activeSeasonNames.has(m.season)
              );
              // Archived past: tagged with a season that has no upcoming matches
              const archivedBySeason = past
                .filter((m) => !!m.season && !activeSeasonNames.has(m.season))
                .reduce<Record<string, typeof past>>((acc, m) => {
                  const s = m.season!;
                  if (!acc[s]) acc[s] = [];
                  acc[s].push(m);
                  return acc;
                }, {});
              const archivedSeasonNames = Object.keys(archivedBySeason);

              const renderMatchRow = (match: MyMatchItem) => (
                <MatchRow
                  key={match.matchId}
                  match={match}
                  emphasizeUnlogged={false}
                  isLogging={logTargetId === match.matchId}
                  winnerSide={logTargetId === match.matchId ? winnerSide : null}
                  score={logTargetId === match.matchId ? score : ""}
                  scoreError={logTargetId === match.matchId ? scoreError : null}
                  isSaving={logTargetId === match.matchId && updateMatch.isPending}
                  isLogActionDisabled={updateMatch.isPending}
                  onStartLog={startLogging}
                  onCancelLog={cancelLogging}
                  onWinnerSideChange={handleWinnerSideChange}
                  onScoreChange={handleScoreChange}
                  onSubmitResult={handleLogSubmit}
                />
              );

              return (
                <>
                  <div className="bg-card border border-card-border rounded-lg overflow-hidden">
                    <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                        Past
                      </h2>
                      <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                        {currentPast.length} {currentPast.length === 1 ? "match" : "matches"}
                      </span>
                    </div>
                    {currentPast.length === 0 ? (
                      <div className="px-5 py-8 text-center">
                        <p className="text-sm text-muted-foreground">
                          {archivedSeasonNames.length > 0
                            ? "No current-season matches yet. See archived seasons below."
                            : "No completed matches yet."}
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-border">
                        {currentPast.map(renderMatchRow)}
                      </div>
                    )}
                  </div>

                  {archivedSeasonNames.map((seasonName) => {
                    const seasonMatches = archivedBySeason[seasonName];
                    const isExpanded = expandedArchivedSeasons.has(seasonName);
                    return (
                      <div key={seasonName} className="bg-card border border-card-border rounded-lg overflow-hidden">
                        <button
                          onClick={() => toggleArchivedSeason(seasonName)}
                          className="w-full text-left hover:bg-accent/20 transition-colors"
                        >
                          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border">
                            <Clock className="w-4 h-4 text-muted-foreground" />
                            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                              {seasonName}
                            </h2>
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border border-border text-muted-foreground uppercase tracking-wider">
                              archived
                            </span>
                            <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                              {seasonMatches.length} {seasonMatches.length === 1 ? "match" : "matches"}
                              {isExpanded ? (
                                <ChevronUp className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                              )}
                            </span>
                          </div>
                        </button>
                        {isExpanded && (
                          <div className="divide-y divide-border">
                            {seasonMatches.map(renderMatchRow)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        )}
      </div>

    </>
  );
}

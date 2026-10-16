import { useGetMySchedule, useUpdateMatch, getGetMyScheduleQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useState } from "react";
import { validateTennisScore, formatDisplayScore } from "@/lib/tennisScore";
import {
  CalendarDays,
  MapPin,
  ExternalLink,
  User,
  Trophy,
  ClipboardEdit,
  CheckCircle2,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

function formatDate(iso: string | null | undefined) {
  if (!iso) return "Time TBD";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MyScheduleCard() {
  const { data, isLoading } = useGetMySchedule();
  const updateMatch = useUpdateMatch();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [logOpen, setLogOpen] = useState(false);
  const [winnerSide, setWinnerSide] = useState<"me" | "opponent" | null>(null);
  const [score, setScore] = useState("");
  const [scoreError, setScoreError] = useState<string | null>(null);

  const match = data?.match;

  // For doubles: team anchor is player1Id if I'm on team1 (opponent = player2), else player2Id.
  const myTeamAnchorId = match
    ? match.opponentId === match.player2Id
      ? match.player1Id
      : match.player2Id
    : null;
  const didMySideWin =
    match?.winnerId != null &&
    (match.winnerId === match.playerId || match.winnerId === myTeamAnchorId);

  function handleLogSubmit() {
    if (!match || winnerSide === null || !match.playerId || !myTeamAnchorId) return;

    const validation = validateTennisScore(score, winnerSide);
    if (!validation.valid) {
      setScoreError(validation.error ?? "Invalid score.");
      return;
    }

    // For doubles, backend expects team-anchor IDs (player1Id or player2Id) as winnerId.
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
          qc.invalidateQueries({ queryKey: getGetMyScheduleQueryKey() });
          toast({ title: "Result logged!", description: "Your match result has been recorded." });
          setLogOpen(false);
          setWinnerSide(null);
          setScore("");
          setScoreError(null);
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

  if (isLoading) {
    return (
      <div className="bg-card border border-card-border rounded-lg p-5 animate-pulse">
        <div className="h-4 w-32 bg-muted rounded mb-3" />
        <div className="h-8 w-64 bg-muted rounded mb-2" />
        <div className="h-4 w-48 bg-muted rounded" />
      </div>
    );
  }

  if (!data?.playerId) {
    return null;
  }

  if (!match) {
    return (
      <div className="bg-card border border-card-border rounded-lg px-5 py-6 flex items-center gap-3">
        <div className="p-2 rounded-md bg-primary/10">
          <CalendarDays className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">My Schedule</p>
          <p className="text-xs text-muted-foreground mt-0.5">No upcoming matches scheduled for you this week.</p>
        </div>
        <Link href="/my-matches" className="text-xs text-primary hover:underline shrink-0 flex items-center gap-1">
          Full history <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
    );
  }

  const isCompleted = match.status === "completed";

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card border border-card-border rounded-lg overflow-hidden"
      >
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-primary/5">
          <CalendarDays className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">My Schedule</h2>
          {isCompleted ? (
            <span className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full uppercase tracking-wider">
              <CheckCircle2 className="w-3 h-3" /> Completed
            </span>
          ) : (
            <Link href="/my-matches" className="ml-auto text-xs text-primary hover:underline flex items-center gap-1">
              All matches <ExternalLink className="w-3 h-3" />
            </Link>
          )}
        </div>

        <div className="p-5 space-y-4">
          {/* Matchup */}
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <div className="p-1.5 rounded-full bg-info/10">
                    <User className="w-3.5 h-3.5 text-info" />
                  </div>
                  <span className="text-base font-bold text-foreground">You</span>
                </div>
                <span className="text-xs font-bold text-muted-foreground uppercase">vs</span>
                <div className="flex items-center gap-1.5">
                  <div className="p-1.5 rounded-full bg-orange-400/10">
                    <User className="w-3.5 h-3.5 text-orange-400" />
                  </div>
                  <Link href={`/players/${match.opponentId}`} className="text-base font-bold text-foreground hover:text-primary transition-colors">
                    {match.opponentName}
                  </Link>
                </div>
              </div>
              {match.leagueName && (
                <p className="text-xs text-muted-foreground mt-1">{match.leagueName}</p>
              )}
              {isCompleted && match.score && (
                <div className="mt-1.5 flex items-center gap-2">
                  <Trophy className="w-3.5 h-3.5 text-primary" />
                  <span className="text-sm font-semibold text-primary">{formatDisplayScore(match.score)}</span>
                  {didMySideWin && (
                    <span className="text-[11px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full uppercase tracking-wider">Won</span>
                  )}
                  {match.winnerId != null && !didMySideWin && (
                    <span className="text-[11px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full uppercase tracking-wider">Lost</span>
                  )}
                </div>
              )}
            </div>
            <Link
              href={`/matches/${match.matchId}`}
              className="shrink-0 text-xs text-primary hover:underline flex items-center gap-1"
            >
              View <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          {/* Details grid */}
          <div className="grid sm:grid-cols-2 gap-3">
            {/* Time */}
            <div className="flex items-start gap-2.5 p-3 rounded-md bg-muted/40">
              <CalendarDays className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">When</p>
                <p className="text-sm font-medium text-foreground mt-0.5">{formatDate(match.scheduledAt)}</p>
              </div>
            </div>

            {/* Location */}
            <div className="flex items-start gap-2.5 p-3 rounded-md bg-muted/40">
              <MapPin className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Where</p>
                {match.location ? (
                  <p className="text-sm font-medium text-foreground mt-0.5">{match.location}</p>
                ) : (
                  <p className="text-sm text-muted-foreground mt-0.5">Location TBD</p>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            {!isCompleted && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs h-8"
                onClick={() => setLogOpen(true)}
              >
                <ClipboardEdit className="w-3.5 h-3.5" />
                Log Result
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      {/* Log Result Dialog */}
      <Dialog open={logOpen} onOpenChange={(open) => {
        setLogOpen(open);
        if (!open) {
          setWinnerSide(null);
          setScore("");
          setScoreError(null);
        }
      }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Log Match Result</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Who won?</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => { setWinnerSide("me"); setScoreError(null); }}
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-colors text-sm font-semibold",
                    winnerSide === "me"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/40 text-foreground"
                  )}
                >
                  <Trophy className={cn("w-5 h-5", winnerSide === "me" ? "text-primary" : "text-muted-foreground")} />
                  You
                </button>
                <button
                  onClick={() => { setWinnerSide("opponent"); setScoreError(null); }}
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-colors text-sm font-semibold",
                    winnerSide === "opponent"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/40 text-foreground"
                  )}
                >
                  <Trophy className={cn("w-5 h-5", winnerSide === "opponent" ? "text-primary" : "text-muted-foreground")} />
                  {match.opponentName}
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Score (optional)</p>
              <Input
                placeholder="e.g. 6-4, 3-6, 7-5"
                value={score}
                onChange={(e) => { setScore(e.target.value); setScoreError(null); }}
                className={scoreError ? "border-destructive focus-visible:ring-destructive" : ""}
              />
              {scoreError ? (
                <p className="text-[11px] text-destructive mt-1">{scoreError}</p>
              ) : (
                <p className="text-[11px] text-muted-foreground mt-1">Comma-separated sets</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleLogSubmit}
              disabled={winnerSide === null || updateMatch.isPending}
            >
              {updateMatch.isPending ? "Saving..." : "Save Result"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

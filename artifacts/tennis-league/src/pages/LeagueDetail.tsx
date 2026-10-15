import { useState } from "react";
import { useGetLeague, useGetLeagueStandings, useGetMatches, useGetLeagueInvites, useCreateLeagueInvite, useCreateMatch, useGetPlayers, getGetMatchesQueryKey, useGetCurrentLeagueRound, useGenerateLeagueRound, useResetLeagueRecords, ResetLeagueRecords200, useGetLeaguePlayoffs, useGenerateLeaguePlayoffs, useGetLeagueRounds, useGetLeagueSeasons, useGetActiveLeagueSeason, useCreateLeagueSeason, useUpdateSeason, useDeleteSeason, Season } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser, useAuth } from "@clerk/react";
import { ArrowLeft, Trophy, Swords, Link2, QrCode, Copy, Plus, ChevronDown, ChevronUp, Lightbulb, RefreshCw, TriangleAlert, Crown, CalendarRange, Pencil, Trash2, X } from "lucide-react";
import PlayoffBracket from "@/components/PlayoffBracket";
import { apiFetch } from "@/lib/scheduleApi";
import { formatDisplayScore } from "@/lib/tennisScore";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { QRCodeSVG as QRCode } from "qrcode.react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useIsAdmin } from "@/hooks/useIsAdmin";

const scheduleSchema = z.object({
  player1Id: z.string().min(1, "Required"),
  player2Id: z.string().min(1, "Required"),
  player3Id: z.string().optional(),
  player4Id: z.string().optional(),
  scheduledDate: z.string().optional(),
  scheduledTime: z.string().optional(),
});

const HOUR_OPTIONS = ["1","2","3","4","5","6","7","8","9","10","11","12"];
const MINUTE_OPTIONS = ["00","15","30","45"];

function toTime24(hour: string, minute: string, period: "AM" | "PM"): string {
  let h = parseInt(hour, 10);
  if (period === "AM") { if (h === 12) h = 0; }
  else { if (h !== 12) h += 12; }
  return `${String(h).padStart(2, "0")}:${minute}`;
}

function statusBadge(status: string) {
  if (status === "completed") return "border border-white/20 text-muted-foreground";
  if (status === "scheduled") return "border border-border text-muted-foreground";
  return "border border-border text-muted-foreground";
}

type Suggestion = { player1Id: number; player1Name: string; player2Id: number; player2Name: string; daysSincePlayed: number | null };

const FEATURE_SUGGESTED_MATCHUPS = false;

export default function LeagueDetail() {
  const params = useParams<{ id: string }>();
  const leagueId = parseInt(params.id ?? "");
  const { user } = useUser();
  const { getToken } = useAuth();
  const { data: league, isLoading: leagueLoading } = useGetLeague(leagueId, { query: { enabled: !!leagueId, queryKey: ["league", leagueId] as any } });
  const { data: standings, isLoading: standingsLoading } = useGetLeagueStandings(leagueId, {}, { query: { enabled: !!leagueId, queryKey: ["standings", leagueId] as any } });
  const { data: matches, isLoading: matchesLoading } = useGetMatches({ leagueId }, { query: { enabled: !!leagueId, queryKey: ["matches", { leagueId }] as any } });
  const { data: players } = useGetPlayers();
  const leaguePlayers = players?.filter((p) => p.leagueId === leagueId) ?? [];
  const canManageInvites = !!league && league.createdByClerkUserId === user?.id;
  const { data: invites } = useGetLeagueInvites(leagueId, {
    query: { enabled: !!leagueId && canManageInvites, queryKey: ["invites", leagueId] as any },
  });
  const activeInvite = invites?.[0];
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedHour, setSchedHour] = useState("");
  const [schedMinute, setSchedMinute] = useState("00");
  const [schedPeriod, setSchedPeriod] = useState<"AM" | "PM">("AM");
  const [showInvite, setShowInvite] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const qc = useQueryClient();
  const { toast } = useToast();
  const createMatch = useCreateMatch();
  const createInvite = useCreateLeagueInvite();

  const { data: suggestions, isLoading: suggestionsLoading } = useQuery<Suggestion[]>({
    queryKey: ["suggestions", leagueId],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch(`/scheduling/${leagueId}/suggestions`, token);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!leagueId && canManageInvites,
    staleTime: 30_000,
  });

  const { data: currentRound, isLoading: roundLoading } = useGetCurrentLeagueRound(leagueId, {
    query: { enabled: !!leagueId, queryKey: ["currentRound", leagueId] as any, retry: false },
  });
  const generateRoundMutation = useGenerateLeagueRound();
  const [generatingRound, setGeneratingRound] = useState(false);
  const [confirmForceRound, setConfirmForceRound] = useState(false);

  const { data: allRounds } = useGetLeagueRounds(leagueId, {
    query: { enabled: !!leagueId, queryKey: ["allRounds", leagueId] as any },
  });
  const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null);
  const [expandedRoundIds, setExpandedRoundIds] = useState<Set<number>>(new Set());
  const [expandedArchivedSeasons, setExpandedArchivedSeasons] = useState<Set<string>>(new Set());
  const toggleArchivedSeason = (season: string) => {
    setExpandedArchivedSeasons((prev) => {
      const next = new Set(prev);
      if (next.has(season)) next.delete(season);
      else next.add(season);
      return next;
    });
  };
  const toggleRound = (roundId: number) => {
    setExpandedRoundIds((prev) => {
      const next = new Set(prev);
      if (next.has(roundId)) next.delete(roundId);
      else next.add(roundId);
      return next;
    });
  };

  const isAdmin = useIsAdmin();
  const resetMutation = useResetLeagueRecords();
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  // Season management
  const { data: seasons, isLoading: seasonsLoading } = useGetLeagueSeasons(leagueId, {
    query: { enabled: !!leagueId && isAdmin, queryKey: ["seasons", leagueId] as any },
  });
  const { data: activeSeason } = useGetActiveLeagueSeason(leagueId, {
    query: { enabled: !!leagueId, queryKey: ["activeSeason", leagueId] as any },
  });
  const createSeasonMutation = useCreateLeagueSeason();
  const updateSeasonMutation = useUpdateSeason();
  const deleteSeasonMutation = useDeleteSeason();
  const [seasonFormOpen, setSeasonFormOpen] = useState(false);
  const [editingSeason, setEditingSeason] = useState<Season | null>(null);
  const [seasonName, setSeasonName] = useState("");
  const [seasonStart, setSeasonStart] = useState("");
  const [seasonEnd, setSeasonEnd] = useState("");
  const [seasonFormError, setSeasonFormError] = useState("");

  const { data: playoff, isLoading: playoffLoading } = useGetLeaguePlayoffs(leagueId, {
    query: { enabled: !!leagueId, queryKey: ["playoff", leagueId] as any },
  });
  const generatePlayoffMutation = useGenerateLeaguePlayoffs();

  const today = new Date().toISOString().slice(0, 10);
  const roundIsStillActive = !!currentRound && currentRound.endDate >= today;

  const handleGenerateRound = (force = false) => {
    setConfirmForceRound(false);
    setGeneratingRound(true);
    generateRoundMutation.mutate(
      { leagueId, data: { force } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["currentRound", leagueId] });
          qc.invalidateQueries({ queryKey: ["allRounds", leagueId] });
          qc.invalidateQueries({ queryKey: ["matches", { leagueId }] });
          const existing = allRounds?.length ?? 0;
          const toGenerate = Math.max(0, 6 - existing);
          toast({ title: force ? "Rounds regenerated." : toGenerate > 0 ? `${toGenerate} round${toGenerate === 1 ? "" : "s"} generated` : "All rounds generated" });
          setGeneratingRound(false);
        },
        onError: () => {
          toast({ title: "Failed to generate rounds", variant: "destructive" });
          setGeneratingRound(false);
        },
      }
    );
  };

  // Find the current user's player profile in this league
  const myLeaguePlayer = leaguePlayers.find((p) => (p as any).clerkUserId === user?.id);

  // Determine which round to display in the main panel
  // Priority: selectedRoundId → active round → first upcoming → currentRound fallback
  const displayRound = (() => {
    if (allRounds && allRounds.length > 0) {
      if (selectedRoundId !== null) {
        const found = allRounds.find((r) => r.roundId === selectedRoundId);
        if (found) return found;
      }
      const active = allRounds.find((r) => r.status === "active");
      if (active) return active;
      const upcoming = allRounds.find((r) => r.status === "upcoming");
      if (upcoming) return upcoming;
      return allRounds[allRounds.length - 1];
    }
    return currentRound ?? null;
  })();

  const displayRoundIsActive = !!displayRound && displayRound.status === "active" && displayRound.endDate >= today;
  const myRoundMatchup = displayRound?.matchups.find(
    (m) => m.player1Id === myLeaguePlayer?.id || m.player2Id === myLeaguePlayer?.id
  );
  const baseUrl = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "");
  const inviteUrl = activeInvite ? `${baseUrl}/join/${activeInvite.code}` : null;

  const handleInviteClick = () => {
    if (!canManageInvites) return;
    if (showInvite) { setShowInvite(false); setShowQr(false); return; }
    if (activeInvite) { setShowInvite(true); return; }
    setCreatingInvite(true);
    createInvite.mutate({ leagueId, data: {} }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["invites", leagueId] });
        setShowInvite(true);
        setCreatingInvite(false);
      },
      onError: () => {
        toast({ title: "Failed to create invite", variant: "destructive" });
        setCreatingInvite(false);
      },
    });
  };

  const copyInviteLink = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    toast({ title: "Link copied" });
  };

  const isDoubles = league?.leagueType === "doubles";

  const scheduleForm = useForm<z.infer<typeof scheduleSchema>>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: { player1Id: "", player2Id: "", player3Id: "", player4Id: "", scheduledDate: "", scheduledTime: "" },
  });

  const submitMatchup = (player1Id: number, player2Id: number, player3Id?: number, player4Id?: number, scheduledAt?: string) => {
    createMatch.mutate(
      {
        data: {
          player1Id,
          player2Id,
          player3Id,
          player4Id,
          leagueId,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["matches", { leagueId }] });
          qc.invalidateQueries({ queryKey: getGetMatchesQueryKey() });
          qc.invalidateQueries({ queryKey: ["suggestions", leagueId] });
          toast({ title: scheduledAt ? "Matchup scheduled." : "Matchup created — players can set the date and location." });
          scheduleForm.reset();
          setSchedHour(""); setSchedMinute("00"); setSchedPeriod("AM");
          setScheduleOpen(false);
        },
        onError: () => toast({ title: "Failed to create matchup", variant: "destructive" }),
      }
    );
  };

  const openSeasonForm = (season?: Season) => {
    setEditingSeason(season ?? null);
    setSeasonName(season?.name ?? "");
    setSeasonStart(season?.startDate ?? "");
    setSeasonEnd(season?.endDate ?? "");
    setSeasonFormError("");
    setSeasonFormOpen(true);
  };

  const closeSeasonForm = () => {
    setSeasonFormOpen(false);
    setEditingSeason(null);
    setSeasonName("");
    setSeasonStart("");
    setSeasonEnd("");
    setSeasonFormError("");
  };

  const submitSeasonForm = () => {
    if (!seasonName.trim()) { setSeasonFormError("Name is required"); return; }
    if (!seasonStart || !seasonEnd) { setSeasonFormError("Start and end dates are required"); return; }
    if (seasonStart >= seasonEnd) { setSeasonFormError("Start date must be before end date"); return; }
    setSeasonFormError("");

    if (editingSeason) {
      updateSeasonMutation.mutate(
        { id: editingSeason.id, data: { name: seasonName.trim(), startDate: seasonStart, endDate: seasonEnd } },
        {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["seasons", leagueId] });
            qc.invalidateQueries({ queryKey: ["activeSeason", leagueId] });
            qc.invalidateQueries({ queryKey: ["standings", leagueId] });
            toast({ title: "Season updated" });
            closeSeasonForm();
          },
          onError: () => { setSeasonFormError("Failed to update season"); },
        }
      );
    } else {
      createSeasonMutation.mutate(
        { leagueId, data: { name: seasonName.trim(), startDate: seasonStart, endDate: seasonEnd } },
        {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["seasons", leagueId] });
            qc.invalidateQueries({ queryKey: ["activeSeason", leagueId] });
            qc.invalidateQueries({ queryKey: ["standings", leagueId] });
            toast({ title: "Season created" });
            closeSeasonForm();
          },
          onError: () => { setSeasonFormError("Failed to create season"); },
        }
      );
    }
  };

  const confirmDeleteSeason = (season: Season) => {
    if (!confirm(`Delete season "${season.name}"? This will not delete any matches.`)) return;
    deleteSeasonMutation.mutate(
      { id: season.id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["seasons", leagueId] });
          qc.invalidateQueries({ queryKey: ["activeSeason", leagueId] });
          qc.invalidateQueries({ queryKey: ["standings", leagueId] });
          toast({ title: "Season deleted" });
        },
        onError: () => toast({ title: "Failed to delete season", variant: "destructive" }),
      }
    );
  };

  const onScheduleSubmit = (data: z.infer<typeof scheduleSchema>) => {
    const scheduledAt = data.scheduledDate
      ? `${data.scheduledDate}T${data.scheduledTime || "00:00"}`
      : undefined;
    if (isDoubles) {
      if (!data.player3Id || !data.player4Id) {
        toast({ title: "All four players are required for a doubles match", variant: "destructive" });
        return;
      }
      const ids = [data.player1Id, data.player2Id, data.player3Id, data.player4Id];
      if (new Set(ids).size !== ids.length) {
        toast({ title: "All four players must be different", variant: "destructive" });
        return;
      }
      submitMatchup(parseInt(data.player1Id), parseInt(data.player2Id), parseInt(data.player3Id), parseInt(data.player4Id), scheduledAt);
    } else {
      if (data.player1Id === data.player2Id) {
        toast({ title: "Players must be different", variant: "destructive" });
        return;
      }
      submitMatchup(parseInt(data.player1Id), parseInt(data.player2Id), undefined, undefined, scheduledAt);
    }
  };

  const assignSuggestion = (s: Suggestion) => {
    submitMatchup(s.player1Id, s.player2Id);
  };

  if (leagueLoading) {
    return <div className="animate-pulse space-y-4"><div className="h-8 w-48 bg-muted rounded" /><div className="h-64 bg-card border border-card-border rounded-lg" /></div>;
  }
  if (!league) return <div className="text-muted-foreground">League not found</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/leagues" className="p-1.5 rounded hover:bg-accent text-muted-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="page-heading text-foreground">{league.name}</h1>
          </div>
          {league.description && <div className="text-sm text-muted-foreground mt-0.5">{league.description}</div>}
        </div>
        {canManageInvites && (
          <button
            onClick={handleInviteClick}
            disabled={creatingInvite}
            className={cn(
              "flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md border transition-colors shrink-0",
              showInvite
                ? "text-primary border-primary/40 bg-primary/10"
                : "text-muted-foreground border-border hover:text-foreground hover:border-border/80 hover:bg-accent"
            )}
            title="Invite players"
          >
            <Link2 className="w-3.5 h-3.5" />
            {creatingInvite ? "Creating..." : "Invite"}
          </button>
        )}
      </div>

      {/* Inline invite section */}
      {canManageInvites && showInvite && inviteUrl && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-primary/20 rounded-lg px-4 py-3 space-y-3"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground flex-1 truncate">{inviteUrl}</span>
            <button
              onClick={copyInviteLink}
              className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
              title="Copy link"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowQr(!showQr)}
              className={cn(
                "p-1.5 rounded transition-colors shrink-0",
                showQr ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
              title="Show QR code"
            >
              <QrCode className="w-3.5 h-3.5" />
            </button>
          </div>
          {showQr && (
            <div className="flex flex-col items-center gap-2 pt-1">
              <div className="p-3 bg-white rounded-lg w-fit">
                <QRCode value={inviteUrl} size={140} level="M" />
              </div>
              <span className="text-xs text-muted-foreground font-mono">{activeInvite?.code}</span>
            </div>
          )}
        </motion.div>
      )}

      {/* Standings */}
      <div className="bg-card border border-card-border rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-border space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <Trophy className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">{activeSeason?.name ?? "Standings"}</h2>
            </div>
            <span className="text-xs text-muted-foreground">1 pt/game · 3 pts/set · 6 pts/match win</span>
          </div>
        </div>
        {standingsLoading ? (
          <div className="p-5 animate-pulse space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 bg-muted rounded" />)}
          </div>
        ) : standings?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-2 sm:px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-8">#</th>
                  <th className="text-left px-2 sm:px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Player</th>
                  <th className="text-center px-2 sm:px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">W</th>
                  <th className="text-center px-2 sm:px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">L</th>
                  <th className="hidden sm:table-cell text-center px-2 sm:px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">MP</th>
                  <th className="text-center px-2 sm:px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pts</th>
                  <th className="hidden sm:table-cell text-right px-2 sm:px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Win%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {standings.map((s, idx) => (
                  <motion.tr
                    key={s.playerId}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.04 }}
                    className="hover:bg-accent/30 transition-colors"
                    data-testid={`standing-row-${s.playerId}`}
                  >
                    <td className="px-2 sm:px-4 py-3 text-xs font-bold text-foreground tabular-nums">
                      {s.rank}
                    </td>
                    <td className="px-2 sm:px-4 py-3 max-w-[140px] sm:max-w-none">
                      <Link href={`/players/${s.playerId}`} className="font-semibold text-foreground hover:text-primary transition-colors block truncate">
                        {s.playerName}
                      </Link>
                    </td>
                    <td className="px-2 sm:px-3 py-3 text-center text-primary font-bold tabular-nums">{s.wins}</td>
                    <td className="px-2 sm:px-3 py-3 text-center text-red-400 font-medium tabular-nums">{s.losses}</td>
                    <td className="hidden sm:table-cell px-2 sm:px-3 py-3 text-center text-muted-foreground tabular-nums">{s.matchesPlayed}</td>
                    <td className="px-2 sm:px-3 py-3 text-center font-bold text-foreground tabular-nums">
                      {/* Desktop: hover tooltip */}
                      <div className="relative hidden sm:inline-block group">
                        <span className="underline decoration-dotted decoration-muted-foreground/50 cursor-help">{s.points}</span>
                        <div className="pointer-events-none absolute bottom-full right-0 mb-2 z-50 hidden group-hover:block">
                          <div className="bg-popover text-popover-foreground border border-border rounded-md shadow-lg px-3 py-2 text-xs font-normal whitespace-nowrap text-left">
                            <div className="font-semibold text-foreground mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Points breakdown</div>
                            <div className="space-y-1">
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">{s.gamesWon} game{s.gamesWon !== 1 ? "s" : ""} won</span>
                                <span className="font-semibold tabular-nums">+{s.gamesWon}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">{s.setsWon} set{s.setsWon !== 1 ? "s" : ""} won × 3</span>
                                <span className="font-semibold tabular-nums">+{(s.setsWon ?? 0) * 3}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">{s.wins} win{s.wins !== 1 ? "s" : ""} × 6</span>
                                <span className="font-semibold tabular-nums">+{s.wins * 6}</span>
                              </div>
                            </div>
                            <div className="border-t border-border mt-1.5 pt-1.5 flex justify-between gap-4">
                              <span className="font-semibold text-foreground">Total</span>
                              <span className="font-bold tabular-nums text-foreground">{s.points}</span>
                            </div>
                          </div>
                          <div className="w-2 h-2 bg-popover border-r border-b border-border rotate-45 absolute right-3 -bottom-1" />
                        </div>
                      </div>
                      {/* Mobile: always-visible inline breakdown */}
                      <div className="sm:hidden flex flex-col items-center gap-0.5">
                        <span>{s.points}</span>
                        <div className="flex flex-col items-center gap-px text-[10px] font-normal text-muted-foreground leading-tight">
                          <span>{(s.setsWon ?? 0)}S·{s.gamesWon}G</span>
                        </div>
                      </div>
                    </td>
                    <td className="hidden sm:table-cell px-2 sm:px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <div className="hidden sm:block flex-1 bg-muted rounded-full h-1.5 max-w-[60px]">
                          <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${Math.round(s.winRate * 100)}%` }} />
                        </div>
                        <span className="text-xs font-bold text-primary tabular-nums">{Math.round(s.winRate * 100)}%</span>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : leaguePlayers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-2 sm:px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-8">#</th>
                  <th className="text-left px-2 sm:px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Player</th>
                  <th className="text-center px-2 sm:px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">W</th>
                  <th className="text-center px-2 sm:px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">L</th>
                  <th className="hidden sm:table-cell text-center px-2 sm:px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">MP</th>
                  <th className="text-center px-2 sm:px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pts</th>
                  <th className="hidden sm:table-cell text-right px-2 sm:px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Win%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leaguePlayers.map((p, idx) => (
                  <motion.tr
                    key={p.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.04 }}
                    className="hover:bg-accent/30 transition-colors"
                  >
                    <td className="px-2 sm:px-4 py-3 text-xs font-bold text-muted-foreground/40 tabular-nums">—</td>
                    <td className="px-2 sm:px-4 py-3 max-w-[140px] sm:max-w-none">
                      <Link href={`/players/${p.id}`} className="font-semibold text-foreground hover:text-primary transition-colors block truncate">
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-2 sm:px-3 py-3 text-center text-muted-foreground/40 tabular-nums">—</td>
                    <td className="px-2 sm:px-3 py-3 text-center text-muted-foreground/40 tabular-nums">—</td>
                    <td className="hidden sm:table-cell px-2 sm:px-3 py-3 text-center text-muted-foreground/40 tabular-nums">—</td>
                    <td className="px-2 sm:px-3 py-3 text-center text-muted-foreground/40 tabular-nums">—</td>
                    <td className="hidden sm:table-cell px-2 sm:px-4 py-3 text-right text-xs text-muted-foreground/40 tabular-nums">—</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
            <div className="px-5 py-2.5 border-t border-border text-xs text-muted-foreground/60 italic">
              Rankings will appear once matches are completed
            </div>
          </div>
        ) : (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">No players or completed matches yet</div>
        )}
      </div>


      {/* Suggested Matchups — league creator only */}
      {FEATURE_SUGGESTED_MATCHUPS && canManageInvites && !isDoubles && (
        <div className="bg-card border border-card-border rounded-lg">
          <button
            onClick={() => setSuggestionsOpen((o) => !o)}
            className="w-full px-5 py-4 flex items-center justify-between text-left border-b border-border hover:bg-accent/20 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Suggested Matchups</h2>
              {suggestions && suggestions.length > 0 && (
                <span className="text-xs text-muted-foreground">({suggestions.length})</span>
              )}
            </div>
            {suggestionsOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {suggestionsOpen && (
            <div>
              {suggestionsLoading ? (
                <div className="p-5 animate-pulse space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 bg-muted rounded" />)}
                </div>
              ) : suggestions && suggestions.length > 0 ? (
                <div className="divide-y divide-border">
                  {suggestions.map((s, idx) => (
                    <div key={idx} className="flex items-center gap-4 px-5 py-3 hover:bg-accent/20 transition-colors">
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-sm text-foreground">{s.player1Name}</span>
                        <span className="text-xs text-muted-foreground font-bold mx-2">VS</span>
                        <span className="font-semibold text-sm text-foreground">{s.player2Name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {s.daysSincePlayed === null ? "Never played" : `${s.daysSincePlayed}d ago`}
                      </span>
                      <button
                        onClick={() => assignSuggestion(s)}
                        disabled={createMatch.isPending}
                        className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md bg-primary/10 text-primary border border-primary/25 hover:bg-primary/20 transition-colors disabled:opacity-50"
                      >
                        Assign
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  {leaguePlayers.length < 2 ? "Add at least two players to see suggestions." : "No suggestions available."}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Rounds */}
      <div className="bg-card border border-card-border rounded-lg">
        {/* Header row: title + admin controls */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Rounds</h2>
            {allRounds && allRounds.length > 0 && (
              <span className="text-xs text-muted-foreground">({allRounds.filter(r => r.status === "completed").length} of 6 complete)</span>
            )}
          </div>
          {canManageInvites && (
            confirmForceRound ? (
              <div className="flex items-center gap-2 text-xs shrink-0">
                <span className="text-muted-foreground">Regenerate all rounds?</span>
                <button
                  onClick={() => handleGenerateRound(true)}
                  className="font-semibold text-destructive hover:text-destructive/80 transition-colors"
                >
                  Yes, regenerate
                </button>
                <button
                  onClick={() => setConfirmForceRound(false)}
                  className="font-semibold text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => handleGenerateRound(false)}
                  disabled={generatingRound || leaguePlayers.length < 2 || (allRounds?.length ?? 0) >= 6}
                  className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title={
                    leaguePlayers.length < 2 ? "Need at least 2 players" :
                    (allRounds?.length ?? 0) >= 6 ? "All 6 rounds already generated" :
                    "Generate all remaining rounds"
                  }
                >
                  <Plus className="w-3.5 h-3.5" />
                  {generatingRound ? "Generating..." : (allRounds?.length ?? 0) === 0 ? "Generate All Rounds" : `Generate Remaining`}
                </button>
                {(allRounds?.length ?? 0) > 0 && (
                  <button
                    onClick={() => setConfirmForceRound(true)}
                    disabled={generatingRound}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                    title="Delete upcoming rounds and regenerate from scratch"
                  >
                    Regenerate
                  </button>
                )}
              </div>
            )
          )}
        </div>

        {/* Round selector pills */}
        {allRounds && allRounds.length > 0 && (() => {
          const activeRound = allRounds.find(r => r.status === "active");
          const defaultId = activeRound?.roundId ?? allRounds.find(r => r.status === "upcoming")?.roundId ?? allRounds[allRounds.length - 1]?.roundId;
          const effectiveId = selectedRoundId ?? defaultId ?? null;
          const currentIdx = allRounds.findIndex(r => r.roundId === effectiveId);
          const hasPrev = currentIdx > 0;
          const hasNext = currentIdx < allRounds.length - 1;
          return (
            <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-2">
              <button
                onClick={() => hasPrev && setSelectedRoundId(allRounds[currentIdx - 1].roundId)}
                disabled={!hasPrev}
                className="flex items-center justify-center w-8 h-8 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                aria-label="Previous round"
              >
                <ChevronDown className="w-4 h-4 rotate-90" />
              </button>

              <div className="flex items-center gap-2 flex-wrap justify-center">
                {allRounds.map((r, idx) => {
                  const isSelected = r.roundId === effectiveId;
                  const isActive = r.status === "active";
                  const isCompleted = r.status === "completed";
                  const isUpcoming = r.status === "upcoming";
                  if (isSelected) {
                    return (
                      <span
                        key={r.roundId}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-xs font-semibold border",
                          isActive && "bg-primary border-primary text-primary-foreground",
                          isUpcoming && "bg-primary/10 border-primary text-primary",
                          isCompleted && "bg-accent border-border text-foreground"
                        )}
                      >
                        Round {r.roundNumber}
                      </span>
                    );
                  }
                  return (
                    <button
                      key={r.roundId}
                      onClick={() => setSelectedRoundId(r.roundId)}
                      className={cn(
                        "w-2 h-2 rounded-full border transition-colors",
                        isActive && "border-primary/60 bg-primary/30 hover:bg-primary/50",
                        isUpcoming && "border-border bg-transparent hover:border-foreground/30",
                        isCompleted && "border-border/50 bg-muted-foreground/20 hover:bg-muted-foreground/40"
                      )}
                      aria-label={`Round ${r.roundNumber}`}
                    />
                  );
                })}
              </div>

              <button
                onClick={() => hasNext && setSelectedRoundId(allRounds[currentIdx + 1].roundId)}
                disabled={!hasNext}
                className="flex items-center justify-center w-8 h-8 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                aria-label="Next round"
              >
                <ChevronDown className="w-4 h-4 -rotate-90" />
              </button>
            </div>
          );
        })()}

        {/* Displayed round info */}
        {displayRound && (() => {
          const total = displayRound.matchups.length;
          const arranged = displayRound.matchups.filter(m => m.scheduledAt).length;
          const pct = total > 0 ? Math.round((arranged / total) * 100) : 0;
          return (
            <>
              <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-foreground">Round {displayRound.roundNumber}</span>
                <span className={cn(
                  "text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider border",
                  displayRoundIsActive ? "border-primary/40 text-primary" :
                  displayRound.status === "upcoming" ? "border-border text-muted-foreground" :
                  "border-border/50 text-muted-foreground/60"
                )}>
                  {displayRound.status === "active" ? (displayRoundIsActive ? "active" : "ended") : displayRound.status}
                </span>
                <span className="text-xs text-muted-foreground">
                  {displayRound.status === "upcoming" ? `starts ${displayRound.startDate}` : `${displayRound.startDate} – ${displayRound.endDate}`}
                </span>
                {total > 0 && (
                  <span className="text-xs text-muted-foreground ml-auto">
                    {arranged}/{total} arranged
                  </span>
                )}
              </div>
              {total > 0 && (
                <div className="h-1 bg-border overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all duration-500",
                      displayRoundIsActive ? (pct > 0 ? "bg-primary" : "bg-muted") : "bg-muted-foreground/30"
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </>
          );
        })()}

        {/* Player-specific callout for the displayed round */}
        {myRoundMatchup && myLeaguePlayer && (
          <div className="px-5 py-3 border-b border-border bg-primary/[0.04]">
            <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">
              {displayRound?.status === "upcoming" ? `Your round ${displayRound.roundNumber} match` : "Your match this round"}
            </p>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-semibold text-foreground">
                  vs {myRoundMatchup.player1Id === myLeaguePlayer.id ? myRoundMatchup.player2Name : myRoundMatchup.player1Name}
                </span>
                {myRoundMatchup.status === "completed" && myRoundMatchup.score && (
                  <span className="text-xs font-mono text-muted-foreground">{formatDisplayScore(myRoundMatchup.score)}</span>
                )}
                {myRoundMatchup.status !== "completed" && myRoundMatchup.scheduledAt && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(myRoundMatchup.scheduledAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                {myRoundMatchup.status !== "completed" && !myRoundMatchup.scheduledAt && displayRound?.status === "upcoming" && (
                  <span className="text-xs text-muted-foreground">— starts {displayRound.startDate}</span>
                )}
                {myRoundMatchup.status !== "completed" && !myRoundMatchup.scheduledAt && displayRoundIsActive && (
                  <span className="text-xs text-muted-foreground">— schedule by {displayRound!.endDate}</span>
                )}
                {myRoundMatchup.status !== "completed" && !myRoundMatchup.scheduledAt && displayRound?.status === "completed" && (
                  <span className="text-xs text-amber-500/80">— round ended, arrange anytime</span>
                )}
              </div>
              <div className="shrink-0">
                {myRoundMatchup.status !== "completed" && !myRoundMatchup.scheduledAt ? (
                  <Link
                    href={`/matches/${myRoundMatchup.matchId}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors"
                  >
                    Arrange match
                  </Link>
                ) : (
                  <Link
                    href={`/matches/${myRoundMatchup.matchId}`}
                    className="text-xs text-primary hover:underline font-semibold"
                  >
                    View match
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Matchup list for displayed round */}
        {roundLoading ? (
          <div className="p-5 animate-pulse space-y-2">
            {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-10 bg-muted rounded" />)}
          </div>
        ) : displayRound && displayRound.matchups.length > 0 ? (
          <div className="divide-y divide-border">
            {displayRound.matchups.map((m) => {
              const isCompleted = m.status === "completed";
              const p1won = isCompleted && m.winnerId === m.player1Id;
              const p2won = isCompleted && m.winnerId === m.player2Id;
              const isMyMatch = myLeaguePlayer && (m.player1Id === myLeaguePlayer.id || m.player2Id === myLeaguePlayer.id);
              const needsScheduling = !isCompleted && !m.scheduledAt;
              const canScheduleAhead = needsScheduling && (displayRound.status === "upcoming" || displayRound.status === "active");
              return (
                <Link
                  key={m.matchId}
                  href={`/matches/${m.matchId}`}
                  className={cn(
                    "flex items-center gap-3 px-5 py-3.5 transition-colors",
                    isMyMatch ? "bg-primary/[0.03] hover:bg-primary/[0.06]" : "hover:bg-accent/30"
                  )}
                >
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("text-sm font-semibold", p1won ? "text-primary" : "text-foreground")}>{m.player1Name}</span>
                      <span className="text-xs font-bold text-muted-foreground">vs</span>
                      <span className={cn("text-sm font-semibold", p2won ? "text-primary" : "text-foreground")}>{m.player2Name}</span>
                    </div>
                    {isCompleted && m.score && (
                      <div className="text-xs font-mono text-muted-foreground">{formatDisplayScore(m.score)}</div>
                    )}
                    {!isCompleted && m.scheduledAt && (
                      <div className="text-xs text-muted-foreground">
                        {new Date(m.scheduledAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}
                    {canScheduleAhead && !m.scheduledAt && (
                      <div className="text-xs text-muted-foreground/60 italic">
                        {displayRound.status === "upcoming" ? `round starts ${displayRound.startDate}` : "not yet scheduled"}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center">
                    {isMyMatch && needsScheduling ? (
                      <span className="inline-flex items-center px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-bold">
                        {displayRound.status === "upcoming" ? "Pre-schedule" : "Arrange"}
                      </span>
                    ) : canScheduleAhead ? (
                      <span className="text-xs font-semibold text-primary/70">
                        Schedule
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        View
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            {roundLoading ? null : displayRound ? "No matchups in this round." : leaguePlayers.length < 2
              ? "Add at least two players to generate rounds."
              : canManageInvites
              ? "No rounds yet — use Generate All Rounds to start."
              : "No rounds generated yet."}
          </div>
        )}
      </div>

      {/* Round History — completed rounds only, all authenticated users */}
      {allRounds && allRounds.filter((r) => r.status === "completed").length > 0 && (() => {
        const pastRounds = allRounds
          .filter((r) => r.status === "completed")
          .sort((a, b) => b.roundNumber - a.roundNumber);
        return (
          <div className="bg-card border border-card-border rounded-lg">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Round History</h2>
              <span className="text-xs text-muted-foreground">({pastRounds.length})</span>
            </div>
            <div className="divide-y divide-border">
              {pastRounds.map((round) => {
                const total = round.matchups.length;
                const arranged = round.matchups.filter((m) => m.scheduledAt).length;
                const completed = round.matchups.filter((m) => m.status === "completed").length;
                const pct = total > 0 ? Math.round((arranged / total) * 100) : 0;
                const isExpanded = expandedRoundIds.has(round.roundId);
                return (
                  <div key={round.roundId}>
                    <button
                      onClick={() => toggleRound(round.roundId)}
                      className="w-full text-left hover:bg-accent/30 transition-colors"
                    >
                      <div className="px-5 py-3 flex items-center gap-3 flex-wrap">
                        <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">Round {round.roundNumber}</span>
                          <span className="text-xs text-muted-foreground">
                            {round.startDate} – {round.endDate}
                          </span>
                          {total > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {arranged}/{total} arranged{completed > 0 ? `, ${completed} completed` : ""}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {total > 0 && (
                            <div className="w-20 h-1.5 bg-border rounded-full overflow-hidden">
                              <div
                                className="h-full bg-muted-foreground/40 transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          )}
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="divide-y divide-border border-t border-border bg-accent/10">
                        {round.matchups.length === 0 ? (
                          <div className="px-5 py-4 text-sm text-muted-foreground text-center">No matchups in this round.</div>
                        ) : (
                          round.matchups.map((m) => {
                            const isCompleted = m.status === "completed";
                            const p1won = isCompleted && m.winnerId === m.player1Id;
                            const p2won = isCompleted && m.winnerId === m.player2Id;
                            return (
                              <div key={m.matchId} className="flex items-center gap-3 px-5 py-2.5 hover:bg-accent/20 transition-colors">
                                <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                                  <span className={cn("text-sm font-semibold", p1won ? "text-primary" : "text-foreground")}>{m.player1Name}</span>
                                  <span className="text-xs font-bold text-muted-foreground">vs</span>
                                  <span className={cn("text-sm font-semibold", p2won ? "text-primary" : "text-foreground")}>{m.player2Name}</span>
                                  {isCompleted && m.score && (
                                    <span className="text-xs font-mono text-muted-foreground">{formatDisplayScore(m.score)}</span>
                                  )}
                                  {!isCompleted && m.scheduledAt && (
                                    <span className="text-xs text-muted-foreground">
                                      {new Date(m.scheduledAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                                    </span>
                                  )}
                                  {!isCompleted && !m.scheduledAt && (
                                    <span className="text-xs text-muted-foreground italic">not arranged</span>
                                  )}
                                </div>
                                <Link
                                  href={`/matches/${m.matchId}`}
                                  className="shrink-0 text-xs text-muted-foreground hover:text-primary transition-colors"
                                >
                                  View
                                </Link>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Match Schedule — hidden; match info is visible in the Rounds section */}
      {false && <div className="bg-card border border-card-border rounded-lg">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Swords className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Matches</h2>
            {matches && matches.length > 0 && (
              <span className="text-xs text-muted-foreground">({matches.length})</span>
            )}
          </div>
          {!!user && (
          <button
            onClick={() => setScheduleOpen(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Matchup
          </button>
          )}
        </div>

        {matchesLoading ? (
          <div className="p-5 animate-pulse space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 bg-muted rounded" />)}
          </div>
        ) : matches?.length ? (() => {
          const activeSeasonName = activeSeason?.name ?? null;
          const currentMatches = matches.filter((m) => {
            const s = (m as any).season as string | null | undefined;
            return !s || s === activeSeasonName;
          });
          const archivedMatchesBySeason = matches
            .filter((m) => {
              const s = (m as any).season as string | null | undefined;
              return !!s && s !== activeSeasonName;
            })
            .reduce<Record<string, typeof matches>>((acc, m) => {
              const s = (m as any).season as string;
              if (!acc[s]) acc[s] = [];
              acc[s].push(m);
              return acc;
            }, {});
          const archivedSeasonNames = Object.keys(archivedMatchesBySeason);

          const renderMatchRow = (match: (typeof matches)[0]) => {
            const isDoublesMatch = !!match.player3Id;
            const team1Won = match.winnerId === match.player1Id;
            const team2Won = match.winnerId === match.player2Id;
            return (
              <Link
                key={match.id}
                href={`/matches/${match.id}`}
                data-testid={`match-row-${match.id}`}
                className="flex flex-col gap-1 px-5 py-3.5 hover:bg-accent/30 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider", statusBadge(match.status))}>
                    {match.status}
                  </span>
                  {match.roundNumber != null && (match as any).playoffRound == null && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider border border-primary/30 text-primary/70">
                      Round {match.roundNumber}
                    </span>
                  )}
                  {(match as any).playoffRound != null && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider border border-primary/40 text-primary">
                      {(match as any).playoffRound === "quarterfinal"
                        ? "QF"
                        : (match as any).playoffRound === "semifinal"
                        ? "SF"
                        : "Final"}
                    </span>
                  )}
                  {(match as any).season && (
                    <span className={cn(
                      "text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider border",
                      (match as any).season === activeSeasonName
                        ? "border-primary/40 text-primary/80"
                        : "border-border text-muted-foreground"
                    )}>
                      {(match as any).season}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {isDoublesMatch ? (
                    <>
                      <span className={cn("font-semibold text-sm", team1Won ? "text-primary" : "text-foreground")}>
                        {match.player1Name} & {match.player3Name}
                      </span>
                      <span className="text-xs text-muted-foreground font-bold">VS</span>
                      <span className={cn("font-semibold text-sm", team2Won ? "text-primary" : "text-foreground")}>
                        {match.player2Name} & {match.player4Name}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className={cn("font-semibold text-sm", match.winnerId === match.player1Id ? "text-primary" : "text-foreground")}>{match.player1Name}</span>
                      <span className="text-xs text-muted-foreground font-bold">VS</span>
                      <span className={cn("font-semibold text-sm", match.winnerId === match.player2Id ? "text-primary" : "text-foreground")}>{match.player2Name}</span>
                    </>
                  )}
                </div>
                {match.scheduledAt && (
                  <div className="text-xs text-muted-foreground">
                    {new Date(match.scheduledAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {match.location && ` · ${match.location}`}
                  </div>
                )}
                {match.score && (
                  <div className="w-full font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                    {formatDisplayScore(match.score)}
                  </div>
                )}
              </Link>
            );
          };

          return (
            <>
              {currentMatches.length > 0 ? (
                <div className="divide-y divide-border">
                  {currentMatches.map(renderMatchRow)}
                </div>
              ) : archivedSeasonNames.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">No matches scheduled</div>
              ) : null}
              {archivedSeasonNames.map((seasonName) => {
                const seasonMatches = archivedMatchesBySeason[seasonName];
                const isExpanded = expandedArchivedSeasons.has(seasonName);
                return (
                  <div key={seasonName} className="border-t border-border">
                    <button
                      onClick={() => toggleArchivedSeason(seasonName)}
                      className="w-full text-left hover:bg-accent/20 transition-colors"
                    >
                      <div className="px-5 py-3 flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-1">
                          {seasonName} — archived
                        </span>
                        <span className="text-xs text-muted-foreground">({seasonMatches.length})</span>
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="divide-y divide-border border-t border-border bg-accent/5">
                        {seasonMatches.map(renderMatchRow)}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          );
        })() : (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">No matches scheduled</div>
        )}
      </div>}

      {/* Playoffs section — visible when bracket exists, eligible (6+ rounds), or admin */}
      {(playoff?.bracket || playoff?.eligibleForPlayoffs || isAdmin) && (
        <div className="bg-card border border-card-border rounded-lg">
          <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border">
            <div className="flex items-center gap-2">
              <Crown className="w-4 h-4 text-primary shrink-0" />
              <span className="font-semibold text-foreground">Playoffs</span>
              {playoff?.bracket && (
                <span className={cn("text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full", playoff.bracket.status === "completed" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                  {playoff.bracket.status === "completed" ? "Complete" : "Active"}
                </span>
              )}
            </div>
            {isAdmin && !playoff?.bracket && playoff?.eligibleForPlayoffs && (
              <button
                disabled={generatePlayoffMutation.isPending}
                onClick={() =>
                  generatePlayoffMutation.mutate(
                    { leagueId },
                    {
                      onSuccess: () => {
                        qc.invalidateQueries({ queryKey: ["playoff", leagueId] });
                        toast({ title: "Playoff bracket generated" });
                      },
                      onError: (err: any) => {
                        const msg = err?.response?.data?.error ?? "Failed to generate bracket";
                        toast({ title: msg, variant: "destructive" });
                      },
                    }
                  )
                }
                className="text-xs font-semibold px-3 py-1.5 rounded-md bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                {generatePlayoffMutation.isPending ? "Generating..." : "Generate Bracket"}
              </button>
            )}
          </div>
          <div className="p-5">
            {playoffLoading ? (
              <div className="animate-pulse space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-muted rounded" />)}
              </div>
            ) : playoff?.bracket ? (
              <PlayoffBracket bracket={playoff.bracket} />
            ) : (
              <div className="py-8 text-center space-y-2">
                {playoff?.eligibleForPlayoffs ? (
                  <p className="text-sm text-muted-foreground">
                    Regular season complete — bracket can now be generated.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Playoffs unlock after 6 completed rounds.
                    </p>
                    <p className="text-xs text-muted-foreground/60">
                      {playoff?.completedRoundCount ?? 0} of 6 rounds completed
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Admin: Season Management */}
      {isAdmin && (
        <div className="bg-card border border-card-border rounded-lg">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CalendarRange className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Seasons</h2>
              {activeSeason && (
                <span className="text-xs font-semibold border border-primary/40 text-primary px-2 py-0.5 rounded uppercase tracking-wider">
                  {activeSeason.name} active
                </span>
              )}
            </div>
            <button
              onClick={() => openSeasonForm()}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New Season
            </button>
          </div>

          {/* Inline create/edit form */}
          {seasonFormOpen && (
            <div className="px-5 py-4 border-b border-border bg-accent/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  {editingSeason ? "Edit Season" : "Create Season"}
                </span>
                <button onClick={closeSeasonForm} className="text-muted-foreground hover:text-foreground transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-1 flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Name</label>
                  <input
                    type="text"
                    value={seasonName}
                    onChange={(e) => setSeasonName(e.target.value)}
                    placeholder="e.g. Fall League"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Start Date</label>
                  <input
                    type="date"
                    value={seasonStart}
                    onChange={(e) => setSeasonStart(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:dark]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">End Date</label>
                  <input
                    type="date"
                    value={seasonEnd}
                    onChange={(e) => setSeasonEnd(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:dark]"
                  />
                </div>
              </div>
              {seasonFormError && (
                <p className="text-xs text-destructive">{seasonFormError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={submitSeasonForm}
                  disabled={createSeasonMutation.isPending || updateSeasonMutation.isPending}
                  className="text-xs font-semibold px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {(createSeasonMutation.isPending || updateSeasonMutation.isPending) ? "Saving..." : editingSeason ? "Save Changes" : "Create Season"}
                </button>
                <button
                  onClick={closeSeasonForm}
                  className="text-xs font-semibold px-4 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Seasons list */}
          {seasonsLoading ? (
            <div className="p-5 animate-pulse space-y-2">
              {[1, 2].map((i) => <div key={i} className="h-10 bg-muted rounded" />)}
            </div>
          ) : seasons && seasons.length > 0 ? (
            <div className="divide-y divide-border">
              {seasons.map((season: Season) => (
                <div key={season.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{season.name}</span>
                      {season.isActive && (
                        <span className="text-xs font-semibold border border-primary/40 text-primary px-1.5 py-0.5 rounded uppercase tracking-wider">Active</span>
                      )}
                      {season.leagueId === null && (
                        <span className="text-xs text-muted-foreground/60 border border-border px-1.5 py-0.5 rounded uppercase tracking-wider">Global</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {season.startDate} – {season.endDate}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openSeasonForm(season)}
                      className="text-muted-foreground hover:text-primary transition-colors p-1"
                      title="Edit season"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => confirmDeleteSeason(season)}
                      disabled={deleteSeasonMutation.isPending}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1 disabled:opacity-50"
                      title="Delete season"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              No seasons defined. Create one to tag upcoming matches automatically.
            </div>
          )}
        </div>
      )}

      {/* Admin danger zone */}
      {isAdmin && (
        <div className="bg-card border border-destructive/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <TriangleAlert className="w-4 h-4 text-destructive" />
            <span className="text-sm font-semibold text-foreground uppercase tracking-wider">Danger Zone</span>
          </div>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-medium text-foreground">Reset round scheduling</p>
              <p className="text-xs text-muted-foreground mt-0.5">Clears all round scheduling history so the next season can start fresh. Match history and scores are preserved.</p>
            </div>
            <button
              onClick={() => setResetDialogOpen(true)}
              disabled={resetMutation.isPending}
              className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md border border-destructive/40 text-destructive bg-destructive/5 hover:bg-destructive/10 transition-colors disabled:opacity-50"
            >
              {resetMutation.isPending ? "Resetting..." : "Reset rounds"}
            </button>
          </div>
        </div>
      )}

      {/* Reset confirmation dialog */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset round scheduling for {league?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear all round scheduling history for this league. Match history, scores, and Ball Boi recordings are preserved. Players and their memberships will not be affected. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                resetMutation.mutate(
                  { leagueId },
                  {
                    onSuccess: (data: ResetLeagueRecords200) => {
                      qc.invalidateQueries({ queryKey: ["currentRound", leagueId] });
                      qc.invalidateQueries({ queryKey: ["allRounds", leagueId] });
                      toast({ title: `Round scheduling reset — ${data.deleted.rounds} round${data.deleted.rounds !== 1 ? "s" : ""} removed.` });
                      setResetDialogOpen(false);
                    },
                    onError: () => {
                      toast({ title: "Failed to reset round scheduling", variant: "destructive" });
                      setResetDialogOpen(false);
                    },
                  }
                );
              }}
            >
              Reset rounds
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Matchup Dialog */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="left-0 top-0 right-0 bottom-0 translate-x-0 translate-y-0 w-screen h-screen max-w-none rounded-none border-0 overflow-y-auto flex flex-col p-8 [&>button]:hidden">
          {/* Title */}
          <h2 className="text-4xl font-extrabold text-foreground tracking-tight">
            Create {isDoubles ? "Doubles " : ""}Matchup
          </h2>
          {/* Subtitle — 24px below title */}
          <p className="text-sm text-muted-foreground mt-6">
            Players will be notified and can set the date, time, and location themselves.
          </p>

          <Form {...scheduleForm}>
            <form onSubmit={scheduleForm.handleSubmit(onScheduleSubmit)} className="flex flex-col flex-1">
              {/* Player selects — 40px below subtitle */}
              <div className="mt-10 space-y-4">
                {isDoubles ? (
                  <>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Team 1</div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={scheduleForm.control} name="player1Id" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Player A</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {leaguePlayers.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={scheduleForm.control} name="player3Id" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Player B</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value ?? ""}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {leaguePlayers.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Team 2</div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={scheduleForm.control} name="player2Id" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Player A</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {leaguePlayers.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={scheduleForm.control} name="player4Id" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Player B</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value ?? ""}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {leaguePlayers.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                  </>
                ) : (
                  <>
                    <FormField control={scheduleForm.control} name="player1Id" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Player 1</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select player" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {leaguePlayers.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={scheduleForm.control} name="player2Id" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Player 2</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select player" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {leaguePlayers.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </>
                )}

                {/* Date — optional */}
                <FormField control={scheduleForm.control} name="scheduledDate" render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Date <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <FormControl>
                      <input
                        type="date"
                        {...field}
                        className="w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:dark]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Time — optional, 3-part picker */}
                <FormField control={scheduleForm.control} name="scheduledTime" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <div className="flex gap-2">
                      {/* Hour */}
                      <Select
                        value={schedHour}
                        onValueChange={(v) => {
                          setSchedHour(v);
                          field.onChange(toTime24(v, schedMinute, schedPeriod));
                        }}
                      >
                        <SelectTrigger className="flex-1 min-w-0">
                          <SelectValue placeholder="Hr" />
                        </SelectTrigger>
                        <SelectContent>
                          {HOUR_OPTIONS.map((h) => (
                            <SelectItem key={h} value={h}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {/* Minute */}
                      <Select
                        value={schedMinute}
                        onValueChange={(v) => {
                          setSchedMinute(v);
                          if (schedHour) field.onChange(toTime24(schedHour, v, schedPeriod));
                        }}
                      >
                        <SelectTrigger className="w-20 shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MINUTE_OPTIONS.map((m) => (
                            <SelectItem key={m} value={m}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {/* AM / PM */}
                      <div className="flex rounded-md border border-input overflow-hidden shrink-0">
                        {(["AM", "PM"] as const).map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => {
                              setSchedPeriod(p);
                              if (schedHour) field.onChange(toTime24(schedHour, schedMinute, p));
                            }}
                            className={cn(
                              "px-3 py-2 text-sm font-semibold transition-colors",
                              schedPeriod === p
                                ? "bg-primary text-primary-foreground"
                                : "bg-background text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* CTAs pinned to bottom with 40px padding */}
              <div className="mt-auto pb-10 flex flex-col gap-3">
                <Button type="submit" disabled={createMatch.isPending} className="w-full">
                  {createMatch.isPending ? "Creating..." : "Create Matchup"}
                </Button>
                <Button type="button" variant="outline" className="w-full" onClick={() => { setScheduleOpen(false); scheduleForm.reset(); setSchedHour(""); setSchedMinute("00"); setSchedPeriod("AM"); }}>
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

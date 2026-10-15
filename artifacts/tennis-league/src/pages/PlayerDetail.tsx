import { useGetPlayer, useGetPlayerStats, useGetPlayers, useGetHeadToHead } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { useState, useRef, useEffect } from "react";
import { ArrowLeft, Swords, Zap } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

function skillBadge(level: string) {
  if (level === "5.0") return "bg-yellow-400/15 text-yellow-400 border border-yellow-400/25";
  if (level === "4.5") return "bg-amber-400/15 text-amber-400 border border-amber-400/25";
  if (level === "4.0") return "bg-primary/15 text-primary border border-primary/25";
  if (level === "3.5") return "bg-blue-400/15 text-blue-400 border border-blue-400/25";
  if (level === "3.0") return "bg-green-400/15 text-green-400 border border-green-400/25";
  return "bg-muted text-muted-foreground border border-border";
}

function statusColor(status: string) {
  if (status === "completed") return "text-primary bg-primary/10";
  if (status === "scheduled") return "text-blue-400 bg-blue-400/10";
  return "text-red-400 bg-red-400/10";
}

export default function PlayerDetail() {
  const params = useParams<{ id: string }>();
  const playerId = parseInt(params.id ?? "");
  const [h2hOpponent, setH2hOpponent] = useState<string>("");
  const [showPointsBreakdown, setShowPointsBreakdown] = useState(false);
  const pointsBreakdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPointsBreakdown) return;
    function handleClickOutside(e: MouseEvent) {
      if (pointsBreakdownRef.current && !pointsBreakdownRef.current.contains(e.target as Node)) {
        setShowPointsBreakdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPointsBreakdown]);

  const { data: player, isLoading } = useGetPlayer(playerId, { query: { enabled: !!playerId, queryKey: ["player", playerId] as any } });
  const { data: stats } = useGetPlayerStats(playerId, { query: { enabled: !!playerId, queryKey: ["player-stats", playerId] as any } });
  const { data: allPlayers } = useGetPlayers();
  const opponentId = h2hOpponent ? parseInt(h2hOpponent) : null;
  const { data: h2h } = useGetHeadToHead(
    { player1Id: playerId, player2Id: opponentId ?? 0 },
    { query: { enabled: !!opponentId && opponentId !== playerId, queryKey: ["h2h", playerId, opponentId] as any } }
  );

  if (isLoading) return <div className="animate-pulse space-y-4"><div className="h-8 w-48 bg-muted rounded" /><div className="h-48 bg-card border border-card-border rounded-lg" /></div>;
  if (!player) return <div className="text-muted-foreground">Player not found</div>;

  const wr = stats ? (stats.wins + stats.losses > 0 ? stats.wins / (stats.wins + stats.losses) : 0) : 0;
  const points = stats ? (stats.gamesWon ?? 0) + (stats.setsWon ?? 0) * 3 + (stats.wins ?? 0) * 6 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/players" className="p-1.5 rounded hover:bg-accent text-muted-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="page-heading text-foreground">{player.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider border", skillBadge(player.skillLevel))}>
              {player.skillLevel}
            </span>
            <span className="text-xs text-muted-foreground">{player.dominantHand === "left" ? "Left-handed" : "Right-handed"}</span>
          </div>
          {player.bio && <p className="text-sm text-muted-foreground mt-1">{player.bio}</p>}
        </div>
      </div>

      {/* Stats overview */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { label: "Win Rate", value: `${Math.round(wr * 100)}%`, highlight: true },
            { label: "Record", value: `${stats.wins}W / ${stats.losses}L` },
            { label: "Streak", value: stats.currentStreak > 0 ? `+${stats.currentStreak} W` : stats.currentStreak < 0 ? `${Math.abs(stats.currentStreak)} L` : "-" },
            { label: "Best Streak", value: `${stats.longestWinStreak}W` },
          ].map(({ label, value, highlight }) => (
            <motion.div key={label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-card-border rounded-lg p-4">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{label}</div>
              <div className={cn("text-2xl font-extrabold mt-1 tabular-nums", highlight ? "text-primary" : "text-foreground")}>{value}</div>
            </motion.div>
          ))}
          {/* Points card with breakdown tooltip */}
          <div ref={pointsBreakdownRef}>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-card-border rounded-lg p-4">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Points</div>
            <div className="relative inline-block group mt-1">
              <span
                className="text-2xl font-extrabold tabular-nums text-foreground underline decoration-dotted decoration-muted-foreground/50 cursor-help"
                onClick={() => setShowPointsBreakdown(v => !v)}
              >
                {points}
              </span>
              <div className={`pointer-events-none absolute bottom-full left-0 mb-2 z-50 ${showPointsBreakdown ? "block" : "hidden group-hover:block"}`}>
                <div className="bg-popover text-popover-foreground border border-border rounded-md shadow-lg px-3 py-2 text-xs font-normal whitespace-nowrap text-left">
                  <div className="font-semibold text-foreground mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Points breakdown</div>
                  <div className="space-y-1">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">{stats.gamesWon} game{stats.gamesWon !== 1 ? "s" : ""} won</span>
                      <span className="font-semibold tabular-nums">+{stats.gamesWon}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">{stats.setsWon} set{stats.setsWon !== 1 ? "s" : ""} won × 3</span>
                      <span className="font-semibold tabular-nums">+{(stats.setsWon ?? 0) * 3}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">{stats.wins} win{stats.wins !== 1 ? "s" : ""} × 6</span>
                      <span className="font-semibold tabular-nums">+{stats.wins * 6}</span>
                    </div>
                  </div>
                  <div className="border-t border-border mt-1.5 pt-1.5 flex justify-between gap-4">
                    <span className="font-semibold text-foreground">Total</span>
                    <span className="font-bold tabular-nums text-foreground">{points}</span>
                  </div>
                </div>
                <div className="w-2 h-2 bg-popover border-r border-b border-border rotate-45 absolute left-3 -bottom-1" />
              </div>
            </div>
          </motion.div>
          </div>
        </div>
      )}

      {/* Sets / Games */}
      {stats && (
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="bg-card border border-card-border rounded-lg p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-3">Sets</div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-primary font-semibold">{stats.setsWon} won</span>
              <span className="text-muted-foreground">{stats.setsLost} lost</span>
            </div>
            <div className="bg-muted rounded-full h-2">
              <div className="bg-primary h-2 rounded-full transition-all" style={{ width: stats.setsWon + stats.setsLost > 0 ? `${(stats.setsWon / (stats.setsWon + stats.setsLost)) * 100}%` : "0%" }} />
            </div>
          </div>
          <div className="bg-card border border-card-border rounded-lg p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-3">Games</div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-primary font-semibold">{stats.gamesWon} won</span>
              <span className="text-muted-foreground">{stats.gamesLost} lost</span>
            </div>
            <div className="bg-muted rounded-full h-2">
              <div className="bg-primary h-2 rounded-full transition-all" style={{ width: stats.gamesWon + stats.gamesLost > 0 ? `${(stats.gamesWon / (stats.gamesWon + stats.gamesLost)) * 100}%` : "0%" }} />
            </div>
          </div>
        </div>
      )}

      {/* Head to head */}
      <div className="bg-card border border-card-border rounded-lg">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Head to Head</h2>
        </div>
        <div className="px-5 py-4">
          <Select value={h2hOpponent} onValueChange={setH2hOpponent}>
            <SelectTrigger className="w-56" data-testid="select-h2h-opponent">
              <SelectValue placeholder="Select opponent..." />
            </SelectTrigger>
            <SelectContent>
              {allPlayers?.filter((p) => p.id !== playerId).map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {h2h && opponentId && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div className="text-center">
                  <div className="text-3xl font-extrabold text-primary tabular-nums">{h2h.player1Wins}</div>
                  <div className="text-sm text-foreground font-medium">{h2h.player1Name}</div>
                </div>
                <div className="text-muted-foreground text-sm font-medium">vs</div>
                <div className="text-center">
                  <div className="text-3xl font-extrabold text-foreground tabular-nums">{h2h.player2Wins}</div>
                  <div className="text-sm text-foreground font-medium">{h2h.player2Name}</div>
                </div>
              </div>
              {h2h.matches.length === 0 && <p className="text-sm text-muted-foreground text-center">No matches played yet</p>}
              {h2h.matches.map((m) => (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  data-testid={`h2h-match-${m.id}`}
                  className="flex items-center justify-between py-2 px-3 rounded hover:bg-accent/30 transition-colors text-sm"
                >
                  <span className="text-muted-foreground text-xs">{m.completedAt ? new Date(m.completedAt).toLocaleDateString() : ""}</span>
                  <span className="font-medium">{m.score ?? "-"}</span>
                  <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider", statusColor(m.status))}>{m.status}</span>
                </Link>
              ))}
            </motion.div>
          )}
        </div>
      </div>

      {/* Recent matches */}
      {stats?.recentMatches && stats.recentMatches.length > 0 && (
        <div className="bg-card border border-card-border rounded-lg">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Swords className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Recent Matches</h2>
          </div>
          <div className="divide-y divide-border">
            {stats.recentMatches.map((m) => {
              const won = m.winnerId === playerId;
              const isDoubles = m.player3Id != null;
              const team1Label = isDoubles
                ? `${m.player1Name} & ${m.player3Name ?? "?"}`
                : m.player1Name;
              const team2Label = isDoubles
                ? `${m.player2Name} & ${m.player4Name ?? "?"}`
                : m.player2Name;
              return (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  data-testid={`recent-match-${m.id}`}
                  className="flex items-center gap-4 px-5 py-3.5 hover:bg-accent/30 transition-colors"
                >
                  <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0", won ? "bg-primary/15 text-primary" : "bg-red-400/10 text-red-400")}>
                    {won ? "W" : "L"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{team1Label} <span className="text-muted-foreground font-normal">vs</span> {team2Label}</div>
                    {m.score && <div className="text-xs text-muted-foreground font-mono">{m.score}</div>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {m.completedAt ? new Date(m.completedAt).toLocaleDateString() : ""}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

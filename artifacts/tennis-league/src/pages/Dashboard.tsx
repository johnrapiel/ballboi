import { useGetDashboardStats, useGetTopPlayers, useGetRecentActivity } from "@workspace/api-client-react";
import { Link } from "wouter";
import { ArrowRight, Clock, CalendarDays } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import MyScheduleCard from "@/components/MyScheduleCard";

function statusColor(status: string) {
  if (status === "completed") return "border border-white/20 text-muted-foreground";
  if (status === "scheduled") return "border border-border text-muted-foreground";
  return "border border-border text-muted-foreground";
}

export default function Dashboard() {
  const { data: stats } = useGetDashboardStats();
  const { data: topPlayers, isLoading: topLoading } = useGetTopPlayers({ limit: 5 });
  const { data: activity, isLoading: actLoading } = useGetRecentActivity({ limit: 8 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-heading text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">League overview and recent activity</p>
      </div>

      {/* My Schedule */}
      <MyScheduleCard />

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Top Players */}
        <div className="lg:col-span-1 bg-card border border-card-border rounded-lg">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Top Players</h2>
            <Link href="/leagues" className="text-xs text-primary flex items-center gap-1 hover:underline">
              All <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y divide-border">
            {topLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-5 py-3 flex items-center gap-3 animate-pulse">
                  <div className="w-6 h-4 bg-muted rounded" />
                  <div className="flex-1 h-4 bg-muted rounded" />
                  <div className="w-10 h-4 bg-muted rounded" />
                </div>
              ))
            ) : topPlayers?.length ? (
              topPlayers.map((player, idx) => (
                <motion.div
                  key={player.playerId}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="px-5 py-3 flex items-center gap-3 hover:bg-accent/50 transition-colors"
                >
                  <span className="text-xs font-bold text-muted-foreground w-5 tabular-nums">#{idx + 1}</span>
                  <Link href={`/players/${player.playerId}`} className="flex-1 text-sm font-medium text-foreground hover:text-primary transition-colors">
                    {player.name}
                  </Link>
                  <div className="text-right">
                    <div className="text-xs font-bold text-primary tabular-nums">{Math.round(player.winRate * 100)}%</div>
                    <div className="text-[11px] text-muted-foreground">{player.wins}W {player.losses}L</div>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">No players yet</div>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="lg:col-span-2 bg-card border border-card-border rounded-lg">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Recent Activity</h2>
            <Link href="/my-matches" className="text-xs text-primary flex items-center gap-1 hover:underline">
              All matches <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y divide-border">
            {actLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-5 py-4 animate-pulse">
                  <div className="h-4 w-48 bg-muted rounded mb-2" />
                  <div className="h-3 w-24 bg-muted rounded" />
                </div>
              ))
            ) : activity?.length ? (
              activity.map((item, idx) => (
                <motion.div
                  key={item.matchId}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.04 }}
                  className="px-5 py-3"
                >
                  <Link href={`/matches/${item.matchId}`} className="block group">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("text-sm font-semibold", item.winnerName === item.player1Name ? "text-primary" : "text-foreground")}>{item.player1Name}</span>
                      <span className="text-xs text-muted-foreground">vs</span>
                      <span className={cn("text-sm font-semibold", item.winnerName === item.player2Name ? "text-primary" : "text-foreground")}>{item.player2Name}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      {item.leagueName && <span className="text-xs text-muted-foreground">{item.leagueName}</span>}
                      {item.completedAt && (
                        <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(item.completedAt), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                    {item.score && (
                      <div className="mt-2 text-xs font-mono text-muted-foreground">{item.score}</div>
                    )}
                    <div className="mt-2">
                      <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full", statusColor(item.status))}>
                        {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                      </span>
                    </div>
                  </Link>
                </motion.div>
              ))
            ) : (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">No activity yet</div>
            )}
          </div>
        </div>
      </div>

      {/* Upcoming matches */}
      {stats?.upcomingMatches && stats.upcomingMatches.length > 0 && (
        <div className="bg-card border border-card-border rounded-lg">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Upcoming Matches</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-0 divide-y divide-border sm:divide-y-0 sm:divide-x">
            {stats.upcomingMatches.map((match) => (
              <Link key={match.id} href={`/matches/${match.id}`} className="block px-5 py-4 hover:bg-accent/40 transition-colors group">
                <div className="text-xs text-muted-foreground mb-1">
                  {match.scheduledAt ? new Date(match.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "TBD"}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">{match.player1Name}</span>
                  <span className="text-xs font-bold text-muted-foreground shrink-0">VS</span>
                  <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">{match.player2Name}</span>
                </div>
                {match.location && <div className="text-xs text-muted-foreground mt-0.5">{match.location}</div>}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

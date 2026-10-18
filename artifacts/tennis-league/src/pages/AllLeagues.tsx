import { useGetLeagues, useDeleteLeague, getGetLeaguesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { Redirect, Link } from "wouter";
import { Trophy, Users, Swords, ArrowRight, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

function statusBadge(status: string) {
  if (status === "active") return "border border-white/20 text-muted-foreground";
  if (status === "upcoming") return "border border-border text-muted-foreground";
  return "border border-border text-muted-foreground";
}

function formatLabel(fmt: string) {
  return fmt === "round_robin" ? "Round Robin" : fmt === "elimination" ? "Elimination" : "Swiss";
}

export default function AllLeagues() {
  const { isLoaded: userLoaded } = useUser();
  const isAdmin = useIsAdmin();
  const { data: leagues, isLoading } = useGetLeagues(undefined, { query: { enabled: userLoaded && isAdmin, queryKey: ["allLeagues"] as any } });
  const deleteLeague = useDeleteLeague();
  const qc = useQueryClient();
  const { toast } = useToast();

  if (userLoaded && !isAdmin) {
    return <Redirect to="/leagues" />;
  }

  const handleDelete = (id: number, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    deleteLeague.mutate({ leagueId: id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetLeaguesQueryKey() });
        toast({ title: "League deleted" });
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-heading text-foreground">All Leagues</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{leagues?.length ?? 0} leagues on the platform</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-card border border-card-border rounded-lg p-5 animate-pulse space-y-3">
              <div className="h-5 w-36 bg-muted rounded" />
              <div className="h-4 w-24 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {leagues?.map((league, idx) => (
            <motion.div
              key={league.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.06 }}
              className="bg-card border border-card-border rounded-lg p-5 hover:border-primary/40 transition-colors group"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/leagues/${league.id}`}
                    className="text-base font-bold text-foreground hover:text-primary transition-colors line-clamp-1 block"
                  >
                    {league.name}
                  </Link>
                  {league.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{league.description}</p>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(league.id, league.name)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mb-4">
                <span className={cn(
                  "text-[11px] font-medium px-2 py-0.5 rounded-full",
                  league.leagueType === "doubles"
                    ? "border border-border text-muted-foreground"
                    : "border border-white/20 text-muted-foreground"
                )}>
                  {league.leagueType === "doubles" ? "Doubles" : "Singles"}
                </span>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full text-muted-foreground border border-border">
                  {formatLabel(league.format)}
                </span>
                <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full", statusBadge(league.status))}>
                  {league.status.charAt(0).toUpperCase() + league.status.slice(1)}
                </span>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Users className="w-3.5 h-3.5" />
                  <span className="font-medium tabular-nums">{league.playerCount}</span>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Swords className="w-3.5 h-3.5" />
                  <span className="font-medium tabular-nums">{league.matchCount}</span>
                </div>
                {league.location && (
                  <div className="text-xs text-muted-foreground/70 truncate flex-1">{league.location}</div>
                )}
              </div>
              {(league.startDate || league.endDate) && (
                <div className="text-xs text-muted-foreground/60 mt-2">
                  {league.startDate && new Date(league.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  {league.endDate && ` — ${new Date(league.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-border">
                <Link
                  href={`/leagues/${league.id}`}
                  className="text-xs text-primary font-medium flex items-center gap-1 hover:underline"
                >
                  Go to league <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </motion.div>
          ))}
          {leagues?.length === 0 && (
            <div className="col-span-full py-16 text-center">
              <Trophy className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No leagues have been created on the platform yet.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

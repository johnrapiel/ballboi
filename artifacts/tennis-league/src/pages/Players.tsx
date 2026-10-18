import { useGetPlayers, useDeletePlayer, getGetPlayersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Users, Search, Trash2, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

function skillBadge(level: string) {
  if (level === "5.0") return "bg-secondary text-secondary-foreground border border-secondary";
  if (level === "4.5") return "bg-warning/15 text-warning border border-warning/25";
  if (level === "4.0") return "bg-primary/15 text-primary border border-primary/25";
  if (level === "3.5") return "bg-info/15 text-info border border-info/25";
  if (level === "3.0") return "bg-success/15 text-success border border-success/25";
  return "bg-muted text-muted-foreground border border-border";
}

export default function Players() {
  const { data: players, isLoading } = useGetPlayers();
  const deletePlayer = useDeletePlayer();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const filtered = (players ?? []).filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = (id: number, name: string) => {
    if (!confirm(`Remove "${name}"?`)) return;
    deletePlayer.mutate({ playerId: id } as any, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPlayersQueryKey() });
        toast({ title: "Player removed" });
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-heading text-foreground">Players</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{filtered.length} players</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="search-players"
              placeholder="Search players..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-48"
            />
          </div>
          <Button asChild data-testid="invite-players-link" className="gap-2">
            <Link href="/leagues">
              <Send className="w-4 h-4" /> Invite Players
            </Link>
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-primary/20 bg-primary/10 p-4">
        <p className="text-sm font-semibold text-foreground">Players join by invite link</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Open a league and share its invite link. A player record is created and linked automatically when that person accepts the invite.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 bg-card border border-card-border rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <Users className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No players found</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Player</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Skill</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">W</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">L</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Win Rate</th>
                  <th className="w-12 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((player, idx) => {
                  const wr = player.wins + player.losses > 0 ? player.wins / (player.wins + player.losses) : 0;
                  return (
                    <motion.tr
                      key={player.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: idx * 0.03 }}
                      className="hover:bg-accent/30 transition-colors group"
                      data-testid={`player-row-${player.id}`}
                    >
                      <td className="px-5 py-3.5">
                        <Link href={`/players/${player.id}`} className="font-semibold text-foreground hover:text-primary transition-colors">
                          {player.name}
                        </Link>
                        {player.dominantHand === "left" && (
                          <span className="ml-2 text-[11px] text-muted-foreground/60">(L)</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center hidden sm:table-cell">
                        <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider", skillBadge(player.skillLevel))}>
                          {player.skillLevel}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center text-primary font-bold tabular-nums">{player.wins}</td>
                      <td className="px-4 py-3.5 text-center text-destructive font-medium tabular-nums">{player.losses}</td>
                      <td className="px-4 py-3.5 hidden md:table-cell">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-muted rounded-full h-1.5 max-w-[80px]">
                            <div className="bg-primary h-1.5 rounded-full" style={{ width: `${Math.round(wr * 100)}%` }} />
                          </div>
                          <span className="text-xs font-bold text-primary tabular-nums w-9 text-right">{Math.round(wr * 100)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <button
                          data-testid={`delete-player-${player.id}`}
                          onClick={() => handleDelete(player.id, player.name)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

    </div>
  );
}

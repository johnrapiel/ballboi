import { useGetMatches, useCreateMatch, useUpdateMatch, useDeleteMatch, getGetMatchesQueryKey, useGetPlayers, useGetLeagues } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearch } from "wouter";
import { formatDisplayScore, validateTennisScore } from "@/lib/tennisScore";
import { Plus, Filter, Trash2, Swords } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const createSchema = z.object({
  player1Id: z.string().min(1, "Required"),
  player2Id: z.string().min(1, "Required"),
  scheduledAt: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  score: z.string().optional(),
  winnerId: z.string().optional(),
});
type CreateData = z.infer<typeof createSchema>;

const scoreSchema = z.object({
  score: z.string().min(1, "Score required"),
  winnerId: z.string().min(1, "Required"),
});
type ScoreData = z.infer<typeof scoreSchema>;

function statusBadge(status: string) {
  if (status === "completed") return "border border-white/20 text-muted-foreground";
  if (status === "scheduled") return "border border-border text-muted-foreground";
  if (status === "in_progress") return "border border-border text-muted-foreground";
  return "border border-border text-muted-foreground";
}

function statusLabel(status: string) {
  if (status === "in_progress") return "In Progress";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  return `${mm}/${dd}/${yy}`;
}

export default function Matches() {
  const { data: players } = useGetPlayers();
  const { data: leagues } = useGetLeagues();
  const search = useSearch();
  const urlLeagueId = new URLSearchParams(search).get("leagueId");
  const contextLeagueId = urlLeagueId ? parseInt(urlLeagueId) : leagues?.[0]?.id;
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [scoreMatchId, setScoreMatchId] = useState<number | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [createScoreError, setCreateScoreError] = useState<string | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const params: Record<string, string | number> = {};
  if (statusFilter && statusFilter !== "all") params.status = statusFilter;

  const { data: matches, isLoading } = useGetMatches(params as any, { query: { queryKey: ["matches", params] as any } });
  const createMatch = useCreateMatch();
  const updateMatch = useUpdateMatch();
  const deleteMatch = useDeleteMatch();

  const form = useForm<CreateData>({
    resolver: zodResolver(createSchema),
    defaultValues: { player1Id: "", player2Id: "", scheduledAt: "", location: "", notes: "", score: "", winnerId: "" },
  });
  const scoreForm = useForm<ScoreData>({
    resolver: zodResolver(scoreSchema),
    defaultValues: { score: "", winnerId: "" },
  });

  const selectedMatch = matches?.find((m) => m.id === scoreMatchId);

  const onSubmit = (data: CreateData) => {
    if (data.score) {
      const winnerSide: "me" | "opponent" = data.winnerId === data.player1Id ? "me" : "opponent";
      const validation = validateTennisScore(data.score, winnerSide);
      if (!validation.valid) {
        setCreateScoreError(validation.error ?? "Invalid score");
        return;
      }
    }
    setCreateScoreError(null);
    createMatch.mutate(
      {
        data: {
          player1Id: parseInt(data.player1Id),
          player2Id: parseInt(data.player2Id),
          leagueId: contextLeagueId,
          scheduledAt: data.scheduledAt || undefined,
          location: data.location || undefined,
          notes: data.notes || undefined,
          score: data.score || undefined,
          winnerId: data.winnerId ? parseInt(data.winnerId) : undefined,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetMatchesQueryKey() });
          toast({ title: "Match scheduled" });
          form.reset();
          setOpen(false);
          setCreateScoreError(null);
        },
        onError: () => toast({ title: "Error scheduling match", variant: "destructive" }),
      }
    );
  };

  const onScoreSubmit = (data: ScoreData) => {
    if (!scoreMatchId || !selectedMatch) return;
    const winnerSide: "me" | "opponent" =
      parseInt(data.winnerId) === selectedMatch.player1Id ? "me" : "opponent";
    const validation = validateTennisScore(data.score, winnerSide);
    if (!validation.valid) {
      setScoreError(validation.error ?? "Invalid score");
      return;
    }
    setScoreError(null);
    updateMatch.mutate(
      {
        matchId: scoreMatchId,
        data: {
          status: "completed",
          winnerId: parseInt(data.winnerId),
          score: data.score,
          completedAt: new Date().toISOString(),
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetMatchesQueryKey() });
          toast({ title: "Score recorded" });
          scoreForm.reset();
          setScoreMatchId(null);
          setScoreError(null);
        },
        onError: () => toast({ title: "Error recording score", variant: "destructive" }),
      }
    );
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this match?")) return;
    deleteMatch.mutate({ matchId: id } as any, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetMatchesQueryKey() });
        toast({ title: "Match deleted" });
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="page-heading text-foreground">Matches</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{matches?.length ?? 0} matches</p>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36" data-testid="filter-status">
              <Filter className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
              <SelectValue placeholder="All status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button data-testid="schedule-match-btn" onClick={() => setOpen(true)} className="gap-2 w-full">
          <Plus className="w-4 h-4" /> Schedule Match
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 bg-card border border-card-border rounded-lg animate-pulse" />)}
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          {!matches?.length ? (
            <div className="py-16 text-center">
              <Swords className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No matches found</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {matches.map((match, idx) => (
                <motion.div
                  key={match.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.02 }}
                  className="px-5 py-4 flex items-center gap-3 hover:bg-accent/20 transition-colors group min-h-[64px]"
                  data-testid={`match-row-${match.id}`}
                >
                  {/* Full-width two-row layout */}
                  <div className="flex-1 min-w-0">
                    {/* Row 1: names */}
                    <Link href={`/matches/${match.id}`} className="flex items-center gap-1.5 min-w-0">
                      <span className={cn("font-semibold text-sm truncate min-w-0", match.winnerId === match.player1Id ? "text-primary" : "text-foreground")}>
                        {match.player1Name}
                      </span>
                      <span className="text-[11px] font-bold text-muted-foreground shrink-0">vs</span>
                      <span className={cn("font-semibold text-sm truncate min-w-0", match.winnerId === match.player2Id ? "text-primary" : "text-foreground")}>
                        {match.player2Name}
                      </span>
                    </Link>

                    {/* Row 2: date/location + status pill right */}
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                        {match.scheduledAt && (
                          <span className="shrink-0">{fmtDate(match.scheduledAt)}</span>
                        )}
                        {match.location && (
                          <span className="truncate">· {match.location}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {match.status === "scheduled" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-6 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => { e.preventDefault(); setScoreMatchId(match.id); scoreForm.reset(); setScoreError(null); }}
                            data-testid={`record-score-${match.id}`}
                          >
                            Record Score
                          </Button>
                        )}
                        <button
                          data-testid={`delete-match-${match.id}`}
                          onClick={(e) => { e.preventDefault(); handleDelete(match.id); }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <span className={cn("text-[10px] font-semibold px-2.5 py-0.5 rounded-full uppercase tracking-wider border", statusBadge(match.status))}>
                          {statusLabel(match.status)}
                        </span>
                      </div>
                    </div>
                    {/* Row 3: score */}
                    {match.score && (
                      <div className="mt-1">
                        <span className="text-xs font-mono text-muted-foreground">{formatDisplayScore(match.score)}</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { form.reset(); setCreateScoreError(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Schedule Match</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="player1Id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Player 1</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger data-testid="select-player1"><SelectValue placeholder="Select..." /></SelectTrigger></FormControl>
                      <SelectContent>
                        {players?.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="player2Id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Player 2</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger data-testid="select-player2"><SelectValue placeholder="Select..." /></SelectTrigger></FormControl>
                      <SelectContent>
                        {players?.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="scheduledAt" render={({ field }) => (
                <FormItem>
                  <FormLabel>Date & Time</FormLabel>
                  <FormControl><Input type="datetime-local" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="location" render={({ field }) => (
                <FormItem>
                  <FormLabel>Location</FormLabel>
                  <FormControl><Input placeholder="Court name" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="score" render={({ field }) => (
                <FormItem>
                  <FormLabel>Score <span className="text-muted-foreground font-normal">(optional — if already played)</span></FormLabel>
                  <FormControl>
                    <Input
                      data-testid="create-input-score"
                      placeholder="e.g. 6-4, 3-6, 6-3"
                      className={createScoreError ? "border-destructive focus-visible:ring-destructive" : ""}
                      {...field}
                      onChange={(e) => { field.onChange(e); setCreateScoreError(null); }}
                    />
                  </FormControl>
                  {createScoreError ? (
                    <p className="text-[11px] text-destructive mt-1" data-testid="create-score-error">{createScoreError}</p>
                  ) : (
                    <FormMessage />
                  )}
                </FormItem>
              )} />
              <FormField control={form.control} name="winnerId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Winner <span className="text-muted-foreground font-normal">(required if score entered)</span></FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl><SelectTrigger data-testid="create-select-winner"><SelectValue placeholder="Select winner..." /></SelectTrigger></FormControl>
                    <SelectContent>
                      {form.watch("player1Id") && (
                        <SelectItem value={form.watch("player1Id")}>
                          {players?.find((p) => String(p.id) === form.watch("player1Id"))?.name ?? "Player 1"}
                        </SelectItem>
                      )}
                      {form.watch("player2Id") && (
                        <SelectItem value={form.watch("player2Id")}>
                          {players?.find((p) => String(p.id) === form.watch("player2Id"))?.name ?? "Player 2"}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              {contextLeagueId && (
                <div className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
                  League: <span className="font-semibold text-foreground">
                    {leagues?.find((l) => l.id === contextLeagueId)?.name ?? "—"}
                  </span>
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setOpen(false); form.reset(); setCreateScoreError(null); }}>Cancel</Button>
                <Button type="submit" data-testid="submit-match" disabled={createMatch.isPending}>
                  {createMatch.isPending ? "Scheduling..." : "Schedule"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!scoreMatchId} onOpenChange={() => { setScoreMatchId(null); scoreForm.reset(); setScoreError(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Score</DialogTitle>
            {selectedMatch && (
              <p className="text-sm text-muted-foreground mt-1">{selectedMatch.player1Name} vs {selectedMatch.player2Name}</p>
            )}
          </DialogHeader>
          <Form {...scoreForm}>
            <form onSubmit={scoreForm.handleSubmit(onScoreSubmit)} className="space-y-4">
              <FormField control={scoreForm.control} name="score" render={({ field }) => (
                <FormItem>
                  <FormLabel>Score</FormLabel>
                  <FormControl>
                    <Input
                      data-testid="input-score"
                      placeholder="e.g. 6-4, 3-6, 6-3"
                      className={scoreError ? "border-destructive focus-visible:ring-destructive" : ""}
                      {...field}
                      onChange={(e) => { field.onChange(e); setScoreError(null); }}
                    />
                  </FormControl>
                  {scoreError ? (
                    <p className="text-[11px] text-destructive mt-1">{scoreError}</p>
                  ) : (
                    <FormMessage />
                  )}
                </FormItem>
              )} />
              <FormField control={scoreForm.control} name="winnerId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Winner</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger data-testid="select-winner"><SelectValue placeholder="Select winner..." /></SelectTrigger></FormControl>
                    <SelectContent>
                      {selectedMatch && (
                        <>
                          <SelectItem value={String(selectedMatch.player1Id)}>{selectedMatch.player1Name}</SelectItem>
                          <SelectItem value={String(selectedMatch.player2Id)}>{selectedMatch.player2Name}</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setScoreMatchId(null); scoreForm.reset(); }}>Cancel</Button>
                <Button type="submit" data-testid="submit-score" disabled={updateMatch.isPending}>
                  {updateMatch.isPending ? "Saving..." : "Record"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useGetLeagues, useCreateLeague, useDeleteLeague, getGetLeaguesQueryKey, useGetCurrentLeagueRound } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useUser } from "@clerk/react";
import { Link } from "wouter";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Plus, Trophy, Users, Swords, ArrowRight, Trash2 } from "lucide-react";
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

const schema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  format: z.enum(["round_robin", "elimination", "swiss"]),
  status: z.enum(["active", "upcoming", "completed"]),
  leagueType: z.enum(["singles", "doubles"]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  location: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

function statusBadge(status: string) {
  if (status === "active") return "border border-white/20 text-muted-foreground";
  if (status === "upcoming") return "border border-border text-muted-foreground";
  return "border border-border text-muted-foreground";
}

function formatLabel(fmt: string) {
  return fmt === "round_robin" ? "Round Robin" : fmt === "elimination" ? "Elimination" : "Swiss";
}

function LeagueRoundProgress({ leagueId }: { leagueId: number }) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: round } = useGetCurrentLeagueRound(leagueId, {
    query: { queryKey: ["currentRound", leagueId] as any, retry: false },
  });
  if (!round || round.endDate < today) return null;
  const total = round.matchups.length;
  if (total === 0) return null;
  const arranged = round.matchups.filter((m) => m.scheduledAt).length;
  const pct = Math.round((arranged / total) * 100);
  return (
    <div className="h-1 bg-border overflow-hidden rounded-b-lg">
      <div
        className={cn("h-full transition-all duration-500", pct > 0 ? "bg-primary" : "bg-muted")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function Leagues() {
  const { user, isLoaded: userLoaded } = useUser();
  const isAdmin = useIsAdmin();
  const clerkUserId = user?.id;
  const { data: leagues, isLoading } = useGetLeagues(
    clerkUserId ? { clerkUserId } : undefined,
    { query: { enabled: userLoaded, queryKey: ["leagues", clerkUserId] as any } }
  );
  const createLeague = useCreateLeague();
  const deleteLeague = useDeleteLeague();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", description: "", format: "round_robin", status: "active", leagueType: "singles", startDate: "", endDate: "", location: "" },
  });

  const onSubmit = (data: FormData) => {
    createLeague.mutate(
      {
        data: {
          ...data,
          leagueType: data.leagueType,
          description: data.description || undefined,
          startDate: data.startDate || undefined,
          endDate: data.endDate || undefined,
          location: data.location || undefined,
          createdByClerkUserId: clerkUserId ?? undefined,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetLeaguesQueryKey() });
          toast({ title: "League created" });
          form.reset();
          setOpen(false);
        },
        onError: () => toast({ title: "Error creating league", variant: "destructive" }),
      }
    );
  };

  const handleDelete = (id: number, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    deleteLeague.mutate({ leagueId: id } as any, {
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
          <h1 className="page-heading text-foreground">{isAdmin ? "My Leagues" : "Leagues"}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{leagues?.length ?? 0} leagues</p>
        </div>
        <Button data-testid="create-league-btn" onClick={() => setOpen(true)} className="gap-2">
          <Plus className="w-4 h-4" /> New League
        </Button>
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
              className="bg-card border border-card-border rounded-lg hover:border-primary/40 transition-colors group overflow-hidden"
            >
              <div className="p-5">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/leagues/${league.id}`}
                      data-testid={`league-name-${league.id}`}
                      className="text-base font-bold text-foreground hover:text-primary transition-colors line-clamp-1 block"
                    >
                      {league.name}
                    </Link>
                    {league.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{league.description}</p>}
                  </div>
                  <button
                    data-testid={`delete-league-${league.id}`}
                    onClick={() => handleDelete(league.id, league.name)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                  <span className={cn(
                    "text-[10px] font-medium px-2 py-0.5 rounded-full",
                    league.leagueType === "doubles"
                      ? "border border-border text-muted-foreground"
                      : "border border-white/20 text-muted-foreground"
                  )}>
                    {league.leagueType === "doubles" ? "Doubles" : "Singles"}
                  </span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full text-muted-foreground border border-border">
                    {formatLabel(league.format)}
                  </span>
                  <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", statusBadge(league.status))}>
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
                    data-testid={`view-league-${league.id}`}
                    className="text-xs text-primary font-medium flex items-center gap-1 hover:underline"
                  >
                    Go to league <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
              {isAdmin && <LeagueRoundProgress leagueId={league.id} />}
            </motion.div>
          ))}
          {leagues?.length === 0 && (
            <div className="col-span-full py-16 text-center">
              <Trophy className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No leagues yet. Create one or join via an invite link.</p>
            </div>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create League</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl><Input data-testid="input-league-name" placeholder="Summer Open 2025" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl><Input placeholder="Optional" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="leagueType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => field.onChange("singles")}
                      className={cn(
                        "flex-1 py-2 px-3 rounded-md border text-sm font-semibold transition-colors",
                        field.value === "singles"
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-border/80"
                      )}
                    >
                      Singles
                    </button>
                    <button
                      type="button"
                      onClick={() => field.onChange("doubles")}
                      className={cn(
                        "flex-1 py-2 px-3 rounded-md border text-sm font-semibold transition-colors",
                        field.value === "doubles"
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-border/80"
                      )}
                    >
                      Doubles
                    </button>
                  </div>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="format" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Format</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger data-testid="select-format"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="round_robin">Round Robin</SelectItem>
                        <SelectItem value="elimination">Elimination</SelectItem>
                        <SelectItem value="swiss">Swiss</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="upcoming">Upcoming</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="startDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="endDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="location" render={({ field }) => (
                <FormItem>
                  <FormLabel>Location</FormLabel>
                  <FormControl><Input placeholder="Venue name" {...field} /></FormControl>
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="submit-league" disabled={createLeague.isPending}>
                  {createLeague.isPending ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useGetMatches, useCreateMatch, useGetPlayers, useGetLeagues, getGetMatchesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Plus, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
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
  player1Id: z.string().min(1, "Required"),
  player2Id: z.string().min(1, "Required"),
  leagueId: z.string().optional(),
  scheduledAt: z.string().min(1, "Date required"),
  location: z.string().optional(),
  notes: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

function statusBadge(status: string) {
  if (status === "completed") return "bg-primary/10 text-primary border border-primary/20";
  if (status === "scheduled") return "bg-blue-400/10 text-blue-400 border border-blue-400/20";
  return "bg-red-400/10 text-red-400 border border-red-400/20";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Schedule() {
  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: matches, isLoading } = useGetMatches();
  const { data: players } = useGetPlayers();
  const { data: leagues } = useGetLeagues();
  const createMatch = useCreateMatch();

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { player1Id: "", player2Id: "", leagueId: "", scheduledAt: "", location: "", notes: "" },
  });

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const matchesByDay: Record<number, typeof matches> = {};
  for (const m of matches ?? []) {
    if (!m.scheduledAt) continue;
    const d = new Date(m.scheduledAt);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      if (!matchesByDay[day]) matchesByDay[day] = [];
      matchesByDay[day]!.push(m);
    }
  }

  const onSubmit = (data: FormData) => {
    createMatch.mutate(
      {
        data: {
          player1Id: parseInt(data.player1Id),
          player2Id: parseInt(data.player2Id),
          leagueId: (data.leagueId && data.leagueId !== "none") ? parseInt(data.leagueId) : undefined,
          scheduledAt: data.scheduledAt,
          location: data.location || undefined,
          notes: data.notes || undefined,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetMatchesQueryKey() });
          toast({ title: "Match scheduled" });
          form.reset();
          setOpen(false);
        },
        onError: () => toast({ title: "Error", variant: "destructive" }),
      }
    );
  };

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-heading text-foreground">Schedule</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Match calendar</p>
        </div>
        <Button data-testid="schedule-match-btn" onClick={() => setOpen(true)} className="gap-2">
          <Plus className="w-4 h-4" /> Schedule Match
        </Button>
      </div>

      {/* Calendar */}
      <div className="bg-card border border-card-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <button data-testid="prev-month" onClick={prevMonth} className="p-1.5 rounded hover:bg-accent text-muted-foreground transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-bold text-foreground">{MONTHS[month]} {year}</h2>
          <button data-testid="next-month" onClick={nextMonth} className="p-1.5 rounded hover:bg-accent text-muted-foreground transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-4 px-5 py-2 border-b border-border bg-muted/20">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-blue-400" />
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Scheduled</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-primary" />
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Completed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Cancelled</span>
          </div>
        </div>
        <div className="grid grid-cols-7">
          {DAYS.map((d) => (
            <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider py-2.5 border-b border-border">
              {d}
            </div>
          ))}
          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`empty-${i}`} className="border-b border-r border-border min-h-[80px]" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const isToday = today.getDate() === day && today.getMonth() === month && today.getFullYear() === year;
            const dayMatches = matchesByDay[day] ?? [];
            const hasMatches = dayMatches.length > 0;
            return (
              <div
                key={day}
                className={cn(
                  "border-b border-r border-border min-h-[80px] p-1.5",
                  isToday && "bg-primary/5",
                  hasMatches && !isToday && "bg-primary/[0.03]"
                )}
              >
                <div className={cn(
                  "text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full mb-1",
                  isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                )}>
                  {day}
                </div>

                {/* Match dot indicators */}
                {hasMatches && (
                  <div className="flex gap-0.5 flex-wrap mb-1 px-0.5">
                    {dayMatches.slice(0, 4).map((m, dotIdx) => (
                      <div
                        key={dotIdx}
                        title={`${m.player1Name} v ${m.player2Name} (${m.status})`}
                        className={cn(
                          "w-1.5 h-1.5 rounded-full shrink-0",
                          m.status === "completed" ? "bg-primary" :
                          m.status === "scheduled" ? "bg-blue-400" :
                          "bg-red-400"
                        )}
                      />
                    ))}
                    {dayMatches.length > 4 && (
                      <span className="text-[8px] text-muted-foreground leading-none self-center">+{dayMatches.length - 4}</span>
                    )}
                  </div>
                )}

                <div className="space-y-0.5">
                  {dayMatches.slice(0, 2).map((m) => (
                    <Link
                      key={m.id}
                      href={`/matches/${m.id}`}
                      className={cn(
                        "block text-[10px] font-medium px-1 py-0.5 rounded truncate leading-tight transition-opacity hover:opacity-80",
                        m.status === "completed"
                          ? "bg-primary/15 text-primary"
                          : m.status === "scheduled"
                          ? "bg-blue-400/15 text-blue-400"
                          : "bg-red-400/15 text-red-400"
                      )}
                    >
                      {m.player1Name.split(" ")[0]} v {m.player2Name.split(" ")[0]}
                    </Link>
                  ))}
                  {dayMatches.length > 2 && (
                    <div className="text-[10px] text-muted-foreground/60 pl-1">+{dayMatches.length - 2} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Upcoming list */}
      <div className="bg-card border border-card-border rounded-lg">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Scheduled Matches</h2>
        </div>
        {isLoading ? (
          <div className="p-5 animate-pulse space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 bg-muted rounded" />)}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {matches?.filter((m) => m.status === "scheduled").length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">No matches scheduled</div>
            ) : (
              matches?.filter((m) => m.status === "scheduled")
                .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""))
                .map((match, idx) => (
                  <motion.div
                    key={match.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.04 }}
                  >
                    <Link
                      href={`/matches/${match.id}`}
                      data-testid={`schedule-match-${match.id}`}
                      className="flex items-center gap-4 px-5 py-3.5 hover:bg-accent/30 transition-colors"
                    >
                      <div className="w-14 text-center shrink-0">
                        {match.scheduledAt && (
                          <>
                            <div className="text-xs font-bold text-primary">{new Date(match.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                            <div className="text-[10px] text-muted-foreground">{new Date(match.scheduledAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</div>
                          </>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-foreground">
                          {match.player1Name} <span className="text-muted-foreground font-normal text-xs">vs</span> {match.player2Name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {match.leagueName && <span>{match.leagueName}</span>}
                          {match.location && <span> · {match.location}</span>}
                        </div>
                      </div>
                      <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0", statusBadge(match.status))}>
                        {match.status}
                      </span>
                    </Link>
                  </motion.div>
                ))
            )}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Schedule Match</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="player1Id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Player 1</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger></FormControl>
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
                      <FormControl><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger></FormControl>
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
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="leagueId" render={({ field }) => (
                <FormItem>
                  <FormLabel>League (optional)</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="No league" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="none">No league</SelectItem>
                      {leagues?.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="location" render={({ field }) => (
                <FormItem>
                  <FormLabel>Location</FormLabel>
                  <FormControl><Input placeholder="Court name" {...field} /></FormControl>
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMatch.isPending}>
                  {createMatch.isPending ? "Scheduling..." : "Schedule"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

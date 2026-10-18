import { useState, useEffect } from "react";
import { useAuth } from "@clerk/react";
import { useGetLeagues } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { apiFetch, getWeekOf, formatWeekRange } from "@/lib/scheduleApi";
import { cn } from "@/lib/utils";
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, CheckCircle, Plus, Swords, MapPin, CheckCircle2, XCircle, Bell, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ScheduleMatch {
  id: number; player1Id: number; player2Id: number;
  player1Name: string; player2Name: string;
  scheduledAt?: string; location?: string | null;
  status: string; weekOf?: string;
}

interface ScheduleLog {
  id: number; status: string; generatedAt: string; matchesGenerated: number;
  regenerationCount?: number; confirmedAt?: string;
  stats?: { timeSlotsAnalyzed: number; playersWithAvailability: number; pairsConsidered: number; rematches_skipped: number };
}

interface PlayerParticipation {
  id: number;
  name: string;
  skillLevel: string;
  hasSubmitted: boolean;
  slotCount: number;
}

interface AvailabilityReminderSummary {
  id: number;
  sentAt: string;
  countSent: number;
  missingCount: number;
}

type ParticipationFilter = "all" | "submitted" | "missing";

function fmtDateTime(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatRelativeTime(iso?: string) {
  if (!iso) return "";

  const elapsedMs = Date.now() - new Date(iso).getTime();
  const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60000));

  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes} minute${elapsedMinutes !== 1 ? "s" : ""} ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} hour${elapsedHours !== 1 ? "s" : ""} ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} day${elapsedDays !== 1 ? "s" : ""} ago`;
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "confirmed"
    ? "bg-primary/10 text-primary border-primary/20"
    : status === "pending_review"
    ? "bg-warning/10 text-warning border-warning/20"
    : "bg-muted/30 text-muted-foreground border-border";
  return (
    <span className={cn("text-[11px] font-semibold px-2.5 py-0.5 rounded-full border uppercase tracking-wider", cls)}>
      {status === "pending_review" ? "Pending Review" : status}
    </span>
  );
}

const RECOMMENDED_SLOT_COUNT = 6;

function getSlotCountSummary(slotCount: number) {
  const progress = Math.min(100, Math.round((slotCount / RECOMMENDED_SLOT_COUNT) * 100));

  if (slotCount >= RECOMMENDED_SLOT_COUNT) {
    return {
      label: "Strong",
      badgeClass: "bg-success/10 text-success border-success/30",
      barClass: "bg-success",
      progress,
    };
  }

  if (slotCount >= 3) {
    return {
      label: "Moderate",
      badgeClass: "bg-warning/10 text-warning border-warning/30",
      barClass: "bg-warning",
      progress,
    };
  }

  return {
    label: "Very few",
    badgeClass: "bg-destructive/10 text-destructive border-destructive/30",
    barClass: "bg-destructive",
    progress,
  };
}

export default function ScheduleReview() {
  const { getToken } = useAuth();
  const { data: leagues } = useGetLeagues();
  const { toast } = useToast();

  const [leagueId, setLeagueId] = useState<number | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const weekOf = getWeekOf(weekOffset);

  const [log, setLog] = useState<ScheduleLog | null>(null);
  const [matches, setMatches] = useState<ScheduleMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [participation, setParticipation] = useState<PlayerParticipation[]>([]);
  const [lastReminder, setLastReminder] = useState<AvailabilityReminderSummary | null>(null);
  const [reminderCooldownHours, setReminderCooldownHours] = useState(6);
  const [reminding, setReminding] = useState(false);
  const [participationFilter, setParticipationFilter] = useState<ParticipationFilter>("all");

  useEffect(() => {
    if (leagues?.length && !leagueId) setLeagueId(leagues[0].id);
  }, [leagues]);

  const loadSchedule = async (lid: number, wof: string) => {
    setLoading(true);
    const token = await getToken();
    const [schedRes, partRes] = await Promise.all([
      apiFetch(`/scheduling/${lid}/${wof}`, token),
      apiFetch(`/availability/participation/${lid}/${wof}`, token),
    ]);
    if (schedRes.ok) {
      const data = await schedRes.json();
      setLog(data.log);
      setMatches(data.matches ?? []);
    }
    if (partRes.ok) {
      const data = await partRes.json();
      if (Array.isArray(data)) {
        setParticipation(data);
        setLastReminder(null);
      } else {
        setParticipation(data.players ?? []);
        setLastReminder(data.lastReminder ?? null);
        setReminderCooldownHours(data.reminderCooldownHours ?? 6);
      }
    } else {
      setParticipation([]);
      setLastReminder(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (leagueId) loadSchedule(leagueId, weekOf);
  }, [leagueId, weekOf]);

  const handleGenerate = async () => {
    if (!leagueId) return;
    setWorking(true);
    const token = await getToken();
    const res = await apiFetch(`/scheduling/${leagueId}/generate`, token, {
      method: "POST",
      body: JSON.stringify({ weekOf }),
    });
    if (res.ok) {
      const data = await res.json();
      toast({ title: `Schedule generated — ${data.matchesGenerated} matches` });
      await loadSchedule(leagueId, weekOf);
    } else {
      toast({ title: "Failed to generate schedule", variant: "destructive" });
    }
    setWorking(false);
  };

  const handleRegenerate = async () => {
    if (!leagueId) return;
    setWorking(true);
    const token = await getToken();
    const res = await apiFetch(`/scheduling/${leagueId}/regenerate`, token, {
      method: "POST",
      body: JSON.stringify({ weekOf }),
    });
    if (res.ok) {
      const data = await res.json();
      toast({ title: `Regenerated — ${data.matchesGenerated} matches (attempt ${data.regenerationCount})` });
      await loadSchedule(leagueId, weekOf);
    } else {
      toast({ title: "Failed to regenerate", variant: "destructive" });
    }
    setWorking(false);
  };

  const handleConfirm = async () => {
    if (!leagueId) return;
    setWorking(true);
    const token = await getToken();
    const res = await apiFetch(`/scheduling/${leagueId}/confirm`, token, {
      method: "POST",
      body: JSON.stringify({ weekOf }),
    });
    if (res.ok) {
      toast({ title: "Schedule confirmed — players notified" });
      await loadSchedule(leagueId, weekOf);
    } else {
      toast({ title: "Failed to confirm", variant: "destructive" });
    }
    setWorking(false);
  };

  const handleRemind = async () => {
    if (!leagueId) return;
    setReminding(true);
    const token = await getToken();
    const res = await apiFetch(`/availability/remind/${leagueId}/${weekOf}`, token, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      if (data.lastReminder) setLastReminder(data.lastReminder);
      const msg = data.notified > 0
        ? `Reminded ${data.notified} player${data.notified !== 1 ? "s" : ""} via push notification`
        : `${data.missingCount} player${data.missingCount !== 1 ? "s" : ""} haven't submitted — no push subscriptions found`;
      toast({ title: msg });
      await loadSchedule(leagueId, weekOf);
    } else {
      const data = await res.json().catch(() => null);
      if (data?.lastReminder) setLastReminder(data.lastReminder);
      toast({
        title: res.status === 409 ? "Reminders were already sent recently" : "Failed to send reminders",
        description: res.status === 409 && data?.lastReminder
          ? `Last reminded ${formatRelativeTime(data.lastReminder.sentAt)}. Try again after ${data.reminderCooldownHours ?? reminderCooldownHours} hours.`
          : undefined,
        variant: "destructive",
      });
    }
    setReminding(false);
  };

  const isConfirmed = log?.status === "confirmed";
  const submittedCount = participation.filter((p) => p.hasSubmitted).length;
  const missingCount = participation.filter((p) => !p.hasSubmitted).length;
  const filteredParticipation = participation
    .filter((player) => {
      if (participationFilter === "submitted") return player.hasSubmitted;
      if (participationFilter === "missing") return !player.hasSubmitted;
      return true;
    })
    .sort((a, b) => {
      if (a.hasSubmitted !== b.hasSubmitted) return a.hasSubmitted ? -1 : 1;
      return b.slotCount - a.slotCount;
    });
  const participationFilters: { value: ParticipationFilter; label: string; count: number }[] = [
    { value: "all", label: "All", count: participation.length },
    { value: "submitted", label: "Submitted", count: submittedCount },
    { value: "missing", label: "Missing", count: missingCount },
  ];
  const reminderInCooldown = lastReminder
    ? Date.now() - new Date(lastReminder.sentAt).getTime() < reminderCooldownHours * 60 * 60 * 1000
    : false;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-heading text-foreground">Schedule Review</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Review and confirm auto-generated weekly matches</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset(w => w - 1)} className="p-1.5 rounded hover:bg-accent text-muted-foreground transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-sm font-semibold text-foreground text-center min-w-[150px]">
            <CalendarDays className="w-4 h-4 inline mr-1.5 text-primary" />
            {formatWeekRange(weekOf)}
          </div>
          <button onClick={() => setWeekOffset(w => w + 1)} className="p-1.5 rounded hover:bg-accent text-muted-foreground transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* League selector */}
      {leagues && leagues.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">League:</span>
          <select value={leagueId ?? ""} onChange={(e) => setLeagueId(Number(e.target.value))}
            className="text-sm px-3 py-1.5 rounded-md bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
            {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      )}

      {/* Status + actions */}
      <div className="bg-card border border-card-border rounded-lg p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-3">
            <Swords className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground uppercase tracking-wider">
              Week of {weekOf}
            </span>
            {log && <StatusBadge status={log.status} />}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!log ? (
              <Button onClick={handleGenerate} disabled={working} className="gap-2">
                <Plus className="w-4 h-4" />
                {working ? "Generating..." : "Generate Schedule"}
              </Button>
            ) : (
              <>
                {!isConfirmed && (
                  <>
                    <Button variant="outline" onClick={handleRegenerate} disabled={working} className="gap-2">
                      <RefreshCw className="w-4 h-4" />
                      {working ? "Regenerating..." : "Regenerate"}
                    </Button>
                    <Button onClick={handleConfirm} disabled={working || matches.length === 0} className="gap-2">
                      <CheckCircle className="w-4 h-4" />
                      {working ? "Confirming..." : "Confirm Schedule"}
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Stats */}
        {log?.stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-border">
            {[
              { label: "Matches", value: log.matchesGenerated },
              { label: "Time slots", value: log.stats.timeSlotsAnalyzed },
              { label: "Players", value: log.stats.playersWithAvailability },
              { label: "Rematches skipped", value: log.stats.rematches_skipped },
            ].map(({ label, value }) => (
              <div key={label} className="text-center">
                <div className="text-xl font-extrabold text-foreground">{value}</div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</div>
              </div>
            ))}
          </div>
        )}

        {log?.confirmedAt && (
          <div className="mt-3 text-xs text-muted-foreground pt-3 border-t border-border">
            Confirmed {fmtDateTime(log.confirmedAt)}
          </div>
        )}
      </div>

      {/* Matches list */}
      {loading ? (
        <div className="space-y-2 animate-pulse">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-card border border-card-border rounded-lg" />)}</div>
      ) : matches.length === 0 ? (
        <div className="bg-card border border-card-border rounded-lg py-16 text-center">
          <Swords className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {log ? "No matches generated for this week." : "No schedule generated yet. Click Generate Schedule to create matches based on player availability."}
          </p>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {matches.length} match{matches.length !== 1 ? "es" : ""}
            </span>
          </div>
          <div className="divide-y divide-border">
            {matches.map((match, idx) => (
              <motion.div key={match.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.03 }}
                className="px-5 py-4 hover:bg-accent/20 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/players/${match.player1Id}`}
                        className="font-semibold text-sm text-foreground hover:text-primary transition-colors">
                        {match.player1Name}
                      </Link>
                      <span className="text-[11px] font-bold text-muted-foreground">vs</span>
                      <Link href={`/players/${match.player2Id}`}
                        className="font-semibold text-sm text-foreground hover:text-primary transition-colors">
                        {match.player2Name}
                      </Link>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {fmtDateTime(match.scheduledAt)}
                    </div>
                    {match.location && (
                      <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                        <MapPin className="w-3 h-3 shrink-0" />
                        {match.location}
                      </div>
                    )}
                  </div>
                  <Link href={`/matches/${match.id}`}
                    className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full border uppercase tracking-wider bg-info/10 text-info border-info/20 shrink-0 hover:bg-info/20 transition-colors">
                    View
                  </Link>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Availability Participation Panel */}
      {participation.length > 0 && (
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Availability Participation
              </span>
              <span className="text-xs text-muted-foreground">
                {filteredParticipation.length} player{filteredParticipation.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center rounded-md border border-border bg-muted/20 p-0.5">
              {participationFilters.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setParticipationFilter(filter.value)}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs font-semibold transition-colors",
                    participationFilter === filter.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                  )}
                >
                  {filter.label} ({filter.count})
                </button>
              ))}
            </div>
            <span
              className="text-[11px] text-muted-foreground"
              title="Slot count quality: red for 1–2 slots, yellow for 3–5, green for 6 or more."
            >
              Slot quality: 1–2 few · 3–5 moderate · 6+ strong
            </span>
            {missingCount > 0 && (
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {lastReminder && (
                  <span className={cn("text-xs", reminderInCooldown ? "text-warning" : "text-muted-foreground")}>
                    Last reminded {formatRelativeTime(lastReminder.sentAt)}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRemind}
                  disabled={reminding || reminderInCooldown}
                  title={reminderInCooldown ? `Reminders can be sent once every ${reminderCooldownHours} hours` : undefined}
                  className="gap-1.5 text-xs h-7"
                >
                  <Bell className="w-3 h-3" />
                  {reminding ? "Sending..." : reminderInCooldown ? "Recently Reminded" : `Remind ${missingCount} Missing`}
                </Button>
              </div>
            )}
          </div>
          <div className="divide-y divide-border">
            {filteredParticipation.length === 0 && (
              <div className="py-10 text-center">
                <Users className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {participationFilter === "submitted"
                    ? "No players have submitted availability yet this week."
                    : participationFilter === "missing"
                    ? "No missing players this week — everyone has submitted."
                    : "No players found."}
                </p>
              </div>
            )}
            {filteredParticipation
              .map((player) => {
                const slotSummary = getSlotCountSummary(player.slotCount);

                return (
                  <div key={player.id} className="px-5 py-2.5 flex items-center justify-between gap-3 hover:bg-accent/10 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {player.hasSubmitted ? (
                        <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-muted-foreground/50 shrink-0" />
                      )}
                      <span className={cn("text-sm font-medium truncate", !player.hasSubmitted && "text-muted-foreground")}>
                        {player.name}
                      </span>
                      {player.skillLevel && (
                        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground shrink-0">
                          {player.skillLevel}
                        </span>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      {player.hasSubmitted ? (
                        <div
                          className="flex flex-col items-end gap-1"
                          title={`${slotSummary.label}: ${player.slotCount} submitted slot${player.slotCount !== 1 ? "s" : ""}. Green starts at 6 or more slots.`}
                        >
                          <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full border", slotSummary.badgeClass)}>
                            {player.slotCount} slot{player.slotCount !== 1 ? "s" : ""}
                          </span>
                          <div className="w-24 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                            <div
                              className={cn("h-full rounded-full", slotSummary.barClass)}
                              style={{ width: `${slotSummary.progress}%` }}
                            />
                          </div>
                          <span className="text-[11px] text-muted-foreground">{slotSummary.label}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Not submitted</span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Timeline info */}
      <div className="bg-card border border-card-border rounded-lg px-5 py-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Weekly Timeline</div>
        <div className="space-y-1.5 text-xs text-muted-foreground">
          {[
            ["Mon–Wed 11:59 PM", "Player availability window open"],
            ["Thu 9:00 AM", "Schedule auto-generated, admin notified"],
            ["Thu–Fri 5:00 PM", "Admin reviews and confirms schedule"],
            ["Fri 6:00 PM", "Players notified via push notification"],
            ["Sat–Sun", "Matches played, players record results"],
          ].map(([time, desc]) => (
            <div key={time} className="flex items-start gap-3">
              <span className="font-mono text-primary w-36 shrink-0">{time}</span>
              <span>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

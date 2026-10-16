import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/react";
import { useGetLeagues } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { apiFetch, getWeekOf, formatWeekRange, DAYS, HOURS, hourLabel } from "@/lib/scheduleApi";
import { CalendarDays, ChevronLeft, ChevronRight, Check } from "lucide-react";

interface Slot { dayOfWeek: number; hour: number; }

export default function Availability() {
  const { getToken } = useAuth();
  const { data: leagues } = useGetLeagues();
  const { toast } = useToast();

  const [leagueId, setLeagueId] = useState<number | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const weekOf = getWeekOf(weekOffset);

  const [slots, setSlots] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<boolean | null>(null); // true=adding, false=removing

  useEffect(() => {
    if (leagues?.length && !leagueId) setLeagueId(leagues[0].id);
  }, [leagues]);

  // Load existing availability when league/week changes
  useEffect(() => {
    if (!leagueId) return;
    setLoading(true);
    getToken().then((token) => {
      apiFetch(`/availability/me/${leagueId}/${weekOf}`, token).then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          const loaded: Set<string> = new Set();
          for (const s of (data.slots ?? [])) {
            loaded.add(`${s.dayOfWeek}:${s.hour}`);
          }
          setSlots(loaded);
        }
        setLoading(false);
      });
    });
  }, [leagueId, weekOf]);

  const slotKey = (d: number, h: number) => `${d}:${h}`;

  const toggleSlot = useCallback((d: number, h: number) => {
    const key = slotKey(d, h);
    setSlots((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const handleMouseDown = (d: number, h: number) => {
    const key = slotKey(d, h);
    const adding = !slots.has(key);
    setDragging(adding);
    setSlots((prev) => {
      const next = new Set(prev);
      if (adding) next.add(key); else next.delete(key);
      return next;
    });
  };

  const handleMouseEnter = (d: number, h: number) => {
    if (dragging === null) return;
    const key = slotKey(d, h);
    setSlots((prev) => {
      const next = new Set(prev);
      if (dragging) next.add(key); else next.delete(key);
      return next;
    });
  };

  const handleMouseUp = () => setDragging(null);

  const handleTouchStart = (d: number, h: number, e: React.TouchEvent) => {
    if (isFrozen) return;
    e.preventDefault();
    handleMouseDown(d, h);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (dragging === null || isFrozen) return;
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const dayStr = el?.getAttribute("data-avail-day");
    const hourStr = el?.getAttribute("data-avail-hour");
    if (dayStr != null && hourStr != null) {
      handleMouseEnter(parseInt(dayStr), parseInt(hourStr));
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    e.preventDefault();
    handleMouseUp();
  };

  const handleSave = async () => {
    if (!leagueId) return;
    setSaving(true);
    try {
      const token = await getToken();
      const slotArray: Slot[] = [];
      for (const key of slots) {
        const [d, h] = key.split(":").map(Number);
        slotArray.push({ dayOfWeek: d, hour: h });
      }
      const res = await apiFetch("/availability", token, {
        method: "POST",
        body: JSON.stringify({ leagueId, weekOf, slots: slotArray }),
      });
      if (res.ok) {
        toast({ title: "Availability saved" });
      } else {
        toast({ title: "Failed to save", variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  // Check if availability window is frozen (Thu–Sun)
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const isFrozen = weekOffset === 0 && (dayOfWeek === 0 || dayOfWeek >= 4);

  const deadline = new Date(weekOf);
  deadline.setDate(deadline.getDate() + 2); // Wednesday
  deadline.setHours(23, 59, 0, 0);

  return (
    <div className="space-y-6" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-heading text-foreground">My Availability</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Click or drag time slots to mark when you can play</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset(w => w - 1)} className="p-1.5 rounded hover:bg-accent text-muted-foreground transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-sm font-semibold text-foreground text-center min-w-[140px]">
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
          <select
            value={leagueId ?? ""}
            onChange={(e) => setLeagueId(Number(e.target.value))}
            className="text-sm px-3 py-1.5 rounded-md bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      )}

      {/* Frozen warning */}
      {isFrozen && (
        <div className="px-4 py-3 rounded-lg bg-warning/10 border border-warning/20 text-warning text-sm">
          Availability window has closed for this week (Wed 11:59 PM deadline). You can update next week's availability.
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="h-64 bg-card border border-card-border rounded-lg animate-pulse" />
      ) : (
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto" onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
            <div className="min-w-[560px] touch-none">
              {/* Header row */}
              <div className="grid sticky top-0 z-10 bg-card border-b border-border" style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}>
                <div className="px-2 py-2" />
                {DAYS.map((day, d) => (
                  <div key={d} className="px-1 py-2 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider border-l border-border">
                    {day}
                  </div>
                ))}
              </div>
              {/* Time rows */}
              {HOURS.map((hour) => (
                <div key={hour} className="grid border-b border-border/50" style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}>
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground text-right pr-3 flex items-center justify-end shrink-0">
                    {hourLabel(hour)}
                  </div>
                  {DAYS.map((_, d) => {
                    const key = slotKey(d, hour);
                    const selected = slots.has(key);
                    return (
                      <div
                        key={d}
                        data-avail-day={d}
                        data-avail-hour={hour}
                        className={cn(
                          "border-l border-border/50 h-8 cursor-pointer select-none transition-colors",
                          selected
                            ? "bg-primary/70 hover:bg-primary/80"
                            : "hover:bg-primary/15",
                          isFrozen && "cursor-not-allowed opacity-60"
                        )}
                        onMouseDown={isFrozen ? undefined : () => handleMouseDown(d, hour)}
                        onMouseEnter={isFrozen ? undefined : () => handleMouseEnter(d, hour)}
                        onTouchStart={isFrozen ? undefined : (e) => handleTouchStart(d, hour, e)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <p className="px-3 py-1.5 text-[11px] text-muted-foreground/60 md:hidden border-t border-border/30">
            Swipe left to see all days
          </p>
        </div>
      )}

      {/* Legend + Save */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-primary/70 inline-block" /> Available</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-muted inline-block" /> Unavailable</span>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || isFrozen}
          className="flex items-center gap-2 px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Check className="w-4 h-4" />
          {saving ? "Saving..." : "Save Availability"}
        </button>
      </div>
    </div>
  );
}

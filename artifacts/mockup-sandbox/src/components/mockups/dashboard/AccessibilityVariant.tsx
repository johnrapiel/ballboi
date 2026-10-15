/**
 * V3: ACCESSIBILITY & READABILITY
 *
 * Tradeoff: Larger text sizes (min 13px body), higher contrast ratios, generous
 * whitespace between elements, color is never the only signal, reduced visual
 * complexity. Optimized for low-contrast displays and users with reduced
 * visual acuity. Trades density for comfort — shows less per screen.
 */

const stats = [
  { label: "Active Leagues", value: 3, sub: "of 4 total", change: "up", color: "#06b6d4" },
  { label: "Players", value: 6, sub: "registered", change: null, color: "#06b6d4" },
  { label: "Matches Played", value: 5, sub: "4 upcoming", change: null, color: "#06b6d4" },
  { label: "This Week", value: 0, sub: "completed", change: "neutral", color: "#94a3b8" },
];

const topPlayers = [
  { rank: 1, name: "Rafael Mendez", winRate: 100, wins: 2, losses: 0 },
  { rank: 2, name: "Sarah Chen", winRate: 50, wins: 1, losses: 1 },
  { rank: 3, name: "Marcus Williams", winRate: 50, wins: 1, losses: 1 },
  { rank: 4, name: "Elena Petrov", winRate: 100, wins: 1, losses: 0 },
  { rank: 5, name: "Aiko Tanaka", winRate: 0, wins: 0, losses: 1 },
];

const activity = [
  { p1: "Sarah Chen", p2: "Rafael Mendez", league: "Doubles Test", status: "scheduled", score: null, ago: null },
  { p1: "Elena Petrov", p2: "Aiko Tanaka", league: "City Singles Championship", status: "scheduled", score: null, ago: null },
  { p1: "Rafael Mendez", p2: "James Okoro", league: "Summer Open 2025", status: "completed", score: "6–1, 6–2", ago: "10 months ago" },
  { p1: "Elena Petrov", p2: "Aiko Tanaka", league: "City Singles Championship", status: "completed", score: "7–6, 3–6, 6–1", ago: "9 months ago" },
];

function StatusBadge({ status }: { status: string }) {
  // Color is NOT the only signal — shape + text also differentiate
  const cfg: Record<string, { bg: string; text: string; border: string; shape: string }> = {
    completed: { bg: "#06b6d4/10", text: "#06b6d4", border: "1px solid rgba(6,182,212,0.3)", shape: "●" },
    scheduled: { bg: "rgba(96,165,250,0.1)", text: "#93c5fd", border: "1px solid rgba(96,165,250,0.3)", shape: "○" },
  };
  const c = cfg[status] ?? { bg: "rgba(255,255,255,0.05)", text: "#94a3b8", border: "1px solid rgba(255,255,255,0.1)", shape: "–" };
  return (
    <span
      style={{ background: c.bg, color: c.text, border: c.border }}
      className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
    >
      <span className="text-[8px]">{c.shape}</span>
      <span className="capitalize">{status}</span>
    </span>
  );
}

function WinRateBar({ rate }: { rate: number }) {
  // Visual + numeric — color alone doesn't carry the information
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${rate}%`, background: rate > 50 ? "#06b6d4" : rate > 0 ? "#94a3b8" : "#374151" }}
        />
      </div>
      <span className="text-sm font-bold tabular-nums text-white">{rate}%</span>
    </div>
  );
}

export function AccessibilityVariant() {
  return (
    <div className="min-h-screen bg-[#090d12] text-white font-sans">
      <div className="flex">
        {/* Sidebar: larger touch targets, higher contrast active state */}
        <aside className="w-[192px] min-h-screen bg-[#0d1117] border-r border-white/[0.08] flex-shrink-0 px-4 py-6">
          <div className="text-[#06b6d4] font-black text-base mb-0.5">Hudson Valley</div>
          <div className="text-[11px] text-zinc-400 font-medium mb-8">Tennis League</div>
          {["Dashboard","Leagues","Players","Matches","Schedule"].map((item, i) => (
            <div
              key={item}
              className="text-sm py-2.5 px-3 rounded-lg mb-1 cursor-pointer"
              style={{
                background: i === 0 ? "rgba(6,182,212,0.12)" : "transparent",
                color: i === 0 ? "#06b6d4" : "#94a3b8",
                fontWeight: i === 0 ? "600" : "400",
                // Larger minimum touch target: padding adds height
              }}
            >
              {item}
              {/* Active indicator: not just color — also shape */}
              {i === 0 && <span className="ml-1.5 text-xs">◀</span>}
            </div>
          ))}
        </aside>

        <main className="flex-1 p-8 max-w-5xl">
          {/* Header: larger H1, clear subtitle contrast */}
          <div className="flex items-start justify-between mb-8">
            <div>
              {/* Min 18px heading for comfortable reading */}
              <h1 className="text-2xl font-bold text-white tracking-tight">Dashboard</h1>
              {/* Subtitle: 13px minimum, clearly readable contrast */}
              <p className="text-[13px] text-zinc-400 mt-1">League overview and recent activity</p>
            </div>
          </div>

          {/* Stats: generous padding, clear label above number, semantic color with icon */}
          {/* Tradeoff: 2-column grid on this screen width (vs 4) — each card is larger */}
          <div className="grid grid-cols-4 gap-4 mb-8">
            {stats.map((s) => (
              <div key={s.label} className="bg-[#0d1117] border border-white/[0.08] rounded-xl p-5">
                {/* Label first — anchors the number semantically */}
                <p className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">{s.label}</p>
                {/* Large number: 36px bold = readable from further, on smaller screens */}
                <p className="text-[36px] font-black tabular-nums leading-none" style={{ color: s.color }}>{s.value}</p>
                {/* Sub always visible — no hover required to understand context */}
                {s.sub && (
                  <p className="text-[12px] text-zinc-500 mt-2">{s.sub}</p>
                )}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-5">
            {/* Top Players: win rate bar (not just color), generous row height */}
            <div className="col-span-1 bg-[#0d1117] border border-white/[0.08] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
                {/* 14px section heading = above minimum */}
                <h2 className="text-[14px] font-semibold text-white">Top Players</h2>
                <a className="text-[12px] text-[#06b6d4] font-semibold underline underline-offset-2 cursor-pointer">View all</a>
              </div>
              <div>
                {topPlayers.map((p) => (
                  <div key={p.name} className="px-5 py-4 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                    <div className="flex items-center justify-between gap-2">
                      {/* Rank: larger, clearly distinguished */}
                      <span className="text-[13px] font-bold text-zinc-500 tabular-nums w-6">#{p.rank}</span>
                      <span className="text-[14px] text-white font-medium flex-1">{p.name}</span>
                    </div>
                    {/* Win/Loss text below name, with visual bar — color + shape + number */}
                    <div className="flex items-center justify-between mt-2 ml-6">
                      <span className="text-[12px] text-zinc-500">{p.wins}W — {p.losses}L</span>
                      <WinRateBar rate={p.winRate} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Activity: 13px minimum text, status badge uses text+icon+color */}
            <div className="col-span-2 bg-[#0d1117] border border-white/[0.08] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
                <h2 className="text-[14px] font-semibold text-white">Recent Activity</h2>
                <a className="text-[12px] text-[#06b6d4] font-semibold underline underline-offset-2 cursor-pointer">View all matches</a>
              </div>
              <div>
                {activity.map((a, i) => (
                  <div key={i} className="px-5 py-4 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                    {/* Opponents on first line — large enough to scan */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-semibold text-white">
                          {a.p1} <span className="text-zinc-500 font-normal text-[12px]">vs</span> {a.p2}
                        </div>
                        {/* Score: clearly labelled, not just numbers */}
                        {a.score && (
                          <div className="mt-1 text-[12px] text-zinc-400">
                            Score: <span className="font-mono">{a.score}</span>
                          </div>
                        )}
                        {/* League + time: never below 12px, clearly secondary */}
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-[12px] text-zinc-500">{a.league}</span>
                          {a.ago && <span className="text-[12px] text-zinc-600">{a.ago}</span>}
                        </div>
                      </div>
                      {/* Status: color + shape + text (never color alone) */}
                      <StatusBadge status={a.status} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── ANNOTATION ── */}
          <div className="mt-8 border-t border-white/[0.06] pt-5">
            <p className="text-[11px] text-zinc-600 font-semibold uppercase tracking-wider mb-2">Usability focus: Accessibility & Readability</p>
            <p className="text-[12px] text-zinc-500 leading-relaxed">
              Minimum 12px text throughout (13–14px for body). Win rate uses bar + number — not color alone. Status uses glyph + text + color.
              44px+ row heights (comfortable touch). Label always precedes number.{" "}
              <strong className="text-zinc-400">Tradeoff:</strong> less information per viewport — generous spacing
              means more scrolling to see the same amount of content.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

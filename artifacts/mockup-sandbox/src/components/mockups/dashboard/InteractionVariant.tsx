/**
 * V2: INTERACTION & AFFORDANCE VISIBILITY
 *
 * Tradeoff: Every interactive element looks obviously clickable — explicit
 * arrows, hover-ready target areas, prominent CTAs, action discovery. Sacrifices
 * information density for clarity about what you can DO. Slower to scan
 * (more chrome per element) but eliminates hidden affordances.
 */

const stats = [
  { label: "Active Leagues", value: 3, sub: "4 total", cta: "View leagues", icon: "🏆" },
  { label: "Players", value: 6, sub: null, cta: "View all players", icon: "👥" },
  { label: "Matches Played", value: 5, sub: "4 upcoming", cta: "See schedule", icon: "⚔️" },
  { label: "This Week", value: 0, sub: "matches completed", cta: "View this week", icon: "📈" },
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
  { p1: "Elena Petrov", p2: "Aiko Tanaka", league: "City Singles", status: "scheduled", score: null, ago: null },
  { p1: "Rafael Mendez", p2: "James Okoro", league: "Summer Open", status: "completed", score: "6–1, 6–2", ago: "10mo ago" },
  { p1: "Elena Petrov", p2: "Aiko Tanaka", league: "City Singles", status: "completed", score: "7–6, 3–6, 6–1", ago: "9mo ago" },
];

function StatusPill({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    completed: "bg-[#06b6d4]/10 text-[#06b6d4] border border-[#06b6d4]/20",
    scheduled: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
  };
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${cfg[status] ?? ""}`}>
      {status}
    </span>
  );
}

export function InteractionVariant() {
  return (
    <div className="min-h-screen bg-[#090d12] text-white font-sans">
      <div className="flex">
        <aside className="w-[180px] min-h-screen bg-[#0d1117] border-r border-white/5 flex-shrink-0 px-3 py-6">
          <div className="text-[#06b6d4] font-black text-sm mb-1">Hudson Valley</div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-8">Tennis</div>
          {["Dashboard","Leagues","Players","Matches","Schedule"].map((item, i) => (
            <div key={item} className={`text-xs px-3 py-2.5 rounded mb-1 cursor-pointer flex items-center justify-between group
              ${i === 0 ? "bg-[#06b6d4]/10 text-[#06b6d4] font-semibold" : "text-zinc-400 hover:bg-white/5 hover:text-white transition-colors"}`}>
              <span>{item}</span>
              {i !== 0 && <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px]">→</span>}
            </div>
          ))}
        </aside>

        <main className="flex-1 p-6 max-w-5xl">
          {/* Header with primary CTA */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold text-white">Dashboard</h1>
              <p className="text-xs text-zinc-500 mt-0.5">League overview and recent activity</p>
            </div>
            {/* Primary action prominently placed and labelled */}
            <button className="px-4 py-2 bg-[#06b6d4] text-[#090d12] text-sm font-bold rounded-lg hover:bg-[#22d3ee] transition-colors flex items-center gap-2 cursor-pointer">
              + New Match
              <span className="text-[10px] opacity-70">[admin]</span>
            </button>
          </div>

          {/* Stats: each card is explicitly a link — full surface is the hit target */}
          {/* Tradeoff: hover state + arrow is visible at all times, not just on hover */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            {stats.map((s) => (
              <div
                key={s.label}
                className="group bg-[#0d1117] border border-white/5 rounded-xl p-4 cursor-pointer
                  hover:border-[#06b6d4]/40 hover:bg-[#06b6d4]/5 transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="text-3xl font-black text-white tabular-nums">{s.value}</div>
                  {/* Arrow: always visible so user knows it's clickable */}
                  <span className="text-[#06b6d4] text-sm group-hover:translate-x-0.5 transition-transform">→</span>
                </div>
                <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">{s.label}</div>
                {s.sub && <div className="text-[10px] text-zinc-600 mt-0.5">{s.sub}</div>}
                {/* Explicit affordance: named action, always visible */}
                <div className="mt-3 text-[10px] text-[#06b6d4]/60 group-hover:text-[#06b6d4] transition-colors font-medium">
                  {s.cta} →
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-4">
            {/* Top Players: each row has a clear "View profile" action */}
            <div className="col-span-1 bg-[#0d1117] border border-white/5 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <span className="text-xs font-bold text-white">Top Players</span>
                {/* Link is visually distinct — not just "All" but explicit label */}
                <button className="text-[11px] text-[#06b6d4] font-semibold hover:underline cursor-pointer flex items-center gap-1">
                  View all →
                </button>
              </div>
              <div>
                {topPlayers.map((p) => (
                  <div
                    key={p.name}
                    className="group flex items-center px-4 py-3 border-b border-white/[0.04] last:border-0
                      hover:bg-[#06b6d4]/5 cursor-pointer transition-colors"
                  >
                    <span className="w-5 text-[10px] font-bold text-zinc-600 tabular-nums">#{p.rank}</span>
                    <span className="flex-1 text-sm text-white font-medium ml-2 group-hover:text-[#06b6d4] transition-colors">{p.name}</span>
                    <div className="text-right flex items-center gap-2">
                      <div>
                        <div className={`text-xs font-bold tabular-nums ${p.winRate > 0 ? "text-[#06b6d4]" : "text-zinc-500"}`}>{p.winRate}%</div>
                        <div className="text-[10px] text-zinc-600">{p.wins}W {p.losses}L</div>
                      </div>
                      {/* Arrow: visible on hover only — secondary affordance */}
                      <span className="text-[#06b6d4] text-xs opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Footer CTA: unmissable secondary action */}
              <div className="px-4 py-3 border-t border-white/5">
                <button className="w-full text-[11px] text-center text-zinc-400 hover:text-[#06b6d4] transition-colors py-1 cursor-pointer hover:underline">
                  See full leaderboard →
                </button>
              </div>
            </div>

            {/* Activity Feed: each row is clickable with explicit target area */}
            <div className="col-span-2 bg-[#0d1117] border border-white/5 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <span className="text-xs font-bold text-white">Recent Activity</span>
                <button className="text-[11px] text-[#06b6d4] font-semibold hover:underline cursor-pointer">
                  All matches →
                </button>
              </div>
              <div>
                {activity.map((a, i) => (
                  <div
                    key={i}
                    className="group px-4 py-3 border-b border-white/[0.04] last:border-0
                      hover:bg-[#06b6d4]/5 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-semibold text-white group-hover:text-[#06b6d4] transition-colors">{a.p1}</span>
                          <span className="text-xs text-zinc-500">vs</span>
                          <span className="text-sm font-semibold text-white group-hover:text-[#06b6d4] transition-colors">{a.p2}</span>
                          {a.score && (
                            <span className="text-xs font-mono text-zinc-400 bg-white/5 px-1.5 py-0.5 rounded">{a.score}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-zinc-500">{a.league}</span>
                          {a.ago && <span className="text-[10px] text-zinc-600">{a.ago}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill status={a.status} />
                        {/* Arrow makes the row feel like a link */}
                        <span className="text-zinc-600 text-xs opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Secondary action: log a result */}
              <div className="px-4 py-3 border-t border-white/5 flex gap-2">
                <button className="flex-1 text-[11px] text-center py-2 rounded-lg border border-white/10 text-zinc-400 hover:border-[#06b6d4]/40 hover:text-[#06b6d4] cursor-pointer transition-all">
                  Log match result
                </button>
                <button className="flex-1 text-[11px] text-center py-2 rounded-lg border border-white/10 text-zinc-400 hover:border-[#06b6d4]/40 hover:text-[#06b6d4] cursor-pointer transition-all">
                  Schedule new match
                </button>
              </div>
            </div>
          </div>

          {/* ── ANNOTATION ── */}
          <div className="mt-6 border-t border-white/5 pt-4">
            <p className="text-[10px] text-zinc-600 font-medium uppercase tracking-wider mb-1">Usability focus: Interaction & Affordance Visibility</p>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Every clickable surface has an explicit arrow or hover state. CTAs are labelled (not just icons). Full row is the hit target.
              Footer actions name the verb. <strong className="text-zinc-400">Tradeoff:</strong> more chrome per element — 
              affordance indicators eat vertical space, reducing information density per scroll.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * V1: INFORMATION HIERARCHY
 *
 * Tradeoff: Prioritizes clear visual weight progression — primary numbers are
 * dominant, supporting context is subordinate, sections are grouped by semantic
 * relationship. Dense but organized. Trades spatial breathing room for
 * immediate scanability of the most important numbers.
 */

const stats = [
  { label: "Active Leagues", value: 3, sub: "4 total", trend: "+1 this month" },
  { label: "Players", value: 6, sub: null, trend: null },
  { label: "Matches Played", value: 5, sub: "4 upcoming", trend: null },
  { label: "This Week", value: 0, sub: "matches completed", trend: null },
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

function StatusPill({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    completed: "bg-[#06b6d4]/10 text-[#06b6d4]",
    scheduled: "bg-blue-400/10 text-blue-400",
  };
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${cfg[status] ?? "bg-zinc-700 text-zinc-400"}`}>
      {status}
    </span>
  );
}

export function HierarchyVariant() {
  return (
    <div className="min-h-screen bg-[#090d12] text-white font-sans">
      {/* Sidebar stub */}
      <div className="flex">
        <aside className="w-[180px] min-h-screen bg-[#0d1117] border-r border-white/5 flex-shrink-0 px-3 py-6">
          <div className="text-[#06b6d4] font-black text-sm mb-1 tracking-tight">Hudson Valley</div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-8">Tennis</div>
          {["Dashboard","Leagues","Players","Matches","Schedule"].map((item, i) => (
            <div key={item} className={`text-xs px-3 py-2 rounded mb-0.5 cursor-pointer ${i === 0 ? "bg-[#06b6d4]/10 text-[#06b6d4] font-semibold" : "text-zinc-400 hover:text-white"}`}>
              {item}
            </div>
          ))}
        </aside>

        {/* Main */}
        <main className="flex-1 p-6 max-w-5xl">

          {/* ── SECTION 1: Page identity — minimal, stays out of the way ── */}
          <div className="mb-5 border-b border-white/5 pb-4">
            {/* H1 is deliberately subdued — the numbers ARE the headline */}
            <p className="text-[11px] text-zinc-500 uppercase tracking-widest font-semibold">Dashboard</p>
            <p className="text-xs text-zinc-600 mt-0.5">League overview</p>
          </div>

          {/* ── SECTION 2: PRIMARY METRICS — dominant visual weight ── */}
          {/* Tradeoff: enormous numbers with hierarchy: number > label > detail */}
          <div className="grid grid-cols-4 gap-3 mb-7">
            {stats.map((s) => (
              <div key={s.label} className="bg-[#0d1117] border border-white/5 rounded-lg p-4">
                {/* Rank 1: The Number — overwhelmingly largest */}
                <div className="text-[40px] font-black text-white tabular-nums leading-none">{s.value}</div>
                {/* Rank 2: The Label — medium weight, secondary color */}
                <div className="text-[11px] font-semibold text-zinc-400 mt-2 uppercase tracking-wider">{s.label}</div>
                {/* Rank 3: Supporting detail — almost invisible unless you look */}
                {s.sub && <div className="text-[10px] text-zinc-600 mt-1">{s.sub}</div>}
              </div>
            ))}
          </div>

          {/* ── SECTION 3: CONTENT — clear semantic grouping ── */}
          {/* H2 headers are visually identical — same level, same weight */}
          <div className="grid grid-cols-3 gap-4">

            {/* Top Players: compact ranked list */}
            <div className="col-span-1 bg-[#0d1117] border border-white/5 rounded-lg overflow-hidden">
              {/* Section header: label + action — same pattern every time */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Top Players</span>
                <span className="text-[10px] text-[#06b6d4] font-semibold cursor-pointer">All →</span>
              </div>
              <div>
                {topPlayers.map((p, i) => (
                  <div key={p.name} className="flex items-center px-4 py-2.5 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                    {/* Rank has fixed width — tabular alignment */}
                    <span className="w-5 text-[10px] font-bold text-zinc-600 tabular-nums">#{p.rank}</span>
                    {/* Name: primary text */}
                    <span className="flex-1 text-sm text-white font-medium ml-2">{p.name}</span>
                    {/* Win rate: primary metric, cyan = positive */}
                    <div className="text-right">
                      <div className={`text-xs font-bold tabular-nums ${p.winRate > 0 ? "text-[#06b6d4]" : "text-zinc-500"}`}>{p.winRate}%</div>
                      <div className="text-[10px] text-zinc-600">{p.wins}W {p.losses}L</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Activity: time-ordered feed */}
            <div className="col-span-2 bg-[#0d1117] border border-white/5 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Recent Activity</span>
                <span className="text-[10px] text-[#06b6d4] font-semibold cursor-pointer">All matches →</span>
              </div>
              <div>
                {activity.map((a, i) => (
                  <div key={i} className="px-4 py-3 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Match: primary content — player names are the focus */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-semibold text-white">{a.p1}</span>
                          <span className="text-[11px] text-zinc-500">vs</span>
                          <span className="text-sm font-semibold text-white">{a.p2}</span>
                          {a.score && (
                            <span className="text-xs font-mono text-zinc-400 bg-white/5 px-1.5 py-0.5 rounded ml-1">{a.score}</span>
                          )}
                        </div>
                        {/* Secondary: league + time — visually subordinate */}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-zinc-500">{a.league}</span>
                          {a.ago && <span className="text-[10px] text-zinc-600">{a.ago}</span>}
                        </div>
                      </div>
                      <StatusPill status={a.status} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── ANNOTATION ── */}
          <div className="mt-6 border-t border-white/5 pt-4">
            <p className="text-[10px] text-zinc-600 font-medium uppercase tracking-wider mb-1">Usability focus: Information Hierarchy</p>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Numbers are visually dominant (40px bold). Labels use consistent small caps. Supporting detail is near-invisible.
              Section headers follow identical patterns. <strong className="text-zinc-400">Tradeoff:</strong> dense vertical rhythm
              — breathing room is sacrificed for faster top-to-bottom scanning.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

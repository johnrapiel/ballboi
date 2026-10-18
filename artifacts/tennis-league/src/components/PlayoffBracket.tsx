import { Link } from "wouter";
import { Trophy, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDisplayScore } from "@/lib/tennisScore";
import type { PlayoffBracketResponse, PlayoffQFSlot, PlayoffAdvancedSlot } from "@workspace/api-client-react";

function playoffRoundLabel(round: string): string {
  if (round === "quarterfinal") return "QF";
  if (round === "semifinal") return "SF";
  if (round === "final") return "Final";
  return round;
}

interface SlotRowProps {
  playerId: number | null | undefined;
  playerName: string | null | undefined;
  winnerId: number | null | undefined;
  seed?: number | null;
  isTbd?: boolean;
}

function SlotRow({ playerId, playerName, winnerId, seed, isTbd }: SlotRowProps) {
  const isWinner = !!playerId && !!winnerId && playerId === winnerId;
  if (isTbd || !playerName) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 opacity-40">
        {seed != null && (
          <span className="text-[11px] w-4 text-center font-bold text-muted-foreground shrink-0">
            {seed}
          </span>
        )}
        <span className="text-xs text-muted-foreground italic">TBD</span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded transition-colors",
        isWinner && "bg-primary/10"
      )}
    >
      {seed != null && (
        <span className={cn("text-[11px] w-4 text-center font-bold shrink-0", isWinner ? "text-primary" : "text-muted-foreground")}>
          {seed}
        </span>
      )}
      <span className={cn("text-xs font-semibold truncate", isWinner ? "text-primary" : "text-foreground")}>
        {playerName}
      </span>
      {isWinner && <Trophy className="w-3 h-3 text-primary shrink-0 ml-auto" />}
    </div>
  );
}

interface QFCardProps {
  slot: PlayoffQFSlot;
}

function QFCard({ slot }: QFCardProps) {
  const isCompleted = slot.matchStatus === "completed";
  const topSeedInfo = slot.topPlayerId ? { seed: slot.topSeed } : null;
  const bottomSeedInfo = slot.bottomPlayerId ? { seed: slot.bottomSeed } : null;

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden min-w-[180px]">
      <div className="px-3 py-1 border-b border-border flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">QF {slot.slot}</span>
        {slot.isBye && (
          <span className="text-[11px] font-semibold text-muted-foreground border border-border px-1.5 py-0.5 rounded uppercase tracking-wider">Bye</span>
        )}
        {slot.matchId && !slot.isBye && (
          <Link href={`/matches/${slot.matchId}`} className="text-[11px] text-primary hover:underline">
            View
          </Link>
        )}
      </div>
      <div className="divide-y divide-border/60">
        <SlotRow
          playerId={slot.topPlayerId}
          playerName={slot.topPlayerName}
          winnerId={slot.winnerId}
          seed={slot.topSeed}
        />
        {slot.isBye ? (
          <div className="px-3 py-1.5 opacity-30">
            <div className="flex items-center gap-2">
              <span className="text-[11px] w-4 text-center font-bold text-muted-foreground">{slot.bottomSeed}</span>
              <span className="text-[11px] text-muted-foreground italic">— bye —</span>
            </div>
          </div>
        ) : (
          <SlotRow
            playerId={slot.bottomPlayerId}
            playerName={slot.bottomPlayerName}
            winnerId={slot.winnerId}
            seed={slot.bottomSeed}
          />
        )}
      </div>
      {isCompleted && slot.score && (
        <div className="px-3 py-1 border-t border-border">
          <span className="text-[11px] font-mono text-muted-foreground">{formatDisplayScore(slot.score)}</span>
        </div>
      )}
    </div>
  );
}

interface AdvancedCardProps {
  slot: PlayoffAdvancedSlot;
  roundLabel: string;
  seedings?: { playerId: number; seed: number }[];
}

function AdvancedCard({ slot, roundLabel, seedings = [] }: AdvancedCardProps) {
  const isCompleted = slot.matchStatus === "completed";
  const topSeed = seedings.find((s) => s.playerId === slot.topPlayerId)?.seed;
  const bottomSeed = seedings.find((s) => s.playerId === slot.bottomPlayerId)?.seed;

  const topTbd = !slot.topPlayerId;
  const bottomTbd = !slot.bottomPlayerId;

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden min-w-[180px]">
      <div className="px-3 py-1 border-b border-border flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{roundLabel}</span>
        {slot.matchId && (
          <Link href={`/matches/${slot.matchId}`} className="text-[11px] text-primary hover:underline">
            View
          </Link>
        )}
      </div>
      <div className="divide-y divide-border/60">
        <SlotRow
          playerId={slot.topPlayerId}
          playerName={slot.topPlayerName}
          winnerId={slot.winnerId}
          seed={topSeed}
          isTbd={topTbd}
        />
        <SlotRow
          playerId={slot.bottomPlayerId}
          playerName={slot.bottomPlayerName}
          winnerId={slot.winnerId}
          seed={bottomSeed}
          isTbd={bottomTbd}
        />
      </div>
      {isCompleted && slot.score && (
        <div className="px-3 py-1 border-t border-border">
          <span className="text-[11px] font-mono text-muted-foreground">{formatDisplayScore(slot.score)}</span>
        </div>
      )}
    </div>
  );
}

function BracketArrow() {
  return (
    <div className="flex items-center self-stretch px-1">
      <div className="h-full w-px border-r border-dashed border-border/50" />
    </div>
  );
}

interface ConnectorProps {
  topSlot: number;
  bottomSlot: number;
  totalSlots: number;
}

function ColumnConnectors({ pairs }: { pairs: Array<{ topIdx: number; bottomIdx: number }> }) {
  return (
    <div className="flex flex-col justify-around self-stretch w-8 shrink-0">
      {pairs.map((pair, i) => (
        <div key={i} className="flex-1 flex flex-col">
          <div className="flex-1 border-r border-t border-card-border rounded-tr-md mr-1" />
          <div className="flex-1 border-r border-b border-card-border rounded-br-md mr-1" />
        </div>
      ))}
    </div>
  );
}

interface PlayoffBracketProps {
  bracket: PlayoffBracketResponse;
}

export default function PlayoffBracket({ bracket }: PlayoffBracketProps) {
  const seedingMap = bracket.seedings.map((s) => ({ playerId: s.playerId, seed: s.seed }));

  const hasQF = bracket.quarterfinals.some((q) => !q.isBye);
  const statusLabel =
    bracket.status === "completed"
      ? "Completed"
      : "In Progress";

  return (
    <div className="space-y-4">
      {/* Champion banner */}
      {bracket.champion && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-primary/10 border border-primary/30">
          <Crown className="w-5 h-5 text-primary shrink-0" />
          <div>
            <p className="text-[11px] font-bold text-primary uppercase tracking-wider">Champion</p>
            <p className="text-lg font-extrabold text-foreground">{bracket.champion.playerName}</p>
          </div>
        </div>
      )}

      {/* Seedings */}
      <div className="flex flex-wrap gap-2">
        {bracket.seedings.map((s) => (
          <div key={s.playerId} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-bold text-primary/80">#{s.seed}</span>
            <span className="font-semibold text-foreground">{s.playerName}</span>
            <span className="text-muted-foreground/60">({Math.round(s.winRate * 100)}%)</span>
          </div>
        ))}
      </div>

      {/* Bracket */}
      <div className="overflow-x-auto pb-2">
        <div className="flex items-start gap-0 min-w-[600px]">
          {/* QF Column */}
          {hasQF && (
            <>
              <div className="flex flex-col gap-3 flex-1">
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider text-center mb-1">Quarterfinals</p>
                <div className="flex flex-col gap-2">
                  {bracket.quarterfinals.map((slot) => (
                    <QFCard key={slot.slot} slot={slot} />
                  ))}
                </div>
              </div>

              {/* QF → SF connectors */}
              <div className="flex flex-col self-stretch pt-7 w-8 shrink-0">
                {/* Top pair connector (QF1+QF2 → SF1) */}
                <div className="flex-1 flex flex-col">
                  <div className="flex-1 border-r border-card-border" />
                  <div className="h-0 border-t border-card-border" />
                  <div className="flex-1 border-r border-card-border" />
                </div>
                {/* Gap between pairs */}
                <div className="flex-1 flex flex-col">
                  <div className="flex-1 border-r border-card-border" />
                  <div className="h-0 border-t border-card-border" />
                  <div className="flex-1 border-r border-card-border" />
                </div>
              </div>
            </>
          )}

          {/* SF Column */}
          <div className={cn("flex flex-col flex-1", hasQF && "mt-7")}>
            {!hasQF && <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider text-center mb-1">Semifinals</p>}
            {hasQF && <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider text-center mb-1">Semifinals</p>}
            <div className="flex flex-col gap-2 justify-around h-full">
              {bracket.semifinals.map((slot) => (
                <AdvancedCard
                  key={slot.slot}
                  slot={slot}
                  roundLabel={`SF ${slot.slot}`}
                  seedings={seedingMap}
                />
              ))}
            </div>
          </div>

          {/* SF → Final connector */}
          <div className="flex flex-col self-stretch w-8 shrink-0" style={{ paddingTop: hasQF ? "1.75rem" : "0" }}>
            <div className="flex-1 border-r border-card-border" />
            <div className="h-0 border-t border-card-border" />
            <div className="flex-1 border-r border-card-border" />
          </div>

          {/* Final Column */}
          <div className={cn("flex flex-col flex-1 justify-center", hasQF && "mt-7")}>
            {hasQF && <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider text-center mb-1">Final</p>}
            {!hasQF && <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider text-center mb-1">Final</p>}
            <div className="flex flex-col justify-center flex-1">
              <AdvancedCard
                slot={bracket.final}
                roundLabel="Final"
                seedings={seedingMap}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

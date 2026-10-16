import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { AlertTriangle, ArrowLeft, BarChart3, Clapperboard, Clock, Download, Flame, Gauge, Layers, LineChart, Loader2, PlayCircle, SkipBack, SkipForward, Target, Trophy, Video } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart as ReLineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { getBallBoiReplay, getBallBoiVideoBlob, getBallBoiVideoUrl, type MatchShot } from "@/lib/ballBoiApi";
import { cn } from "@/lib/utils";

function isMlUnavailableError(message: string | null | undefined): boolean {
  if (!message) return false;
  return message.toLowerCase().includes("temporarily unavailable");
}

function formatRetryCountdown(nextRetryAt: string | null | undefined): string {
  if (!nextRetryAt) return "shortly";
  const ts = new Date(nextRetryAt).getTime();
  if (isNaN(ts)) return "shortly";
  const msRemaining = ts - Date.now();
  if (msRemaining <= 0) return "shortly";
  const minutesRemaining = Math.ceil(msRemaining / 60000);
  if (minutesRemaining <= 1) return "~1 minute";
  return `~${minutesRemaining} minutes`;
}

function useRetryCountdown(nextRetryAt: string | null | undefined): string {
  const [countdown, setCountdown] = useState(() => formatRetryCountdown(nextRetryAt));
  useEffect(() => {
    setCountdown(formatRetryCountdown(nextRetryAt));
    if (!nextRetryAt) return;
    const interval = setInterval(() => setCountdown(formatRetryCountdown(nextRetryAt)), 30000);
    return () => clearInterval(interval);
  }, [nextRetryAt]);
  return countdown;
}

function fmtTime(value: number | null | undefined) {
  const seconds = Math.max(0, Math.floor(value ?? 0));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function label(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function CourtHeatmap({ shots, selectedShot, onSelect }: { shots: MatchShot[]; selectedShot: MatchShot | null; onSelect: (shot: MatchShot) => void }) {
  return (
    <div className="relative mx-auto w-full max-w-2xl aspect-[1.9/1] rounded-xl border-2 border-primary/60 bg-gradient-to-b from-cyan-950/20 to-slate-950 overflow-hidden">
      <div className="absolute inset-x-0 top-1/2 border-t border-primary/50" />
      <div className="absolute inset-y-0 left-1/2 border-l border-primary/50" />
      <div className="absolute inset-y-[18%] left-[18%] right-[18%] border border-primary/35" />
      <div className="absolute inset-y-[18%] left-1/2 border-l border-primary/35" />
      {shots.map((shot) => {
        const x = Math.max(4, Math.min(96, (shot.courtZoneX ?? 0.5) * 100));
        const y = Math.max(5, Math.min(95, (shot.courtZoneY ?? 0.5) * 100));
        const winner = shot.outcome === "winner";
        const error = shot.outcome?.includes("error");
        return (
          <button
            type="button"
            onClick={() => onSelect(shot)}
            key={shot.id}
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-lg transition-transform hover:scale-150",
              selectedShot?.id === shot.id ? "h-5 w-5 bg-white border-primary shadow-primary/70" : winner ? "h-4 w-4 bg-primary border-primary shadow-primary/50" : error ? "h-3.5 w-3.5 bg-destructive border-destructive shadow-destructive/30" : "h-3 w-3 bg-info border-info shadow-info/30"
            )}
            style={{ left: `${x}%`, top: `${y}%` }}
            title={`${label(shot.shotType)} at ${fmtTime(shot.timestampSeconds)}`}
          />
        );
      })}
    </div>
  );
}

function StatCard({ title, value, icon: Icon }: { title: string; value: string | number; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className="h-4 w-4 text-primary" />
        {title}
      </div>
      <div className="mt-2 text-2xl font-extrabold text-foreground tabular-nums">{value}</div>
    </div>
  );
}

export default function BallBoiReplay() {
  const params = useParams<{ id: string }>();
  const matchId = parseInt(params.id ?? "");
  const { getToken } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [selectedShot, setSelectedShot] = useState<MatchShot | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("video");
  const [shotFilter, setShotFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [setFilter, setSetFilter] = useState("all");
  const [shotSort, setShotSort] = useState("time");
  const [heatmapPlayer, setHeatmapPlayer] = useState("all");
  const [heatmapOutcome, setHeatmapOutcome] = useState("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["ball-boi-replay", matchId],
    enabled: !!matchId,
    refetchInterval: (query) => {
      const s = query.state.data?.session;
      if (!s) return false;
      if (s.processingStatus === "processing") return 3500;
      const meta = s.metadata;
      if (s.processingStatus === "failed" && meta?.nextRetryAt) return 30000;
      return false;
    },
    queryFn: async () => getBallBoiReplay(matchId, await getToken()),
  });

  const session = data?.session ?? null;

  const retryMetadata = session?.metadata ?? null;
  const retryCount = typeof retryMetadata?.retryCount === "number" ? retryMetadata.retryCount : null;
  const nextRetryAt = typeof retryMetadata?.nextRetryAt === "string" ? retryMetadata.nextRetryAt : null;
  const hasPendingRetry = session?.processingStatus === "failed" && nextRetryAt != null;

  const retryCountdown = useRetryCountdown(hasPendingRetry ? nextRetryAt : null);
  const shots = data?.shots ?? [];
  const stats = data?.statistics ?? null;
  const durationSeconds = Math.max(session?.durationSeconds ?? 0, ...shots.map((shot) => shot.timestampSeconds ?? 0), 1);
  const players = Object.values(stats?.playerComparisons ?? {});
  const shotSet = (shot: MatchShot) => String(Math.min(3, Math.floor(((shot.timestampSeconds ?? 0) / durationSeconds) * 3) + 1));
  async function handleWatchVideo() {
    if (!session) return;
    setVideoLoading(true);
    setVideoError(null);
    setActiveTab("video");
    try {
      const token = await getToken();
      const { videoUrl } = await getBallBoiVideoUrl(session.id, token);
      setVideoSrc(videoUrl);
    } catch {
      setVideoSrc(null);
      setVideoError("Could not load video URL. Try again.");
    } finally {
      setVideoLoading(false);
    }
  }

  async function handleDownloadVideo() {
    if (!session) return;
    setDownloadLoading(true);
    setDownloadProgress(null);
    setDownloadError(null);
    try {
      const token = await getToken();
      const { videoUrl } = await getBallBoiVideoUrl(session.id, token);
      const blob = await getBallBoiVideoBlob(videoUrl, (pct) => setDownloadProgress(pct));
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `match-${matchId}-replay.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      setDownloadError("Could not download video. Try again.");
    } finally {
      setDownloadLoading(false);
      setDownloadProgress(null);
    }
  }
  const scopedShots = useMemo(() => shots.filter((shot) => setFilter === "all" || shotSet(shot) === setFilter), [shots, setFilter, durationSeconds]);
  const shotTypes = useMemo(() => Object.entries(scopedShots.reduce<Record<string, number>>((acc, shot) => ({ ...acc, [shot.shotType]: (acc[shot.shotType] ?? 0) + 1 }), {})).map(([name, count]) => ({ name: label(name), count })), [scopedShots]);
  const outcomes = useMemo(() => Object.entries(scopedShots.reduce<Record<string, number>>((acc, shot) => ({ ...acc, [shot.outcome ?? "in_play"]: (acc[shot.outcome ?? "in_play"] ?? 0) + 1 }), {})).map(([name, count]) => ({ name: label(name), count })), [scopedShots]);
  const timeline = useMemo(() => {
    let momentum = 0;
    return scopedShots.map((shot) => {
      if (shot.outcome === "winner") momentum += 1;
      if (shot.outcome?.includes("error")) momentum -= 1;
      return { time: fmtTime(shot.timestampSeconds), speed: shot.speedMph ?? 0, momentum, shot: label(shot.shotType), raw: shot };
    });
  }, [scopedShots]);
  const filteredShots = useMemo(() => scopedShots.filter((shot) => (shotFilter === "all" || shot.shotType === shotFilter) && (outcomeFilter === "all" || shot.outcome === outcomeFilter)), [scopedShots, shotFilter, outcomeFilter]);
  const sortedFilteredShots = useMemo(() => filteredShots.slice().sort((a, b) => {
    if (shotSort === "speed") return (b.speedMph ?? 0) - (a.speedMph ?? 0);
    if (shotSort === "outcome") return label(a.outcome).localeCompare(label(b.outcome));
    return (a.timestampSeconds ?? 0) - (b.timestampSeconds ?? 0);
  }), [filteredShots, shotSort]);
  const heatmapShots = useMemo(() => scopedShots.filter((shot) => (heatmapPlayer === "all" || String(shot.playerId ?? "unknown") === heatmapPlayer) && (heatmapOutcome === "all" || shot.outcome === heatmapOutcome)), [scopedShots, heatmapPlayer, heatmapOutcome]);

  function seekTo(shot: MatchShot) {
    setSelectedShot(shot);
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, shot.clipStartSeconds ?? shot.timestampSeconds ?? 0);
      videoRef.current.play().catch(() => undefined);
    }
  }

  function seekRelative(delta: number) {
    if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + delta);
  }

  function playRallyFinish(shot: MatchShot) {
    seekTo(shot);
    if (videoRef.current) videoRef.current.playbackRate = 0.5;
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-56 rounded bg-muted animate-pulse" />
        <div className="h-80 rounded-xl border border-card-border bg-card animate-pulse" />
      </div>
    );
  }

  if (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const isServiceDown = isMlUnavailableError(errMsg);
    return (
      <div className={cn("rounded-lg border p-5 text-sm", isServiceDown ? "border-warning/30 bg-warning/10 text-warning" : "border-destructive/30 bg-destructive/10 text-destructive")}>
        <div className="flex items-center gap-2 font-semibold">
          {isServiceDown ? <Clock className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
          {isServiceDown ? "Analysis service is warming up — try again in a moment." : "Replay failed to load."}
        </div>
        {!isServiceDown && <p className="mt-1 text-xs opacity-80">If the problem persists, open the match and check the session status.</p>}
      </div>
    );
  }

  if (!session) {
    return (
      <div className="space-y-5">
        <Link href={`/matches/${matchId}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to match
        </Link>
        <div className="rounded-xl border border-card-border bg-card p-8 text-center">
          <Video className="mx-auto h-10 w-10 text-primary" />
          <h1 className="mt-4 text-2xl font-extrabold text-foreground">No Ball Boi replay yet</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Start Ball Boi mode from the match detail page to record video, capture live shot data, and generate a replay package.</p>
          <Button asChild className="mt-5">
            <Link href={`/matches/${matchId}`}>Open Match</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={`/matches/${matchId}`} className="p-1.5 rounded hover:bg-accent text-muted-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Ball Boi Replay</h1>
            <p className="text-sm text-muted-foreground">Seven review modes for match film, shots, rallies, heatmaps, timeline, stats, and comparisons.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {session.videoObjectPath ? (
            <>
              <Button
                size="sm"
                variant="default"
                onClick={handleWatchVideo}
                disabled={videoLoading}
                className="gap-1.5"
              >
                {videoLoading ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…</>
                ) : (
                  <><PlayCircle className="h-3.5 w-3.5" />Watch Video</>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownloadVideo}
                disabled={downloadLoading}
                className="gap-1.5 tabular-nums"
              >
                {downloadLoading ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" />{downloadProgress !== null ? `Downloading… ${downloadProgress}%` : "Downloading…"}</>
                ) : (
                  <><Download className="h-3.5 w-3.5" />Download Video</>
                )}
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">No video recorded</span>
          )}
          <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider", session.processingStatus === "completed" ? "border-primary/40 bg-primary/10 text-primary" : session.processingStatus === "failed" && !hasPendingRetry ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-warning/30 bg-warning/10 text-warning")}>
            {session.processingStatus === "failed" && hasPendingRetry ? "Retrying" : label(session.processingStatus)}
          </span>
        </div>
      </div>

      {session.processingError && (
        isMlUnavailableError(session.processingError) ? (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
            <div className="flex items-center gap-2 font-semibold">
              <Clock className="h-4 w-4 shrink-0" />
              {hasPendingRetry && retryCount != null
                ? `Retry ${retryCount + 1} of 3 scheduled in ${retryCountdown}`
                : "Analysis service is warming up — try again in a moment."}
            </div>
            <p className="mt-1 text-xs opacity-80">
              {hasPendingRetry
                ? "Your video has been saved. Analysis will restart automatically — this page will update when results are ready."
                : "Your video has been saved. Shot data will appear here once the analysis service is available."}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {session.processingError}
            </div>
          </div>
        )
      )}

      {downloadError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {downloadError}
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <StatCard title="Shots" value={scopedShots.length} icon={Target} />
        <StatCard title="Rallies" value={new Set(scopedShots.map((shot) => shot.rallyNumber)).size} icon={Layers} />
        <StatCard title="Avg Speed" value={`${Math.round(scopedShots.reduce((sum, shot) => sum + (shot.speedMph ?? 0), 0) / Math.max(scopedShots.length, 1))} mph`} icon={Gauge} />
        <StatCard title="Fastest" value={`${Math.round(Math.max(0, ...scopedShots.map((shot) => shot.speedMph ?? 0)))} mph`} icon={Flame} />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-card-border bg-card p-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Set filter</span>
        {["all", "1", "2", "3"].map((value) => (
          <Button key={value} size="sm" variant={setFilter === value ? "default" : "outline"} onClick={() => setSetFilter(value)}>
            {value === "all" ? "Full match" : `Set ${value}`}
          </Button>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-2 md:grid-cols-7">
          <TabsTrigger value="video">Full Video</TabsTrigger>
          <TabsTrigger value="shots">Shot-by-Shot</TabsTrigger>
          <TabsTrigger value="rallies">Rally Replay</TabsTrigger>
          <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="stats">Stats</TabsTrigger>
          <TabsTrigger value="comparison">Comparison</TabsTrigger>
        </TabsList>

        <TabsContent value="video" className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-card-border bg-black">
            {videoLoading ? (
              <div className="flex aspect-video items-center justify-center gap-2 text-neutral-300">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Fetching video…</span>
              </div>
            ) : videoError ? (
              <div className="flex aspect-video flex-col items-center justify-center gap-3 text-red-400">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <span className="text-sm">{videoError}</span>
                <Button size="sm" variant="outline" onClick={handleWatchVideo} className="gap-1.5 text-foreground">
                  <PlayCircle className="h-3.5 w-3.5" />Try Again
                </Button>
              </div>
            ) : videoSrc ? (
              <video ref={videoRef} src={videoSrc} controls className="aspect-video w-full" />
            ) : session.videoObjectPath ? (
              <div className="flex aspect-video flex-col items-center justify-center gap-2 text-muted-foreground">
                <PlayCircle className="h-8 w-8 opacity-50" />
                <span className="text-sm">Click <strong>Watch Video</strong> above to load the recording.</span>
              </div>
            ) : (
              <div className="flex aspect-video flex-col items-center justify-center gap-2 text-muted-foreground">
                <Video className="h-8 w-8 opacity-50" />
                <span className="text-sm">No video was recorded for this session.</span>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-card-border bg-card p-3">
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
              <span>Shot marker scrubber</span>
              <span>{sortedFilteredShots.length} markers</span>
            </div>
            <div className="relative h-8 rounded-full bg-muted">
              {sortedFilteredShots.map((shot) => (
                <button key={shot.id} type="button" onClick={() => seekTo(shot)} className={cn("absolute top-1/2 h-5 w-1 -translate-y-1/2 rounded-full", shot.outcome === "winner" ? "bg-primary" : shot.outcome?.includes("error") ? "bg-destructive" : "bg-info")} style={{ left: `${Math.min(99, Math.max(0, ((shot.timestampSeconds ?? 0) / durationSeconds) * 100))}%` }} title={`${fmtTime(shot.timestampSeconds)} ${label(shot.shotType)}`} />
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => seekRelative(-1)}><SkipBack className="mr-1 h-3.5 w-3.5" />1s</Button>
              <Button size="sm" variant="outline" onClick={() => seekRelative(1)}><SkipForward className="mr-1 h-3.5 w-3.5" />1s</Button>
            </div>
          </div>
          {session.aiNarrative && <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 text-sm leading-relaxed text-foreground">{session.aiNarrative}</div>}
        </TabsContent>

        <TabsContent value="shots" className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="overflow-hidden rounded-xl border border-card-border bg-black">
            {videoSrc ? (
              <video ref={videoRef} src={videoSrc} controls className="aspect-video w-full" />
            ) : (
              <div className="flex aspect-video items-center justify-center text-muted-foreground">
                {session.videoObjectPath ? "Video is still being processed." : "No video was recorded for this session."}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={shotFilter} onChange={(e) => setShotFilter(e.target.value)} className="rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground">
              <option value="all">All shots</option>
              {Object.keys(stats?.shotTypeBreakdown ?? {}).map((name) => <option key={name} value={name}>{label(name)}</option>)}
            </select>
            <select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value)} className="rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground">
              <option value="all">All outcomes</option>
              {Object.keys(stats?.outcomeBreakdown ?? {}).map((name) => <option key={name} value={name}>{label(name)}</option>)}
            </select>
            <select value={shotSort} onChange={(e) => setShotSort(e.target.value)} className="rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground">
              <option value="time">Sort by time</option>
              <option value="speed">Sort by speed</option>
              <option value="outcome">Sort by outcome</option>
            </select>
          </div>
          <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
            {sortedFilteredShots.map((shot) => (
              <button key={shot.id} onClick={() => seekTo(shot)} className={cn("w-full rounded-lg border p-3 text-left transition-colors", selectedShot?.id === shot.id ? "border-primary bg-primary/10" : "border-card-border bg-card hover:bg-accent/40")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-foreground">#{shot.sequenceNumber} {label(shot.shotType)}</span>
                  <span className="font-mono text-xs text-primary">{fmtTime(shot.timestampSeconds)}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{label(shot.outcome)} · {Math.round(shot.speedMph ?? 0)} mph · {label(shot.courtZoneName)}</div>
              </button>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="rallies" className="space-y-4">
          {Object.entries(scopedShots.reduce<Record<string, MatchShot[]>>((acc, shot) => {
            const key = String(shot.rallyNumber ?? 1);
            acc[key] = [...(acc[key] ?? []), shot];
            return acc;
          }, {})).map(([rally, rallyShots]) => (
            <div key={rally} className="rounded-xl border border-card-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-bold text-foreground">Rally {rally}</h3>
                <span className="text-xs text-muted-foreground">{rallyShots.length} shots</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {rallyShots.map((shot, index) => (
                  <Button key={shot.id} variant="outline" size="sm" onClick={() => index === rallyShots.length - 1 ? playRallyFinish(shot) : seekTo(shot)}>{fmtTime(shot.timestampSeconds)} · {label(shot.shotType)}{index === rallyShots.length - 1 ? " finish" : ""}</Button>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Selecting the finish shot seeks to the end of the rally and switches playback to half speed for review.</p>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="heatmap" className="space-y-4">
          <div className="flex flex-wrap justify-center gap-2">
            <select value={heatmapPlayer} onChange={(e) => setHeatmapPlayer(e.target.value)} className="rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground">
              <option value="all">All players</option>
              {players.map((player) => <option key={player.playerId} value={String(player.playerId)}>{player.name}</option>)}
            </select>
            <select value={heatmapOutcome} onChange={(e) => setHeatmapOutcome(e.target.value)} className="rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground">
              <option value="all">All outcomes</option>
              {Object.keys(stats?.outcomeBreakdown ?? {}).map((name) => <option key={name} value={name}>{label(name)}</option>)}
            </select>
          </div>
          <CourtHeatmap shots={heatmapShots} selectedShot={selectedShot} onSelect={seekTo} />
          <div className="flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-primary" />Winner</span>
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-destructive" />Error</span>
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-info" />Rally ball</span>
          </div>
          {selectedShot && <div className="mx-auto max-w-lg rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-foreground">{label(selectedShot.shotType)} · {label(selectedShot.outcome)} · {label(selectedShot.courtZoneName)} · {fmtTime(selectedShot.timestampSeconds)}</div>}
        </TabsContent>

        <TabsContent value="timeline" className="rounded-xl border border-card-border bg-card p-4">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ReLineChart data={timeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" />
                <YAxis stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Line type="monotone" dataKey="speed" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="momentum" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              </ReLineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 flex flex-wrap gap-1">
            {timeline.map((point, index) => (
              <button key={`${point.time}-${index}`} type="button" onClick={() => seekTo(point.raw)} className={cn("h-3 flex-1 min-w-4 rounded-full", point.momentum >= 0 ? "bg-primary/70" : "bg-destructive/70")} title={`${point.time} ${point.shot}`} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="stats" className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-card-border bg-card p-4">
            <h3 className="mb-4 flex items-center gap-2 font-bold text-foreground"><BarChart3 className="h-4 w-4 text-primary" />Shot Types</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={shotTypes}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" />
                  <YAxis stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                  <Bar dataKey="count" fill="#06b6d4" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-xl border border-card-border bg-card p-4">
            <h3 className="mb-4 flex items-center gap-2 font-bold text-foreground"><LineChart className="h-4 w-4 text-primary" />Outcomes</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={outcomes} dataKey="count" nameKey="name" outerRadius={90} label>
                    {outcomes.map((entry, index) => <Cell key={entry.name} fill={["#06b6d4", "#3b82f6", "#ef4444", "#f59e0b"][index % 4]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-xl border border-card-border bg-card p-4 lg:col-span-2">
            <h3 className="mb-4 flex items-center gap-2 font-bold text-foreground"><Trophy className="h-4 w-4 text-primary" />Advanced Tennis Metrics</h3>
            <div className="grid gap-3 md:grid-cols-4">
              <StatCard title="Serve/first ball" value={scopedShots.filter((shot) => shot.shotType === "serve").length} icon={Target} />
              <StatCard title="Return balls" value={scopedShots.filter((shot) => shot.shotType === "return").length} icon={Gauge} />
              <StatCard title="Conversion" value={`${Math.round(((scopedShots.filter((shot) => shot.outcome === "winner").length) / Math.max(scopedShots.filter((shot) => shot.outcome === "winner" || shot.outcome?.includes("error")).length, 1)) * 100)}%`} icon={Trophy} />
              <StatCard title="Pressure errors" value={scopedShots.filter((shot) => shot.outcome?.includes("error")).length} icon={Flame} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="comparison" className="grid gap-4 md:grid-cols-2">
          {players.map((player) => (
            <div key={player.playerId} className="rounded-xl border border-card-border bg-card p-5">
              <h3 className="font-bold text-foreground">{player.name}</h3>
              <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                <div className="flex justify-between"><span>Tracked shots</span><span className="font-mono text-primary">{player.totalShots}</span></div>
                <div className="flex justify-between"><span>Winners</span><span className="font-mono text-primary">{player.winners}</span></div>
                <div className="flex justify-between"><span>Errors</span><span className="font-mono text-destructive">{player.errors}</span></div>
                <div className="flex justify-between"><span>Average speed</span><span className="font-mono text-foreground">{Math.round(player.avgSpeedMph)} mph</span></div>
              </div>
              <div className="mt-5 space-y-2">
                {[
                  ["Power", player.avgSpeedMph, 100],
                  ["Attack", player.winners, Math.max(stats?.winners ?? 1, 1)],
                  ["Control", Math.max(0, player.totalShots - player.errors), Math.max(player.totalShots, 1)],
                ].map(([name, value, max]) => (
                  <div key={String(name)}>
                    <div className="mb-1 flex justify-between text-[11px] uppercase tracking-wider text-muted-foreground"><span>{name}</span><span>{Math.round(Number(value))}</span></div>
                    <div className="h-2 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (Number(value) / Math.max(Number(max), 1)) * 100)}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="rounded-xl border border-card-border bg-card p-5 md:col-span-2">
            <h3 className="font-bold text-foreground">Side-by-side stat matrix</h3>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-2 text-left">Player</th><th className="text-right">Shots</th><th className="text-right">Winners</th><th className="text-right">Errors</th><th className="text-right">Avg MPH</th></tr></thead>
                <tbody>
                  {players.map((player) => (
                    <tr key={player.playerId} className="border-t border-border">
                      <td className="py-2 font-semibold text-foreground">{player.name}</td>
                      <td className="text-right font-mono text-primary">{player.totalShots}</td>
                      <td className="text-right font-mono text-primary">{player.winners}</td>
                      <td className="text-right font-mono text-destructive">{player.errors}</td>
                      <td className="text-right font-mono text-foreground">{Math.round(player.avgSpeedMph)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-xl border border-card-border bg-card p-5">
            <h3 className="flex items-center gap-2 font-bold text-foreground"><Trophy className="h-4 w-4 text-primary" />Winning Patterns</h3>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <div className="flex justify-between"><span>Winners</span><span className="font-mono text-primary">{stats?.winners ?? 0}</span></div>
              <div className="flex justify-between"><span>Errors</span><span className="font-mono text-destructive">{stats?.errors ?? 0}</span></div>
              <div className="flex justify-between"><span>Winner/Error ratio</span><span className="font-mono text-foreground">{((stats?.winners ?? 0) / Math.max(stats?.errors ?? 0, 1)).toFixed(2)}</span></div>
            </div>
          </div>
          <div className="rounded-xl border border-card-border bg-card p-5">
            <h3 className="flex items-center gap-2 font-bold text-foreground"><Clapperboard className="h-4 w-4 text-primary" />Replay Notes</h3>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{session.aiNarrative ?? "Narrative summary is generated after processing completes."}</p>
            <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              Recommendation: review clusters with repeated errors, compare average speed by player, then replay the longest rallies before your next match.
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
import { useState, useEffect, useRef, type MouseEvent } from "react";
import { useGetMatch, useUpdateMatch, getGetMatchQueryKey } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trophy, CheckCircle, Edit2, Check, PauseCircle, Video, Square, Activity, BarChart3, CalendarDays, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth, useUser } from "@clerk/react";
import { apiFetch } from "@/lib/scheduleApi";
import { formatDisplayScore, formatScore, parseScore, type SetScore } from "@/lib/tennisScore";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cancelBallBoiSession, completeBallBoiSession, detectCourt, getBallBoiStatus, getMlHealth, requestBallBoiUploadUrl, sendLiveShot, startBallBoiSession, type BallBoiSession, type CourtCalibration, type CourtCalibrationPoint, type MatchShot } from "@/lib/ballBoiApi";

const HOUR_OPTIONS_12 = ["1","2","3","4","5","6","7","8","9","10","11","12"];
function h24to12(h24: string) { const h = parseInt(h24, 10); return h === 0 ? "12" : h <= 12 ? String(h) : String(h - 12); }
function h24toPeriod(h24: string): "AM" | "PM" { return parseInt(h24, 10) < 12 ? "AM" : "PM"; }
function h12to24(h12: string, period: "AM" | "PM") { let h = parseInt(h12, 10); if (period === "AM") { if (h === 12) h = 0; } else { if (h !== 12) h += 12; } return String(h).padStart(2, "0"); }

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

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

function calcPoints(score: string | null, winnerId: number | null, p1Id: number, p2Id: number) {
  if (!score || !winnerId) return null;
  let p1Games = 0, p2Games = 0, p1Sets = 0, p2Sets = 0;
  for (const set of score.split(",").map((s) => s.trim())) {
    const cleaned = set.replace(/\(\d+\)/, "");
    const [a, b] = cleaned.split("-").map(Number);
    if (isNaN(a) || isNaN(b)) continue;
    // For match tiebreak (scores >= 10), only count as a set win, not individual games
    if (a >= 10 || b >= 10) {
      if (a > b) p1Sets++; else if (b > a) p2Sets++;
    } else {
      p1Games += a; p2Games += b;
      if (a > b) p1Sets++; else if (b > a) p2Sets++;
    }
  }
  const p1Bonus = winnerId === p1Id ? 6 : 0;
  const p2Bonus = winnerId === p2Id ? 6 : 0;
  return {
    p1: { games: p1Games, sets: p1Sets, bonus: p1Bonus, total: p1Games + p1Sets * 3 + p1Bonus },
    p2: { games: p2Games, sets: p2Sets, bonus: p2Bonus, total: p2Games + p2Sets * 3 + p2Bonus },
  };
}


function determineWinner(sets: SetScore[], player1Id: number, player2Id: number): number | null {
  let p1Sets = 0, p2Sets = 0;
  for (const set of sets) {
    const g1 = parseInt(set.p1 || "0");
    const g2 = parseInt(set.p2 || "0");
    if (isNaN(g1) || isNaN(g2) || (g1 === 0 && g2 === 0 && !set.p1 && !set.p2)) continue;
    if (g1 === 6 && g2 === 6) {
      // Regular tiebreak — winner determined by TB scores
      const tb1 = parseInt(set.tb1 || "0");
      const tb2 = parseInt(set.tb2 || "0");
      if (tb1 > tb2) p1Sets++;
      else if (tb2 > tb1) p2Sets++;
    } else {
      if (g1 > g2) p1Sets++;
      else if (g2 > g1) p2Sets++;
    }
  }
  if (p1Sets > p2Sets) return player1Id;
  if (p2Sets > p1Sets) return player2Id;
  return null;
}

// Determine which sets were won (for showing Match Tiebreak)
function getSetWinner(set: SetScore): 1 | 2 | null {
  const g1 = parseInt(set.p1 || "0");
  const g2 = parseInt(set.p2 || "0");
  if (!set.p1 || !set.p2) return null;
  if (g1 === 6 && g2 === 6) {
    const tb1 = parseInt(set.tb1 || "0");
    const tb2 = parseInt(set.tb2 || "0");
    if (tb1 > tb2) return 1;
    if (tb2 > tb1) return 2;
    return null;
  }
  if (g1 > g2) return 1;
  if (g2 > g1) return 2;
  return null;
}

const STOP_REASONS = [
  { value: "rained_out", label: "Rained out" },
  { value: "ran_out_of_time", label: "Ran out of time" },
  { value: "injury", label: "Injury / medical" },
  { value: "suspended", label: "Suspended" },
  { value: "other", label: "Other" },
] as const;

const COURT_CALIBRATION_LABELS = ["Near left baseline", "Near right baseline", "Far right baseline", "Far left baseline"];

function NumInput({
  value, onChange, placeholder = "0", max,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; max?: number;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      pattern="[0-9]*"
      min={0}
      max={max}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-2 py-3 rounded-md bg-input border border-border text-foreground text-sm text-center font-mono font-bold focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[44px]"
    />
  );
}

function SetScoreInput({
  sets, setSets, player1Name, player2Name,
}: {
  sets: SetScore[];
  setSets: (s: SetScore[]) => void;
  player1Name: string;
  player2Name: string;
}) {
  const updateSet = (idx: number, field: keyof SetScore, val: string) => {
    setSets(sets.map((s, i) => (i === idx ? { ...s, [field]: val } : s)));
  };

  const isRegularTb = (set: SetScore) => {
    const p1 = parseInt(set.p1 || "0");
    const p2 = parseInt(set.p2 || "0");
    // Show tiebreak when either 6-6 or the legacy 7-6/6-7 stored format
    return (p1 === 6 && p2 === 6) || (p1 === 7 && p2 === 6) || (p1 === 6 && p2 === 7);
  };

  const set1Winner = getSetWinner(sets[0]);
  const set2Winner = getSetWinner(sets[1]);
  const showMatchTb = set1Winner !== null && set2Winner !== null && set1Winner !== set2Winner;

  const p1Short = player1Name.split(" ")[0];
  const p2Short = player2Name.split(" ")[0];

  return (
    <div className="space-y-5">
      {/* Column headers */}
      <div className="grid grid-cols-[56px_1fr_20px_1fr] gap-x-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        <span />
        <span className="text-center truncate">{p1Short}</span>
        <span />
        <span className="text-center truncate">{p2Short}</span>
      </div>

      {/* Sets 1 & 2 */}
      {[0, 1].map((idx) => {
        const set = sets[idx];
        const showTb = isRegularTb(set);
        return (
          <div key={idx} className="space-y-2">
            <div className="grid grid-cols-[56px_1fr_20px_1fr] gap-x-2 items-center">
              <span className="text-xs font-semibold text-muted-foreground">Set {idx + 1}</span>
              <NumInput value={set.p1} onChange={(v) => updateSet(idx, "p1", v)} max={7} />
              <span className="text-muted-foreground font-bold text-sm text-center">-</span>
              <NumInput value={set.p2} onChange={(v) => updateSet(idx, "p2", v)} max={7} />
            </div>
            {showTb && (
              <div className="grid grid-cols-[56px_1fr_20px_1fr] gap-x-2 items-center">
                <span className="text-[11px] text-primary font-semibold pl-1">Tiebreak</span>
                <NumInput value={set.tb1 ?? ""} onChange={(v) => updateSet(idx, "tb1", v)} placeholder="—" />
                <span className="text-muted-foreground text-xs text-center">-</span>
                <NumInput value={set.tb2 ?? ""} onChange={(v) => updateSet(idx, "tb2", v)} placeholder="—" />
              </div>
            )}
          </div>
        );
      })}

      {/* Match Tiebreak (set 3) — only when sets are split */}
      {showMatchTb && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 border-t border-dashed border-border" />
            <span className="text-[11px] font-semibold text-primary uppercase tracking-wider px-2">
              Match Tiebreak — first to 10
            </span>
            <div className="flex-1 border-t border-dashed border-border" />
          </div>
          <div className="grid grid-cols-[56px_1fr_20px_1fr] gap-x-2 items-center">
            <span className="text-xs font-semibold text-muted-foreground">MTB</span>
            <NumInput value={sets[2].p1} onChange={(v) => updateSet(2, "p1", v)} placeholder="0" />
            <span className="text-muted-foreground font-bold text-sm text-center">-</span>
            <NumInput value={sets[2].p2} onChange={(v) => updateSet(2, "p2", v)} placeholder="0" />
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Enter 6-6 in a set to unlock the tiebreak fields (7-pt). If sets are split, a 10-pt match tiebreak appears automatically.
      </p>
    </div>
  );
}

export default function MatchDetail() {
  const params = useParams<{ id: string }>();
  const matchId = parseInt(params.id ?? "");
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useUser();
  const { getToken } = useAuth();
  const updateMatch = useUpdateMatch();
  const isMobile = useIsMobile();

  const [sets, setSets] = useState<SetScore[]>([{ p1: "", p2: "" }, { p1: "", p2: "" }, { p1: "", p2: "" }]);
  const [notes, setNotes] = useState("");

  // Score dialog state — null = closed, "complete" = completing match, "save" = saving progress
  const [scoreDialogMode, setScoreDialogMode] = useState<null | "complete" | "save">(null);
  const [saveReason, setSaveReason] = useState("");
  const [matchDuration, setMatchDuration] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const calibrationFrameRef = useRef<HTMLDivElement | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chunkUploadsRef = useRef<Array<Record<string, unknown>>>([]);
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const chunkSequenceRef = useRef(0);
  const ballBoiStartRef = useRef<number>(0);
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [ballBoiElapsed, setBallBoiElapsed] = useState(0);
  const ballBoiTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [ballBoiSession, setBallBoiSession] = useState<BallBoiSession | null>(null);
  const [ballBoiShots, setBallBoiShots] = useState<MatchShot[]>([]);
  const [ballBoiRecording, setBallBoiRecording] = useState(false);
  const [ballBoiUploading, setBallBoiUploading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [analyzingOpen, setAnalyzingOpen] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisMessage, setAnalysisMessage] = useState("Preparing replay analysis...");
  const [ballBoiPanelOpen, setBallBoiPanelOpen] = useState(true);
  const [ballBoiDensity, setBallBoiDensity] = useState<"minimal" | "standard" | "advanced">("standard");
  const [ballBoiCalibrating, setBallBoiCalibrating] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<CourtCalibrationPoint[]>([]);
  const [calibrationCameraReady, setCalibrationCameraReady] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetectError, setAutoDetectError] = useState<string | null>(null);
  const [autoDetected, setAutoDetected] = useState(false);
  const [autoDetectLowConfidence, setAutoDetectLowConfidence] = useState(false);
  const [mlOffline, setMlOffline] = useState(false);

  // Arrange match state (for unscheduled matches)
  const [arrangeDate, setArrangeDate] = useState("");
  const [arrangeHour, setArrangeHour] = useState("09");
  const [arrangeMinute, setArrangeMinute] = useState("00");
  const [arrangeLocation, setArrangeLocation] = useState("");
  const [arrangeSaving, setArrangeSaving] = useState(false);

  // Edit schedule state (for already-scheduled matches)
  const [isEditingSchedule, setIsEditingSchedule] = useState(false);

  const { data: myPlayers } = useQuery<Array<{ id: number; leagueId: number | null }>>({
    queryKey: ["players", "me"],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/players/me", token);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const { data: match, isLoading } = useGetMatch(matchId, {
    query: { enabled: !!matchId, queryKey: ["match", matchId] as any },
  });

  // Seed sets from persisted score when match loads
  useEffect(() => {
    if (match?.score) {
      setSets(parseScore(match.score));
    }
    if (match?.notes) {
      setNotes(match.notes);
    }
  }, [match?.id, match?.score]);


  useEffect(() => {
    let cancelled = false;
    const checkHealth = () => {
      getMlHealth().then(({ reachable }) => {
        if (!cancelled) setMlOffline(!reachable);
      });
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const captureLiveShot = async (sessionId: number) => {
    try {
      const token = await getToken();
      const timestampSeconds = (Date.now() - ballBoiStartRef.current) / 1000;
      const frameImage = captureFrameImage();
      if (!frameImage) return;
      const shot = await sendLiveShot(sessionId, token, timestampSeconds, frameImage);
      if (shot) setBallBoiShots((current) => [...current, shot].slice(-12));
    } catch {
      setCameraError("Live shot detection is temporarily unavailable.");
    }
  };

  const captureFrameImage = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = Math.round((video.videoHeight / video.videoWidth) * 480);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  };

  const handleStartBallBoi = async () => {
    if (!match || ballBoiRecording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setCameraError("This browser does not support camera recording.");
      return;
    }
    setCameraError(null);
    try {
      const stream = streamRef.current ?? await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: true });
      streamRef.current = stream;
      setCalibrationPoints([]);
      setCalibrationCameraReady(false);
      chunksRef.current = [];
      chunkUploadsRef.current = [];
      uploadQueueRef.current = Promise.resolve();
      chunkSequenceRef.current = 0;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        await videoRef.current.play().catch(() => undefined);
      }
      setBallBoiCalibrating(true);
      setBallBoiPanelOpen(true);
      toast({ title: "Calibrate Ball Boi", description: "Tap the four visible court corners, then start recording." });
    } catch (err) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setBallBoiCalibrating(false);
      setCameraError(err instanceof Error ? err.message : "Unable to start camera preview.");
      toast({ title: "Could not start Ball Boi", variant: "destructive" });
    }
  };

  const placeCalibrationPoint = (clientX: number, clientY: number) => {
    if (!ballBoiCalibrating || !calibrationCameraReady) return;
    const displayRect = getVideoDisplayRect();
    const x = (clientX - displayRect.left) / displayRect.width;
    const y = (clientY - displayRect.top) / displayRect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    const newPoint = { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) };
    if (calibrationPoints.length < 4) {
      setCalibrationPoints((points) => [...points, newPoint]);
      setAutoDetectError(null);
    } else {
      // All 4 set — find the nearest existing corner and replace it
      let nearestIdx = 0;
      let nearestDist = Infinity;
      calibrationPoints.forEach((pt, idx) => {
        const dist = Math.hypot(pt.x - x, pt.y - y);
        if (dist < nearestDist) { nearestDist = dist; nearestIdx = idx; }
      });
      setCalibrationPoints((points) => points.map((pt, idx) => idx === nearestIdx ? newPoint : pt));
      setAutoDetected(false);
    }
  };

  const handleCalibrationTap = (event: MouseEvent<HTMLDivElement>) => {
    placeCalibrationPoint(event.clientX, event.clientY);
  };

  const handleCalibrationTouch = (event: React.TouchEvent<HTMLDivElement>) => {
    event.preventDefault(); // prevent ghost mouse click on iOS
    const touch = event.changedTouches[0];
    if (!touch) return;
    placeCalibrationPoint(touch.clientX, touch.clientY);
  };

  const getVideoDisplayRect = () => {
    const container = calibrationFrameRef.current;
    const video = videoRef.current;
    const rect = container?.getBoundingClientRect();
    if (!rect || !video?.videoWidth || !video.videoHeight) {
      return rect ?? { left: 0, top: 0, width: 1, height: 1 };
    }
    const containerAspect = rect.width / rect.height;
    const videoAspect = video.videoWidth / video.videoHeight;
    if (containerAspect > videoAspect) {
      const height = rect.height;
      const width = height * videoAspect;
      return { left: rect.left + (rect.width - width) / 2, top: rect.top, width, height };
    }
    const width = rect.width;
    const height = width / videoAspect;
    return { left: rect.left, top: rect.top + (rect.height - height) / 2, width, height };
  };

  const calibrationPointStyle = (point: CourtCalibrationPoint) => {
    const container = calibrationFrameRef.current?.getBoundingClientRect();
    const displayRect = getVideoDisplayRect();
    if (!container) return { left: `${point.x * 100}%`, top: `${point.y * 100}%` };
    return {
      left: `${displayRect.left - container.left + point.x * displayRect.width}px`,
      top: `${displayRect.top - container.top + point.y * displayRect.height}px`,
    };
  };

  const buildCourtCalibration = (): CourtCalibration | null => {
    if (calibrationPoints.length !== 4) return null;
    return {
      version: 1,
      pointOrder: COURT_CALIBRATION_LABELS,
      points: calibrationPoints,
      capturedAt: new Date().toISOString(),
    };
  };

  const handleResetCalibration = () => {
    setCalibrationPoints([]);
    setAutoDetected(false);
    setAutoDetectError(null);
    setAutoDetectLowConfidence(false);
  };

  const handleCancelCalibration = () => {
    setBallBoiCalibrating(false);
    setCalibrationCameraReady(false);
    setCalibrationPoints([]);
    setAutoDetected(false);
    setAutoDetectError(null);
    setAutoDetectLowConfidence(false);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const handleAutoDetect = async () => {
    const frameImage = captureFrameImage();
    if (!frameImage) {
      setAutoDetectError("Camera not ready — wait for the preview to load");
      return;
    }
    setAutoDetecting(true);
    setAutoDetectError(null);
    setAutoDetected(false);
    setAutoDetectLowConfidence(false);
    try {
      const token = await getToken();
      const result = await detectCourt(frameImage, token);
      if (result.success) {
        const LOW_CONFIDENCE_THRESHOLD = 0.4;
        if (result.confidence < LOW_CONFIDENCE_THRESHOLD) {
          setAutoDetectError(`Low confidence detection (${Math.round(result.confidence * 100)}%) — corners may be inaccurate. Tap to reposition or reset and try again.`);
          setCalibrationPoints(result.corners);
          setAutoDetectLowConfidence(true);
        } else {
          setCalibrationPoints(result.corners);
          setAutoDetected(true);
        }
      } else {
        setAutoDetectError(result.error);
      }
    } catch {
      setAutoDetectError("Detection request failed — check your connection and try again");
    } finally {
      setAutoDetecting(false);
    }
  };

  const beginBallBoiRecording = async (useCalibration: boolean) => {
    if (!match || ballBoiRecording) return;
    if (useCalibration && calibrationPoints.length !== 4) {
      setCameraError("Tap all four court corners before starting calibrated recording.");
      return;
    }
    setCameraError(null);
    let session: BallBoiSession | null = null;
    let token: string | null = null;
    try {
      token = await getToken();
      session = await startBallBoiSession(matchId, token, useCalibration ? buildCourtCalibration() : null);
      const stream = streamRef.current ?? await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        await videoRef.current.play().catch(() => undefined);
      }
      const contentType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType: contentType });
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
          enqueueChunkUpload(session!.id, event.data, contentType);
        }
      };
      mediaRecorderRef.current = recorder;
      ballBoiStartRef.current = Date.now();
      setBallBoiElapsed(0);
      ballBoiTimerRef.current = setInterval(() => {
        setBallBoiElapsed(Math.floor((Date.now() - ballBoiStartRef.current) / 1000));
      }, 1000);
      recorder.start(5_000);
      setBallBoiSession(session);
      setBallBoiShots([]);
      setBallBoiRecording(true);
      setBallBoiCalibrating(false);
      await captureLiveShot(session.id);
      liveIntervalRef.current = setInterval(() => captureLiveShot(session!.id), 5_000);
      toast({ title: "Ball Boi recording started", description: useCalibration ? "Court calibration is active for live detections and replay heatmaps." : "Camera recording and live shot detection are running." });
    } catch (err) {
      if (session?.id) {
        await cancelBallBoiSession(session.id, token, err instanceof Error ? err.message : "Recording setup failed").catch(() => undefined);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setBallBoiCalibrating(false);
      setCalibrationCameraReady(false);
      setCameraError(err instanceof Error ? err.message : "Unable to start camera recording.");
      toast({ title: "Could not start Ball Boi", variant: "destructive" });
    }
  };

  const enqueueChunkUpload = (sessionId: number, blob: Blob, contentType: string) => {
    const sequence = ++chunkSequenceRef.current;
    uploadQueueRef.current = uploadQueueRef.current.then(async () => {
      const token = await getToken();
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const upload = await requestBallBoiUploadUrl(sessionId, token);
          const putRes = await fetch(upload.uploadURL, { method: "PUT", headers: { "Content-Type": contentType || blob.type || "video/webm" }, body: blob });
          if (!putRes.ok) throw new Error("Chunk upload failed");
          chunkUploadsRef.current.push({ sequence, objectPath: upload.objectPath, sizeBytes: blob.size, contentType: contentType || blob.type || "video/webm" });
          return;
        } catch (err) {
          if (attempt === 3) throw err;
          await new Promise((resolve) => setTimeout(resolve, attempt * 750));
        }
      }
    }).catch(() => {
      setCameraError("A video chunk could not upload after retrying. Final upload will still run when recording stops.");
    });
  };

  const handleStopBallBoi = async () => {
    if (!ballBoiSession || !mediaRecorderRef.current) return;
    setBallBoiUploading(true);
    if (ballBoiTimerRef.current) clearInterval(ballBoiTimerRef.current);
    if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
    const recorder = mediaRecorderRef.current;
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    await uploadQueueRef.current.catch(() => undefined);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setBallBoiRecording(false);
    try {
      const token = await getToken();
      const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "video/webm" });
      const upload = await requestBallBoiUploadUrl(ballBoiSession.id, token);
      const putRes = await fetch(upload.uploadURL, { method: "PUT", headers: { "Content-Type": blob.type || "video/webm" }, body: blob });
      if (!putRes.ok) throw new Error("Video upload failed");
      const durationSeconds = Math.max(1, Math.round((Date.now() - ballBoiStartRef.current) / 1000));
      const completed = await completeBallBoiSession(ballBoiSession.id, token, {
        objectPath: upload.objectPath,
        contentType: blob.type || "video/webm",
        sizeBytes: blob.size,
        durationSeconds,
        chunks: chunkUploadsRef.current,
      });
      setBallBoiSession(completed);
      setAnalyzingOpen(true);
      setAnalysisProgress(10);
      setAnalysisMessage("Uploading complete. Analyzing video and live shot data...");
      pollAnalysisStatus(completed.id);
      toast({ title: "Ball Boi replay is processing", description: "Open the replay page to view shots, stats, and video analysis." });
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : "Unable to upload match recording.");
      toast({ title: "Ball Boi upload failed", variant: "destructive" });
    } finally {
      setBallBoiUploading(false);
    }
  };

  const pollAnalysisStatus = async (sessionId: number) => {
    const token = await getToken();
    for (let i = 0; i < 120; i += 1) {
      const status = await getBallBoiStatus(sessionId, token).catch(() => null);
      if (status) {
        setAnalysisProgress(status.progress);
        const hasPendingRetry = status.processingStatus === "failed" && status.nextRetryAt != null;
        const retryMessage = (() => {
          if (!hasPendingRetry) return null;
          const retryNum = status.retryCount != null ? status.retryCount + 1 : 1;
          const ts = status.nextRetryAt ? new Date(status.nextRetryAt).getTime() : null;
          const diffMs = ts != null && !isNaN(ts) ? ts - Date.now() : null;
          const diffMin = diffMs != null && diffMs > 0 ? Math.ceil(diffMs / 60000) : null;
          const timeStr = diffMin != null ? `~${diffMin} minute${diffMin !== 1 ? "s" : ""}` : "shortly";
          return `Retry ${retryNum} of 3 scheduled in ${timeStr}`;
        })();
        const failedMessage = (() => {
          if (retryMessage) return retryMessage;
          const err = status.processingError ?? "";
          const isServiceDown = err.toLowerCase().includes("temporarily unavailable");
          return isServiceDown ? "Analysis service is temporarily unavailable — your video has been saved and will be processed when the service is back online." : (err || "Replay analysis failed.");
        })();
        setAnalysisMessage(status.processingStatus === "completed" ? "Replay analysis is complete." : status.processingStatus === "failed" ? failedMessage : `Analyzing replay data... ${status.shotCount} shots detected`);
        if (status.processingStatus === "completed") return;
        if (status.processingStatus === "failed" && !hasPendingRetry) return;
        if (hasPendingRetry) {
          await new Promise((resolve) => setTimeout(resolve, 30000));
          continue;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    setAnalysisMessage("Analysis is still running. You can open the replay page and it will keep updating.");
  };

  // Reset dialog score state when dialog opens
  const openDialog = (mode: "complete" | "save") => {
    // Pre-populate from saved score if any
    if (match?.score) {
      setSets(parseScore(match.score));
    } else {
      setSets([{ p1: "", p2: "" }, { p1: "", p2: "" }, { p1: "", p2: "" }]);
    }
    setNotes(match?.notes ?? "");
    setSaveReason("");
    setScoreDialogMode(mode);
  };

  const handleSaveProgress = () => {
    if (!match) return;
    if (!saveReason) {
      toast({ title: "Please select a reason for pausing", variant: "destructive" });
      return;
    }
    const score = formatScore(sets);
    const reasonLabel = STOP_REASONS.find((r) => r.value === saveReason)?.label ?? saveReason;
    const combinedNotes = notes
      ? `Stopped: ${reasonLabel}. ${notes}`
      : `Stopped: ${reasonLabel}.`;

    updateMatch.mutate(
      { matchId, data: { score: score || undefined, notes: combinedNotes } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetMatchQueryKey(matchId) });
          toast({ title: "Progress saved" });
          setScoreDialogMode(null);
        },
        onError: () => toast({ title: "Failed to save progress", variant: "destructive" }),
      }
    );
  };

  const handleCompleteMatch = async () => {
    if (!match) return;
    const score = formatScore(sets);
    if (!score) {
      toast({ title: "Enter at least one set score before completing", variant: "destructive" });
      return;
    }
    if (ballBoiRecording) {
      setAnalysisMessage("Stopping Ball Boi recording before completing match...");
      setAnalyzingOpen(true);
      await handleStopBallBoi();
    }

    const winnerId = determineWinner(sets, match.player1Id, match.player2Id);
    updateMatch.mutate(
      {
        matchId,
        data: {
          score,
          status: "completed",
          winnerId,
          completedAt: new Date().toISOString(),
          recordedByClerkUserId: user?.id,
          recordedAt: new Date().toISOString(),
          notes: notes || undefined,
          durationMinutes: matchDuration ? parseInt(matchDuration, 10) : undefined,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetMatchQueryKey(matchId) });
          toast({ title: "Match completed" });
          setScoreDialogMode(null);
          setMatchDuration("");
        },
        onError: (error) =>
          toast({
            title: error instanceof Error ? error.message : "Failed to complete match",
            variant: "destructive",
          }),
      }
    );
  };


  if (isLoading)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="h-48 bg-card border border-card-border rounded-lg" />
      </div>
    );
  if (!match) return <div className="text-muted-foreground">Match not found</div>;

  const doublesMatch = !!match.player3Id;
  const team1Won = doublesMatch ? match.winnerId === match.player1Id : false;
  const team2Won = doublesMatch ? match.winnerId === match.player2Id : false;
  const team1Label = doublesMatch ? `${match.player1Name} & ${match.player3Name}` : match.player1Name;
  const team2Label = doublesMatch ? `${match.player2Name} & ${match.player4Name}` : match.player2Name;

  const isInProgress = match.status === "in_progress";

  const myPlayerIds = myPlayers?.map((p) => p.id) ?? [];
  const participantIds = [match.player1Id, match.player2Id, match.player3Id, match.player4Id].filter((id): id is number => id != null);
  const isParticipant = myPlayerIds.some((id) => participantIds.includes(id));
  const needsArranging = match.status === "scheduled" && !match.scheduledAt && isParticipant;
  const today = new Date().toISOString().slice(0, 10);
  const roundEndDate = (match as any).roundEndDate as string | null | undefined;
  const roundHasEnded = !!(roundEndDate && roundEndDate < today);

  const handleArrangeSave = () => {
    if (!arrangeDate) {
      toast({ title: "Please select a date", variant: "destructive" });
      return;
    }
    const scheduledAt = `${arrangeDate}T${arrangeHour}:${arrangeMinute}`;
    setArrangeSaving(true);
    updateMatch.mutate(
      {
        matchId,
        data: {
          scheduledAt,
          location: arrangeLocation || undefined,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetMatchQueryKey(matchId) });
          toast({ title: "Match time set — your opponent has been notified." });
          setArrangeSaving(false);
        },
        onError: () => {
          toast({ title: "Could not save match details", variant: "destructive" });
          setArrangeSaving(false);
        },
      }
    );
  };

  const handleEnterEditSchedule = () => {
    if (!match?.scheduledAt) return;
    const d = new Date(match.scheduledAt);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    setArrangeDate(`${year}-${month}-${day}`);
    setArrangeHour(String(d.getHours()).padStart(2, "0"));
    setArrangeMinute(String(d.getMinutes()).padStart(2, "0"));
    setArrangeLocation(match.location ?? "");
    setIsEditingSchedule(true);
  };

  const handleEditSave = () => {
    if (!arrangeDate) {
      toast({ title: "Please select a date", variant: "destructive" });
      return;
    }
    const scheduledAt = `${arrangeDate}T${arrangeHour}:${arrangeMinute}`;
    setArrangeSaving(true);
    updateMatch.mutate(
      {
        matchId,
        data: {
          scheduledAt,
          location: arrangeLocation || undefined,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetMatchQueryKey(matchId) });
          toast({ title: "Match details updated." });
          setArrangeSaving(false);
          setIsEditingSchedule(false);
        },
        onError: () => {
          toast({ title: "Could not save match details", variant: "destructive" });
          setArrangeSaving(false);
        },
      }
    );
  };

  const hasPartialScore = sets.some((s) => s.p1 !== "" && s.p2 !== "");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={match.leagueId ? `/leagues/${match.leagueId}` : "/matches"} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to league
        </Link>
        {match.roundId && match.roundNumber != null && (
          <span className="text-xs text-muted-foreground/70">
            · Round {match.roundNumber}{match.leagueName ? ` · ${match.leagueName}` : ""}
          </span>
        )}
        {(match as any).season && (
          <span className={cn(
            "text-[11px] font-semibold px-2 py-0.5 rounded uppercase tracking-wider border",
            (match as any).season === "Summer League"
              ? "border-primary/40 text-primary/80"
              : "border-border text-muted-foreground"
          )}>
            {(match as any).season}
          </span>
        )}
      </div>

      {/* Match card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card border border-card-border rounded-lg p-6"
      >
        {/* Status */}
        <div className="flex justify-center gap-2 mb-3 flex-wrap">
          <span className={cn("text-[11px] font-medium px-2.5 py-1 rounded-full", statusBadge(match.status))}>
            {statusLabel(match.status)}
          </span>
          {(match as any).playoffRound && (
            <span className="text-[11px] font-semibold border border-primary/40 text-primary px-2.5 py-1 rounded-full uppercase tracking-wider">
              {(match as any).playoffRound === "quarterfinal"
                ? "Quarterfinal"
                : (match as any).playoffRound === "semifinal"
                ? "Semifinal"
                : "Final"}
            </span>
          )}
        </div>

        {/* Date */}
        {match.scheduledAt && !isEditingSchedule && (
          <div className="flex items-center justify-center gap-2 mb-5">
            <span className="text-sm text-muted-foreground">
              {new Date(match.scheduledAt).toLocaleDateString("en-US", {
                weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
              })}
            </span>
            {isParticipant && match.status !== "completed" && (
              <button
                onClick={handleEnterEditSchedule}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                title="Edit date & location"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}


        {/* Inline edit schedule form */}
        {isEditingSchedule && (
          <div className="mb-5 p-4 rounded-lg border border-primary/25 bg-card/60 space-y-3 overflow-hidden">
            {roundHasEnded && (
              <p className="text-xs text-warning">
                Round ended {roundEndDate} — you can reschedule to any future date.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</label>
                <input
                  type="date"
                  value={arrangeDate}
                  min={today}
                  onChange={(e) => setArrangeDate(e.target.value)}
                  className="w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:dark]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Time</label>
                <div className="flex gap-2">
                  <Select
                    value={h24to12(arrangeHour)}
                    onValueChange={(v) => setArrangeHour(h12to24(v, h24toPeriod(arrangeHour)))}
                  >
                    <SelectTrigger className="flex-1 min-w-0"><SelectValue placeholder="Hr" /></SelectTrigger>
                    <SelectContent>
                      {HOUR_OPTIONS_12.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={arrangeMinute} onValueChange={setArrangeMinute}>
                    <SelectTrigger className="w-20 shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["00", "15", "30", "45"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="flex rounded-md border border-input overflow-hidden shrink-0">
                    {(["AM", "PM"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setArrangeHour(h12to24(h24to12(arrangeHour), p))}
                        className={cn(
                          "px-3 py-2 text-sm font-semibold transition-colors",
                          h24toPeriod(arrangeHour) === p
                            ? "bg-primary text-primary-foreground"
                            : "bg-background text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <MapPin className="w-3 h-3" /> Location (optional)
              </label>
              <Input
                type="text"
                placeholder="Court name or address"
                autoComplete="street-address"
                value={arrangeLocation}
                onChange={(e) => setArrangeLocation(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleEditSave}
                disabled={arrangeSaving || !arrangeDate}
                className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                {arrangeSaving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setIsEditingSchedule(false)}
                disabled={arrangeSaving}
                className="px-4 py-2 rounded-md border border-border text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Players — vertically stacked */}
        <div className="flex flex-col items-center gap-1">
          {/* Player 1 */}
          <div className="text-center">
            {doublesMatch ? (
              <div className={cn("text-xl font-extrabold leading-snug", team1Won ? "text-primary" : "text-foreground")}>
                {match.player1Name}
                <span className="block text-sm font-semibold text-muted-foreground">& {match.player3Name}</span>
              </div>
            ) : (
              <Link
                href={`/players/${match.player1Id}`}
                className={cn("text-2xl font-extrabold transition-colors hover:opacity-80", match.winnerId === match.player1Id ? "text-primary" : "text-foreground")}
              >
                {match.player1Name}
              </Link>
            )}
            {(doublesMatch ? team1Won : match.winnerId === match.player1Id) && (
              <div className="flex items-center justify-center gap-1 mt-1 text-primary text-xs font-semibold">
                <Trophy className="w-3.5 h-3.5" /> Winner
              </div>
            )}
          </div>

          {/* vs divider */}
          <div className="text-xs font-bold text-muted-foreground tracking-widest uppercase py-1">vs</div>

          {/* Player 2 */}
          <div className="text-center">
            {doublesMatch ? (
              <div className={cn("text-xl font-extrabold leading-snug", team2Won ? "text-primary" : "text-foreground")}>
                {match.player2Name}
                <span className="block text-sm font-semibold text-muted-foreground">& {match.player4Name}</span>
              </div>
            ) : (
              <Link
                href={`/players/${match.player2Id}`}
                className={cn("text-2xl font-extrabold transition-colors hover:opacity-80", match.winnerId === match.player2Id ? "text-primary" : "text-foreground")}
              >
                {match.player2Name}
              </Link>
            )}
            {(doublesMatch ? team2Won : match.winnerId === match.player2Id) && (
              <div className="flex items-center justify-center gap-1 mt-1 text-primary text-xs font-semibold">
                <Trophy className="w-3.5 h-3.5" /> Winner
              </div>
            )}
          </div>

          {/* Score */}
          {match.score && (
            <div className="mt-3">
              <span className="text-xl font-extrabold font-mono text-foreground tracking-widest whitespace-nowrap">
                {formatDisplayScore(match.score)}
              </span>
            </div>
          )}
        </div>

        {/* Meta */}
        {(match.location || match.completedAt || match.durationMinutes || match.notes) && (
          <div className="mt-6 pt-4 border-t border-border space-y-1.5 text-sm text-muted-foreground">
            {match.location && <div>Location: <span className="text-foreground">{match.location}</span></div>}
            {match.completedAt && <div>Completed: <span className="text-foreground">{new Date(match.completedAt).toLocaleDateString()}</span></div>}
            {match.durationMinutes && <div>Duration: <span className="text-foreground font-medium">{formatDuration(match.durationMinutes)}</span></div>}
            {match.recordedAt && <div>Recorded: <span className="text-foreground">{new Date(match.recordedAt).toLocaleDateString()}</span></div>}
            {match.notes && <div className="mt-2 text-sm italic">"{match.notes}"</div>}
          </div>
        )}

        {/* CTAs */}
        <div className="mt-5 pt-4 border-t border-border flex flex-col gap-2">
          {isInProgress && (
            <>
              <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-warning/10 border border-warning/30 text-warning text-sm font-bold cursor-default select-none">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-warning" />
                </span>
                In Progress
              </div>
              <button
                onClick={() => openDialog("save")}
                disabled={updateMatch.isPending}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-md bg-card border border-border text-foreground text-sm font-semibold hover:bg-accent transition-colors disabled:opacity-40"
              >
                <PauseCircle className="w-4 h-4 text-muted-foreground" />
                Save Progress
              </button>
            </>
          )}
          {match.status !== "completed" && !ballBoiRecording && (
            <button
              onClick={handleStartBallBoi}
              disabled={ballBoiUploading}
              className="flex items-center justify-center gap-2 w-full px-5 py-2.5 rounded-md bg-card border border-border text-foreground text-sm font-semibold hover:bg-accent transition-colors disabled:opacity-50"
            >
              <Video className="w-4 h-4 text-muted-foreground" />
              Record w/ Ball Boi
            </button>
          )}
          {match.status !== "completed" && (
            <button
              onClick={() => openDialog("complete")}
              disabled={updateMatch.isPending}
              className="flex items-center justify-center gap-2 w-full px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Edit2 className="w-4 h-4" />
              Enter Score
            </button>
          )}
          {match.status === "completed" && isParticipant && (
            <button
              onClick={() => openDialog("complete")}
              disabled={updateMatch.isPending}
              className="flex items-center justify-center gap-2 w-full px-5 py-2.5 rounded-md bg-card border border-border text-foreground text-sm font-semibold hover:bg-accent transition-colors disabled:opacity-50"
            >
              <Edit2 className="w-4 h-4 text-muted-foreground" />
              Edit Score
            </button>
          )}
        </div>
      </motion.div>

      {/* Arrange this match — shown to participants when no time is set */}
      {needsArranging && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-primary/25 rounded-lg p-5 space-y-4 overflow-hidden"
        >
          <div>
            <h2 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-foreground">
              <CalendarDays className="h-4 w-4 text-primary" />
              Arrange this match
            </h2>
            {roundHasEnded ? (
              <p className="text-xs text-warning mt-1">
                The round window ended {roundEndDate} — you can still schedule this match for any future date.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">
                The admin has assigned you a matchup. Coordinate with your opponent and set when and where you'll play.
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</label>
              <input
                type="date"
                value={arrangeDate}
                min={today}
                onChange={(e) => setArrangeDate(e.target.value)}
                className="w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:dark]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Time</label>
              <div className="flex gap-2">
                <Select
                  value={h24to12(arrangeHour)}
                  onValueChange={(v) => setArrangeHour(h12to24(v, h24toPeriod(arrangeHour)))}
                >
                  <SelectTrigger className="flex-1 min-w-0"><SelectValue placeholder="Hr" /></SelectTrigger>
                  <SelectContent>
                    {HOUR_OPTIONS_12.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={arrangeMinute} onValueChange={setArrangeMinute}>
                  <SelectTrigger className="w-20 shrink-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["00", "15", "30", "45"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex rounded-md border border-input overflow-hidden shrink-0">
                  {(["AM", "PM"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setArrangeHour(h12to24(h24to12(arrangeHour), p))}
                      className={cn(
                        "px-3 py-2 text-sm font-semibold transition-colors",
                        h24toPeriod(arrangeHour) === p
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <MapPin className="w-3 h-3" /> Location (optional)
            </label>
            <Input
              type="text"
              placeholder="Court name or address"
              autoComplete="street-address"
              value={arrangeLocation}
              onChange={(e) => setArrangeLocation(e.target.value)}
              className="w-full"
            />
          </div>
          <button
            onClick={handleArrangeSave}
            disabled={arrangeSaving || !arrangeDate}
            className="flex items-center gap-2 px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            {arrangeSaving ? "Saving..." : "Save Match Details"}
          </button>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/15 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-foreground">
              <Video className="h-4 w-4 text-primary" />
              Ball Boi Mode
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">Record match video, detect shots live, and generate a full replay package.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {ballBoiRecording ? (
              <Button onClick={handleStopBallBoi} disabled={ballBoiUploading} size="sm" variant="destructive">
                <Square className="mr-1.5 h-4 w-4" />
                {ballBoiUploading ? "Uploading..." : "Stop Recording"}
              </Button>
            ) : ballBoiCalibrating ? (
              <Button onClick={() => beginBallBoiRecording(calibrationPoints.length === 4)} disabled={ballBoiUploading || !calibrationCameraReady || (calibrationPoints.length > 0 && calibrationPoints.length < 4)} size="sm">
                <Video className="mr-1.5 h-4 w-4" />
                {calibrationPoints.length === 4 ? "Start Calibrated Recording" : calibrationPoints.length > 0 ? `${4 - calibrationPoints.length} Corners Left` : "Skip & Record"}
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href={`/matches/${matchId}/replay`}>
                <BarChart3 className="mr-1.5 h-4 w-4" />
                Replay
              </Link>
            </Button>
          </div>
        </div>
        {mlOffline && !ballBoiRecording && (
          <div className="flex items-start gap-2 border-b border-warning/20 bg-warning/10 px-5 py-3 text-sm text-warning">
            <span className="mt-0.5 shrink-0">⚠</span>
            <span>Analysis service is offline — recording will still be saved but video analysis will be delayed.</span>
          </div>
        )}
        <div className="grid gap-4 p-5 lg:grid-cols-[1fr_300px]">
          <div ref={calibrationFrameRef} onClick={handleCalibrationTap} onTouchEnd={handleCalibrationTouch} className={cn("relative overflow-hidden rounded-lg border border-border bg-black", ballBoiCalibrating && "cursor-crosshair ring-2 ring-primary/40")}>
            <video ref={videoRef} autoPlay playsInline muted onLoadedMetadata={() => setCalibrationCameraReady(true)} onCanPlay={() => setCalibrationCameraReady(true)} className="aspect-video w-full object-contain" />
            {!ballBoiRecording && !ballBoiCalibrating && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                Camera preview appears after recording starts.
              </div>
            )}
            {ballBoiCalibrating && (
              <div className="absolute inset-0">
                <div className="absolute left-3 right-3 top-3 rounded-lg border border-primary/30 bg-black/70 px-3 py-2 text-xs text-white backdrop-blur">
                  {calibrationCameraReady ? calibrationPoints.length < 4 ? `Tap ${COURT_CALIBRATION_LABELS[calibrationPoints.length]} (${calibrationPoints.length}/4)` : "Tap any corner to reposition it" : "Camera warming up..."}
                </div>
                {calibrationPoints.map((point, index) => (
                  <div
                    key={`${point.x}-${point.y}-${index}`}
                    className="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-primary bg-black/70 text-xs font-extrabold text-primary shadow-lg shadow-primary/40"
                    style={calibrationPointStyle(point)}
                  >
                    {index + 1}
                  </div>
                ))}
              </div>
            )}
            {ballBoiRecording && (
              <div className="absolute left-3 top-3 rounded-full border border-red-400/40 bg-red-500/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-red-200">
                Recording
              </div>
            )}
            {ballBoiRecording && (
              <div className="absolute right-3 top-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBallBoiPanelOpen((open) => !open)}
                  className="rounded-full border border-white/20 bg-black/60 p-2 text-white backdrop-blur transition-colors hover:bg-black/80"
                  aria-label="Toggle Ball Boi overlay"
                >
                  <Activity className="h-4 w-4 text-primary" />
                </button>
              </div>
            )}
            {ballBoiRecording && (
              <div className="absolute bottom-3 left-3 right-3 space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-white/15 bg-black/55 px-3 py-2 text-xs text-white backdrop-blur">
                  <span className="font-mono">{formatElapsed(ballBoiElapsed)}</span>
                  <span className="font-semibold">{match.score ? formatDisplayScore(match.score) : "Score pending"}</span>
                  <span className="flex items-center gap-1 font-mono"><Activity className="h-3.5 w-3.5 text-primary" />{ballBoiShots.length}</span>
                </div>
                {ballBoiPanelOpen && (
                  <div className="rounded-xl border border-white/15 bg-black/65 p-3 text-white shadow-xl backdrop-blur">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                        <Video className="h-3.5 w-3.5 text-primary" />
                        Ball Boi Live
                      </div>
                      <div className="flex rounded-md border border-white/10 bg-white/5 p-0.5">
                        {(["minimal", "standard", "advanced"] as const).map((density) => (
                          <button
                            key={density}
                            type="button"
                            onClick={() => setBallBoiDensity(density)}
                            className={cn("rounded px-2 py-1 text-xs font-semibold capitalize", ballBoiDensity === density ? "bg-primary text-primary-foreground" : "text-white/70 hover:text-white")}
                          >
                            {density}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={cn("grid gap-2 text-center", ballBoiDensity === "minimal" ? "grid-cols-2" : "grid-cols-3")}>
                      <div className="rounded-lg bg-white/10 px-2 py-2">
                        <div className="text-lg font-extrabold">{ballBoiShots.length}</div>
                        <div className="text-[11px] uppercase text-white/60">Shots</div>
                      </div>
                      <div className="rounded-lg bg-white/10 px-2 py-2">
                        <div className="text-lg font-extrabold text-primary">{Math.round(ballBoiShots.at(-1)?.speedMph ?? 0)}</div>
                        <div className="text-[11px] uppercase text-white/60">MPH</div>
                      </div>
                      {ballBoiDensity !== "minimal" && (
                        <div className="rounded-lg bg-white/10 px-2 py-2">
                          <div className="text-lg font-extrabold">{ballBoiRecording ? "Live" : "Ready"}</div>
                          <div className="text-[11px] uppercase text-white/60">Status</div>
                        </div>
                      )}
                    </div>
                    {ballBoiDensity === "advanced" && (
                      <div className="mt-3 max-h-28 space-y-1 overflow-y-auto text-xs">
                        {ballBoiShots.slice(-4).reverse().map((shot) => (
                          <div key={shot.id} className="flex justify-between rounded bg-white/10 px-2 py-1">
                            <span className="capitalize">{shot.shotType.replace(/_/g, " ")}</span>
                            <span className="font-mono text-primary">{Math.round(shot.speedMph ?? 0)} mph</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="space-y-3">
            {ballBoiCalibrating && (
              <div className="rounded-lg border border-primary/25 bg-primary/10 p-4">
                <div className="text-sm font-bold text-foreground">Court calibration</div>
                <p className="mt-1 text-xs text-muted-foreground">{calibrationCameraReady ? "Tap the court corners in order: near left, near right, far right, far left — or use Auto-Detect to fill them automatically." : "Wait for the camera preview to finish loading before tapping court corners."}</p>
                <div className="mt-3 space-y-1.5 text-xs">
                  {COURT_CALIBRATION_LABELS.map((label, index) => (
                    <div key={label} className={cn("flex items-center justify-between rounded border px-2 py-1.5", calibrationPoints[index] ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
                      <span>{index + 1}. {label}</span>
                      <span>{calibrationPoints[index] ? autoDetected && index < calibrationPoints.length ? "Auto" : "Set" : "Tap"}</span>
                    </div>
                  ))}
                </div>
                {autoDetectError && (
                  <p className={cn("mt-2 rounded border px-2 py-1.5 text-xs", autoDetectLowConfidence ? "border-warning/40 bg-warning/10 text-warning" : "border-destructive/40 bg-destructive/10 text-destructive")}>{autoDetectError}</p>
                )}
                {autoDetected && !autoDetectLowConfidence && calibrationPoints.length === 4 && (
                  <p className="mt-2 rounded border border-primary/30 bg-primary/10 px-2 py-1.5 text-xs text-primary">Corners detected — verify they look right, then start or tap to adjust.</p>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline" className="col-span-2" onClick={handleAutoDetect} disabled={!calibrationCameraReady || autoDetecting}>
                    {autoDetecting ? "Detecting..." : "Auto-Detect Court"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleResetCalibration} disabled={autoDetecting}>Reset</Button>
                  <Button size="sm" onClick={() => beginBallBoiRecording(true)} disabled={!calibrationCameraReady || calibrationPoints.length !== 4}>Start calibrated</Button>
                  <Button size="sm" variant="outline" onClick={handleCancelCalibration}>Cancel</Button>
                  <Button size="sm" variant="secondary" onClick={() => beginBallBoiRecording(false)}>Skip calibration</Button>
                </div>
              </div>
            )}
            {!ballBoiRecording && !ballBoiUploading && ballBoiSession !== null && (
              <>
                <div className="rounded-lg border border-border bg-background/50 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Activity className="h-4 w-4 text-primary" />
                    Recording Summary
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-xl font-extrabold text-foreground">{ballBoiShots.length}</div>
                      <div className="text-[11px] uppercase text-muted-foreground">Shots</div>
                    </div>
                    <div>
                      <div className="text-xl font-extrabold text-primary">{Math.round(ballBoiShots.at(-1)?.speedMph ?? 0)}</div>
                      <div className="text-[11px] uppercase text-muted-foreground">Top MPH</div>
                    </div>
                    <div>
                      <div className="text-xl font-extrabold text-foreground">{ballBoiSession?.processingStatus === "completed" ? "Done" : "Processing"}</div>
                      <div className="text-[11px] uppercase text-muted-foreground">Status</div>
                    </div>
                  </div>
                </div>
                <div className="max-h-52 space-y-2 overflow-y-auto">
                  {ballBoiShots.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No shots were detected in this recording.</div>
                  ) : (
                    ballBoiShots.slice().reverse().map((shot) => (
                      <div key={shot.id} className="rounded-lg border border-border bg-background/50 p-3">
                        <div className="flex justify-between text-sm">
                          <span className="font-bold text-foreground">{shot.shotType.replace(/_/g, " ")}</span>
                          <span className="font-mono text-primary">{Math.round(shot.speedMph ?? 0)} mph</span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{shot.outcome?.replace(/_/g, " ")} · {Math.round(shot.timestampSeconds)}s</div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
            {cameraError && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{cameraError}</div>}
          </div>
        </div>
      </motion.div>

      {/* Score entry — bottom sheet on mobile, full-screen dialog on desktop */}
      {isMobile ? (
        <Sheet open={scoreDialogMode !== null} onOpenChange={(open) => { if (!open) setScoreDialogMode(null); }}>
          <SheetContent
            side="bottom"
            className="flex flex-col p-0 rounded-t-2xl border-t border-border max-h-[88svh] [&>button:first-child]:hidden"
          >
            {/* Drag handle */}
            <div className="shrink-0 flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>

            {/* Title */}
            <div className="shrink-0 px-6 pt-2 pb-4">
              <SheetTitle className="text-xl font-extrabold text-foreground text-left">
                {scoreDialogMode === "complete" ? "Enter Final Score" : "Save Progress"}
              </SheetTitle>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 space-y-6 pb-2">
              <SetScoreInput sets={sets} setSets={setSets} player1Name={team1Label} player2Name={team2Label} />

              {/* Reason for stopping (save mode only) */}
              {scoreDialogMode === "save" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Why are you stopping?</label>
                  <Select value={saveReason} onValueChange={setSaveReason}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a reason..." />
                    </SelectTrigger>
                    <SelectContent>
                      {STOP_REASONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Duration (complete mode only) */}
              {scoreDialogMode === "complete" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    Match duration <span className="text-muted-foreground font-normal">(optional, in minutes)</span>
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={600}
                    placeholder="e.g. 90"
                    value={matchDuration}
                    onChange={(e) => setMatchDuration(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* CTAs pinned to bottom — extra bottom padding for home indicator */}
            <div className="shrink-0 px-6 pt-4 pb-8 flex flex-col gap-3">
              {scoreDialogMode === "save" ? (
                <Button
                  onClick={handleSaveProgress}
                  disabled={updateMatch.isPending || !saveReason}
                  variant="outline"
                  className="w-full h-12 border-warning/40 text-warning hover:bg-warning/10"
                >
                  <PauseCircle className="w-4 h-4 mr-1.5" />
                  {updateMatch.isPending ? "Saving..." : "Save Progress"}
                </Button>
              ) : (
                <Button
                  onClick={handleCompleteMatch}
                  disabled={updateMatch.isPending || !hasPartialScore}
                  className="w-full h-12"
                >
                  <CheckCircle className="w-4 h-4 mr-1.5" />
                  {updateMatch.isPending ? "Completing..." : "Complete Match"}
                </Button>
              )}
              <Button variant="outline" className="w-full h-12" onClick={() => setScoreDialogMode(null)}>
                Cancel
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={scoreDialogMode !== null} onOpenChange={(open) => { if (!open) setScoreDialogMode(null); }}>
          <DialogContent className="inset-0 left-0 top-0 translate-x-0 translate-y-0 h-full w-full max-w-full max-h-full rounded-none border-0 p-0 flex flex-col [&>button:last-child]:hidden">

            {/* Title */}
            <div className="px-6 pt-10 pb-4 shrink-0">
              <DialogTitle className="text-2xl font-extrabold text-foreground text-left">
                {scoreDialogMode === "complete" ? "Enter Final Score" : "Save Progress"}
              </DialogTitle>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 space-y-5">
              <SetScoreInput sets={sets} setSets={setSets} player1Name={team1Label} player2Name={team2Label} />

              {/* Reason for stopping (save mode only) */}
              {scoreDialogMode === "save" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Why are you stopping?</label>
                  <Select value={saveReason} onValueChange={setSaveReason}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a reason..." />
                    </SelectTrigger>
                    <SelectContent>
                      {STOP_REASONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Duration (complete mode only) */}
              {scoreDialogMode === "complete" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    Match duration <span className="text-muted-foreground font-normal">(optional, in minutes)</span>
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={600}
                    placeholder="e.g. 90"
                    value={matchDuration}
                    onChange={(e) => setMatchDuration(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* CTAs pinned to bottom */}
            <div className="shrink-0 px-6 pb-10 pt-4 flex flex-col gap-3">
              {scoreDialogMode === "save" ? (
                <Button
                  onClick={handleSaveProgress}
                  disabled={updateMatch.isPending || !saveReason}
                  variant="outline"
                  className="w-full border-warning/40 text-warning hover:bg-warning/10"
                >
                  <PauseCircle className="w-4 h-4 mr-1.5" />
                  {updateMatch.isPending ? "Saving..." : "Save Progress"}
                </Button>
              ) : (
                <Button
                  onClick={handleCompleteMatch}
                  disabled={updateMatch.isPending || !hasPartialScore}
                  className="w-full"
                >
                  <CheckCircle className="w-4 h-4 mr-1.5" />
                  {updateMatch.isPending ? "Completing..." : "Complete Match"}
                </Button>
              )}
              <Button variant="outline" className="w-full" onClick={() => setScoreDialogMode(null)}>
                Cancel
              </Button>
            </div>

          </DialogContent>
        </Dialog>
      )}

      <Dialog open={analyzingOpen} onOpenChange={setAnalyzingOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Analyzing Ball Boi Replay</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="h-3 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(8, analysisProgress)}%` }} />
            </div>
            <p className="text-sm text-muted-foreground">{analysisMessage}</p>
            <Button asChild className="w-full">
              <Link href={`/matches/${matchId}/replay`}>Open Replay</Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Points breakdown */}
      {match.status === "completed" && match.score && match.winnerId && (() => {
        const pts = calcPoints(match.score, match.winnerId, match.player1Id, match.player2Id);
        if (!pts) return null;
        const teams: Array<{ name: string; p: typeof pts.p1; isWinner: boolean }> = [
          { name: doublesMatch ? team1Label : match.player1Name, p: pts.p1, isWinner: doublesMatch ? team1Won : match.winnerId === match.player1Id },
          { name: doublesMatch ? team2Label : match.player2Name, p: pts.p2, isWinner: doublesMatch ? team2Won : match.winnerId === match.player2Id },
        ];
        return (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-card-border rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Points Earned</h2>
              <span className="text-[11px] text-muted-foreground">1 pt/game · 3 pts/set · 6 pts/match win</span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-border">
              {teams.map(({ name, p, isWinner }) => (
                <div key={name} className="px-5 py-4 flex flex-col">
                  <div className={cn("text-sm font-semibold mb-3", isWinner ? "text-primary" : "text-foreground")}>{name}</div>
                  <div className="space-y-1.5 text-xs text-muted-foreground flex-1">
                    <div className="flex justify-between">
                      <span>Games won ({p.games})</span>
                      <span className="font-mono text-foreground">+{p.games}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Sets won ({p.sets})</span>
                      <span className="font-mono text-foreground">+{p.sets * 3}</span>
                    </div>
                    {p.bonus > 0 && (
                      <div className="flex justify-between text-primary">
                        <span>Match win bonus</span>
                        <span className="font-mono font-bold">+{p.bonus}</span>
                      </div>
                    )}
                  </div>
                  <div className={cn("mt-3 pt-2.5 border-t border-border flex justify-between items-baseline", isWinner ? "border-primary/20" : "")}>
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">Total</span>
                    <span className={cn("text-xl font-extrabold tabular-nums", isWinner ? "text-primary" : "text-foreground")}>{p.total}</span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        );
      })()}

    </div>
  );
}

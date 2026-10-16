import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useGetMyPlayers } from "@workspace/api-client-react";
import { Ban, Flag, MoreHorizontal } from "lucide-react";
import { apiFetch } from "@/lib/scheduleApi";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const REASONS = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "inappropriate_content", label: "Inappropriate photo, name or bio" },
  { value: "impersonation", label: "Pretending to be someone else" },
  { value: "cheating", label: "Fake scores or unsportsmanlike conduct" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Something else" },
] as const;

/** Report and block actions for another player (App Store guideline 1.2). */
export function ReportBlockMenu({ playerId, playerName }: { playerId: number; playerName: string }) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const myPlayers = useGetMyPlayers();
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [reason, setReason] = useState<string>("harassment");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  if (myPlayers.data?.some((p) => p.id === playerId)) return null;

  async function submitReport() {
    setBusy(true);
    try {
      const res = await apiFetch("/api/reports", await getToken(), {
        method: "POST",
        body: JSON.stringify({ targetType: "player", targetId: playerId, reason, details: details || undefined }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Report sent", description: "Thanks. Our team reviews every report within 24 hours." });
      setReportOpen(false);
      setDetails("");
    } catch {
      toast({ title: "Couldn't send report", description: "Please try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function block() {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/players/${playerId}/block`, await getToken(), { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error);
      }
      toast({ title: `${playerName} blocked`, description: "They won't appear in player search or be auto-scheduled against you." });
      setBlockOpen(false);
    } catch (e) {
      toast({ title: "Couldn't block player", description: (e as Error).message || "Please try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="ml-auto h-11 w-11" aria-label={`More options for ${playerName}`}>
            <MoreHorizontal className="h-5 w-5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setReportOpen(true)}>
            <Flag className="mr-2 h-4 w-4" aria-hidden /> Report player
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setBlockOpen(true)} className="text-destructive focus:text-destructive">
            <Ban className="mr-2 h-4 w-4" aria-hidden /> Block player
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report {playerName}</DialogTitle>
            <DialogDescription>Reports are private. {playerName} won't know who reported them.</DialogDescription>
          </DialogHeader>
          <RadioGroup value={reason} onValueChange={setReason} aria-label="Reason for report" className="gap-3">
            {REASONS.map((r) => (
              <div key={r.value} className="flex items-center gap-3 min-h-11">
                <RadioGroupItem value={r.value} id={`reason-${r.value}`} />
                <Label htmlFor={`reason-${r.value}`} className="text-sm font-normal">{r.label}</Label>
              </div>
            ))}
          </RadioGroup>
          <div className="space-y-2">
            <Label htmlFor="report-details">Anything else? (optional)</Label>
            <Textarea id="report-details" maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportOpen(false)}>Cancel</Button>
            <Button onClick={submitReport} disabled={busy}>Send report</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={blockOpen} onOpenChange={setBlockOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block {playerName}?</AlertDialogTitle>
            <AlertDialogDescription>
              They won't show up in player search or be auto-scheduled against you in weekly matchups. Existing league results stay as they are. You can unblock them from your profile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); block(); }} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Block
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

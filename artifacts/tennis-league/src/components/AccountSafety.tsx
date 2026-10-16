import { useEffect, useState } from "react";
import { useAuth, useClerk } from "@clerk/react";
import { Link } from "wouter";
import { apiFetch } from "@/lib/scheduleApi";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type BlockedPlayer = { playerId: number | null; name: string; blockedAt: string };

export function BlockedPlayersSection() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [blocked, setBlocked] = useState<BlockedPlayer[] | null>(null);

  async function load() {
    const res = await apiFetch("/api/blocks", await getToken());
    setBlocked(res.ok ? await res.json() : []);
  }

  useEffect(() => {
    load().catch(() => setBlocked([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function unblock(p: BlockedPlayer) {
    if (p.playerId == null) return;
    const res = await apiFetch(`/api/players/${p.playerId}/block`, await getToken(), { method: "DELETE" });
    if (res.ok) {
      toast({ title: `${p.name} unblocked` });
      load();
    } else {
      toast({ title: "Couldn't unblock", variant: "destructive" });
    }
  }

  if (blocked === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!blocked.length) return <p className="text-sm text-muted-foreground">You haven't blocked anyone.</p>;

  return (
    <ul className="divide-y divide-border">
      {blocked.map((p) => (
        <li key={`${p.playerId}-${p.blockedAt}`} className="flex items-center justify-between gap-3 py-2 min-h-11">
          <span className="text-sm text-foreground">{p.name}</span>
          <Button variant="outline" size="sm" onClick={() => unblock(p)} aria-label={`Unblock ${p.name}`}>
            Unblock
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** In-app account deletion, required by App Store guideline 5.1.1(v). */
export function DeleteAccountSection() {
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirmDelete() {
    setBusy(true);
    try {
      const res = await apiFetch("/api/users/me", await getToken(), {
        method: "DELETE",
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error);
      }
      await signOut({ redirectUrl: "/" });
    } catch (e) {
      toast({ title: "Account not deleted", description: (e as Error).message || "Please try again.", variant: "destructive" });
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Permanently delete your account, profile and every Ball Boi video you recorded. Your past league results stay in
        standings as "Deleted player" so your opponents' records stay accurate. See our{" "}
        <Link href="/privacy" className="text-primary underline underline-offset-2">Privacy Policy</Link>.
      </p>
      <Button variant="destructive" onClick={() => setOpen(true)}>Delete account</Button>

      <AlertDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setConfirmText(""); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>This can't be undone. Type DELETE to confirm.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirm-delete">Confirmation</Label>
            <Input
              id="confirm-delete"
              autoComplete="off"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={confirmText !== "DELETE" || busy} onClick={confirmDelete}>
              {busy ? "Deleting…" : "Delete permanently"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

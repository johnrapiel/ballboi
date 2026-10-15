import { useState, useEffect } from "react";
import { useAuth, useUser } from "@clerk/react";
import { useUpsertMyProfile, UpsertUserProfileBodySkillLevel } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { apiFetch } from "@/lib/scheduleApi";
import { Bell, User, Check } from "lucide-react";
import NotificationToggle from "@/components/PushNotificationPrompt";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const skillLevels: { value: UpsertUserProfileBodySkillLevel; label: string; desc: string }[] = [
  { value: "2.5", label: "2.5", desc: "Beginner, still learning" },
  { value: "3.0", label: "3.0", desc: "Learning basic strokes" },
  { value: "3.5", label: "3.5", desc: "Consistent on most shots" },
  { value: "4.0", label: "4.0", desc: "Dependable strokes, plays sets" },
  { value: "4.5", label: "4.5", desc: "Strong all-around game" },
  { value: "5.0", label: "5.0", desc: "Tournament-level player" },
];

function Section({ icon: Icon, title, children, id }: { icon: React.ElementType; title: string; children: React.ReactNode; id?: string }) {
  return (
    <motion.div id={id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-card-border rounded-lg p-5 space-y-5 scroll-mt-6">
      <div className="flex items-center gap-2 pb-1 border-b border-border">
        <Icon className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold text-foreground uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </motion.div>
  );
}

type LinkedPlayer = {
  id: number;
  name: string;
  leagueId?: number | null;
  dayBeforeMatchReminderEnabled?: boolean;
};

function getErrorMessage(value: unknown, fallback: string) {
  if (value && typeof value === "object" && "error" in value && typeof (value as { error?: unknown }).error === "string") {
    return (value as { error: string }).error;
  }
  return fallback;
}

function NotificationPreferencesSection() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [players, setPlayers] = useState<LinkedPlayer[]>([]);
  const [savingPlayerId, setSavingPlayerId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadPreference() {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const res = await apiFetch("/players/me", token);
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(getErrorMessage(data, "Failed to load notification preferences"));
        if (!active) return;
        setPlayers(Array.isArray(data) ? (data as LinkedPlayer[]) : []);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load notification preferences");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadPreference();

    return () => {
      active = false;
    };
  }, [getToken]);

  async function updatePreference(player: LinkedPlayer, nextEnabled: boolean) {
    const previous = players;
    setPlayers((current) => current.map((item) => item.id === player.id ? { ...item, dayBeforeMatchReminderEnabled: nextEnabled } : item));
    setSavingPlayerId(player.id);
    setError(null);
    try {
      const token = await getToken();
      const res = await apiFetch(`/players/${player.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ dayBeforeMatchReminderEnabled: nextEnabled }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(getErrorMessage(data, "Failed to save notification preference"));
      setPlayers((current) => current.map((item) => item.id === player.id ? (data as LinkedPlayer) : item));
      toast({ title: "Notification preference saved" });
    } catch (err) {
      setPlayers(previous);
      const message = err instanceof Error ? err.message : "Failed to save notification preference";
      setError(message);
      toast({ title: "Could not save preference", description: message, variant: "destructive" });
    } finally {
      setSavingPlayerId(null);
    }
  }

  if (loading) {
    return <div className="h-16 rounded-md bg-muted animate-pulse" />;
  }

  if (players.length === 0) {
    return (
      <div className="rounded-md border border-border bg-input/40 p-3 text-sm text-muted-foreground">
        Join a league from an invite link to manage match reminder preferences.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {players.map((player) => (
        <div key={player.id} className="flex items-center justify-between gap-4 rounded-md border border-border bg-input/40 p-3">
          <div>
            <Label htmlFor={`day-before-reminders-${player.id}`} className="text-sm font-semibold text-foreground">Day-before match reminders</Label>
            <p className="mt-1 text-xs text-muted-foreground">For {player.name}, get a push notification the morning before each scheduled match.</p>
          </div>
          <Switch
            id={`day-before-reminders-${player.id}`}
            checked={player.dayBeforeMatchReminderEnabled ?? true}
            disabled={savingPlayerId === player.id}
            onCheckedChange={(nextEnabled) => updatePreference(player, nextEnabled)}
            aria-label={`Day-before match reminders for ${player.name}`}
          />
        </div>
      ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ProfileSection() {
  const { user: clerkUser } = useUser();
  const { getToken } = useAuth();
  const { toast } = useToast();

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [skillLevel, setSkillLevel] = useState<UpsertUserProfileBodySkillLevel>("3.0");
  const [dominantHand, setDominantHand] = useState<"left" | "right">("right");
  const [bio, setBio] = useState("");
  const [loading, setLoading] = useState(true);

  const mutation = useUpsertMyProfile({
    mutation: {
      onSuccess: () => toast({ title: "Profile saved" }),
      onError: () => toast({ title: "Failed to save profile", variant: "destructive" }),
    },
  });

  useEffect(() => {
    getToken().then(async (token) => {
      const res = await apiFetch("/users/me", token);
      if (res.ok) {
        const data = await res.json();
        setDisplayName(data.displayName ?? clerkUser?.fullName ?? "");
        setPhone(data.phone ?? "");
        setSkillLevel((data.skillLevel ?? UpsertUserProfileBodySkillLevel["30"]) as UpsertUserProfileBodySkillLevel);
        setDominantHand(data.dominantHand ?? "right");
        setBio(data.bio ?? "");
      } else {
        setDisplayName(clerkUser?.fullName ?? clerkUser?.firstName ?? "");
      }
      setLoading(false);
    });
  }, []);

  const handleSave = () => {
    if (!displayName.trim()) return;
    mutation.mutate({
      data: {
        displayName: displayName.trim(),
        email: clerkUser?.primaryEmailAddress?.emailAddress,
        phone: phone || undefined,
        skillLevel,
        dominantHand,
        bio: bio || undefined,
      },
    });
  };

  if (loading) {
    return <div className="space-y-3 animate-pulse">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 bg-muted rounded" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Display Name <span className="text-destructive">*</span></Label>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name as shown to other players" autoComplete="name" autoCapitalize="words" />
      </div>

      <div className="space-y-1.5">
        <Label>Phone <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 000-0000" />
      </div>

      <div>
        <Label className="block mb-2">Skill Level</Label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {skillLevels.map((sl) => (
            <button
              key={sl.value}
              type="button"
              onClick={() => setSkillLevel(sl.value)}
              className={`p-3 rounded-md border text-left transition-colors ${
                skillLevel === sl.value
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-input text-muted-foreground hover:border-border/80 hover:bg-accent"
              }`}
            >
              <div className="text-sm font-medium">{sl.label}</div>
              <div className="text-xs opacity-70 mt-0.5">{sl.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label className="block mb-2">Dominant Hand</Label>
        <div className="flex gap-3">
          {(["right", "left"] as const).map((hand) => (
            <button
              key={hand}
              type="button"
              onClick={() => setDominantHand(hand)}
              className={`flex-1 py-2 rounded-md border text-sm font-medium transition-colors ${
                dominantHand === hand
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-input text-muted-foreground hover:bg-accent"
              }`}
            >
              {hand.charAt(0).toUpperCase() + hand.slice(1)} Hand
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Bio <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 rounded-md bg-input border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
          placeholder="A short intro about yourself..."
        />
      </div>

      <Button onClick={handleSave} disabled={!displayName.trim() || mutation.isPending} className="w-full gap-2">
        <Check className="w-4 h-4" />
        {mutation.isPending ? "Saving..." : "Save Profile"}
      </Button>
    </div>
  );
}

export default function Profile() {
  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="page-heading text-foreground">My Profile</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your player details</p>
      </div>

      <Section icon={User} title="Player Profile">
        <ProfileSection />
      </Section>

      <Section icon={Bell} title="Notifications">
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-input/40 p-3 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Push notifications</p>
              <p className="mt-1 text-xs text-muted-foreground">Add this app to your home screen, then enable notifications to get match reminders and alerts.</p>
            </div>
            <div className="shrink-0 pt-0.5">
              <NotificationToggle />
            </div>
          </div>
          <NotificationPreferencesSection />
        </div>
      </Section>

    </div>
  );
}

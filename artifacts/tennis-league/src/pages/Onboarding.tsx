import { useState } from "react";
import { useUser } from "@clerk/react";
import { useLocation } from "wouter";
import { useUpsertMyProfile } from "@workspace/api-client-react";

const skillLevels = [
  { value: "2.5", label: "2.5", desc: "Beginner, still learning" },
  { value: "3.0", label: "3.0", desc: "Learning basic strokes" },
  { value: "3.5", label: "3.5", desc: "Consistent on most shots" },
  { value: "4.0", label: "4.0", desc: "Dependable strokes, plays sets" },
  { value: "4.5", label: "4.5", desc: "Strong all-around game" },
  { value: "5.0", label: "5.0", desc: "Tournament-level player" },
];

export default function Onboarding() {
  const { user } = useUser();
  const [, setLocation] = useLocation();
  const [displayName, setDisplayName] = useState(user?.fullName || user?.firstName || "");
  const [phone, setPhone] = useState("");
  const [skillLevel, setSkillLevel] = useState("3.0");
  const [dominantHand, setDominantHand] = useState<"left" | "right">("right");
  const [bio, setBio] = useState("");

  const mutation = useUpsertMyProfile({
    mutation: {
      onSuccess: () => setLocation("/profile"),
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    mutation.mutate({
      data: {
        displayName: displayName.trim(),
        email: user?.primaryEmailAddress?.emailAddress,
        phone: phone || undefined,
        skillLevel: skillLevel as any,
        dominantHand,
        bio: bio || undefined,
        onboardingComplete: true,
      },
    });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8">
          <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Set up your player profile</h1>
          <p className="text-muted-foreground mt-1">Tell us a bit about yourself so other players can find you.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Display Name <span className="text-destructive">*</span></label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-input border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Your name as shown to other players"
              autoComplete="name"
              autoCapitalize="words"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Phone (optional)</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-input border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="+1 (555) 000-0000"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Skill Level</label>
            <div className="grid grid-cols-2 gap-2">
              {skillLevels.map((sl) => (
                <button
                  key={sl.value}
                  type="button"
                  onClick={() => setSkillLevel(sl.value)}
                  className={`p-3 rounded-md border text-left transition-colors ${
                    skillLevel === sl.value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-border/80 hover:bg-accent"
                  }`}
                >
                  <div className="text-sm font-medium">{sl.label}</div>
                  <div className="text-xs opacity-70 mt-0.5">{sl.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Dominant Hand</label>
            <div className="flex gap-3">
              {(["right", "left"] as const).map((hand) => (
                <button
                  key={hand}
                  type="button"
                  onClick={() => setDominantHand(hand)}
                  className={`flex-1 py-2 rounded-md border text-sm font-medium transition-colors ${
                    dominantHand === hand
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {hand.charAt(0).toUpperCase() + hand.slice(1)} Hand
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Bio (optional)</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-md bg-input border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              placeholder="A short intro about yourself..."
            />
          </div>

          {mutation.error && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              Failed to save profile. Please try again.
            </div>
          )}

          <button
            type="submit"
            disabled={!displayName.trim() || mutation.isPending}
            className="w-full py-2.5 rounded-md bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? "Saving..." : "Continue to My Profile"}
          </button>
        </form>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useUser, Show } from "@clerk/react";
import { useGetInvite, useJoinLeagueViaInvite } from "@workspace/api-client-react";

export default function JoinLeague() {
  const { code } = useParams<{ code: string }>();
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const [playerName, setPlayerName] = useState(user?.fullName || "");
  const joinRedirectParam = `?redirect_url=/join/${code}`;
  const [skillLevel, setSkillLevel] = useState("3.0");

  const [joined, setJoined] = useState(false);
  const [leagueId, setLeagueId] = useState<number | null>(null);

  // Sync name from Clerk profile once it loads (e.g. after Google sign-in)
  useEffect(() => {
    if (user?.fullName && !playerName) {
      setPlayerName(user.fullName);
    }
  }, [user?.fullName]);

  const { data: invite, isLoading, error } = useGetInvite(code!, {
    query: { enabled: !!code, queryKey: ["invite", code!] as any },
  });

  const joinMutation = useJoinLeagueViaInvite({
    mutation: {
      onSuccess: (data) => {
        setJoined(true);
        setLeagueId(data.league.id ?? null);
      },
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading invite...</div>
      </div>
    );
  }

  if (error || !invite) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 rounded-xl bg-destructive/15 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-foreground mb-2">Invite Not Found</h1>
          <p className="text-muted-foreground text-sm">This invite link may be expired or invalid.</p>
          <button onClick={() => setLocation("/")} className="mt-4 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            Go Home
          </button>
        </div>
      </div>
    );
  }

  if (joined) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-foreground mb-2">Joined Successfully</h1>
          <p className="text-muted-foreground text-sm">You have joined <strong className="text-foreground">{invite.leagueName}</strong>.</p>
          <div className="flex gap-2 mt-5 justify-center">
            {leagueId && (
              <button onClick={() => setLocation(`/leagues/${leagueId}`)} className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                View League
              </button>
            )}
            <button onClick={() => setLocation("/leagues")} className="px-4 py-2 rounded-md border border-border text-foreground text-sm font-medium hover:bg-accent transition-colors">
              My Leagues
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6">
          <div className="text-xs text-primary font-semibold uppercase tracking-widest mb-2">League Invitation</div>
          <h1 className="text-2xl font-bold text-foreground">{invite.leagueName}</h1>
          {invite.leagueSport && <p className="text-muted-foreground text-sm mt-1">{invite.leagueSport}</p>}
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            {invite.playerCount !== null && invite.playerCount !== undefined && (
              <span>{invite.playerCount} player{invite.playerCount !== 1 ? "s" : ""}</span>
            )}
            {invite.maxUses && (
              <span>{invite.usageCount} / {invite.maxUses} uses</span>
            )}
          </div>
        </div>

        <Show when="signed-out">
          <div className="bg-card border border-border rounded-lg p-4 mb-5">
            <p className="text-sm text-muted-foreground mb-3">Sign in to join this league</p>
            <div className="flex gap-2">
              <button onClick={() => setLocation(`/sign-in${joinRedirectParam}`)} className="flex-1 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                Sign In
              </button>
              <button onClick={() => setLocation(`/sign-up${joinRedirectParam}`)} className="flex-1 py-2 rounded-md border border-border text-foreground text-sm font-medium hover:bg-accent transition-colors">
                Create Account
              </button>
            </div>
          </div>
        </Show>

        <Show when="signed-in">
          <form onSubmit={(e) => { e.preventDefault(); joinMutation.mutate({ code: code!, data: { playerName, skillLevel } }); }} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Player Name <span className="text-destructive">*</span></label>
              <input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-input border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="Your display name in this league"
                autoComplete="name"
                autoCapitalize="words"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Skill Level</label>
              <select
                value={skillLevel}
                onChange={(e) => setSkillLevel(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-input border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="2.5">2.5</option>
                <option value="3.0">3.0</option>
                <option value="3.5">3.5</option>
                <option value="4.0">4.0</option>
                <option value="4.5">4.5</option>
                <option value="5.0">5.0</option>
              </select>
            </div>

            {joinMutation.error && (
              <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                Failed to join. Please try again.
              </div>
            )}

            <button
              type="submit"
              disabled={!playerName.trim() || joinMutation.isPending}
              className="w-full py-2.5 rounded-md bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {joinMutation.isPending ? "Joining..." : "Join League"}
            </button>
          </form>
        </Show>
      </div>
    </div>
  );
}

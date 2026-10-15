import { useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from "@clerk/react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Leagues from "@/pages/Leagues";
import LeagueDetail from "@/pages/LeagueDetail";
import Players from "@/pages/Players";
import PlayerDetail from "@/pages/PlayerDetail";
import MatchDetail from "@/pages/MatchDetail";
import Onboarding from "@/pages/Onboarding";
import JoinLeague from "@/pages/JoinLeague";
import AllLeagues from "@/pages/AllLeagues";
import Profile from "@/pages/Profile";
import ScheduleReview from "@/pages/ScheduleReview";
import MyMatches from "@/pages/MyMatches";
import BallBoiReplay from "@/pages/BallBoiReplay";
import NotFound from "@/pages/not-found";
import { useIsAdmin } from "@/hooks/useIsAdmin";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function SignInPage() {
  const params = new URLSearchParams(window.location.search);
  const redirectPath = params.get("redirect_url");
  const forceRedirectUrl = redirectPath ? `${basePath}${redirectPath}` : undefined;
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        {...(forceRedirectUrl ? { forceRedirectUrl } : {})}
      />
    </div>
  );
}

function SignUpPage() {
  const params = new URLSearchParams(window.location.search);
  const redirectPath = params.get("redirect_url");
  const forceRedirectUrl = redirectPath ? `${basePath}${redirectPath}` : undefined;
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        {...(forceRedirectUrl ? { forceRedirectUrl } : {})}
      />
    </div>
  );
}

function ClerkQueryCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function SignedInRedirect() {
  const { isLoaded } = useUser();
  const isAdmin = useIsAdmin();
  if (!isLoaded) return null;
  return <Redirect to={isAdmin ? "/dashboard" : "/leagues"} />;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <SignedInRedirect />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function LandingPage() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-8 px-4">
      <div className="text-center max-w-xl">
        <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-6">
          <svg className="w-9 h-9" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="12" cy="8.5" rx="5.5" ry="6.5" stroke="white" strokeWidth="1.5" fill="white" fillOpacity="0.1" />
            <line x1="8.8" y1="5.5" x2="15.2" y2="5.5" stroke="white" strokeWidth="0.75" strokeLinecap="round" />
            <line x1="7.2" y1="8" x2="16.8" y2="8" stroke="white" strokeWidth="0.75" strokeLinecap="round" />
            <line x1="8.8" y1="10.5" x2="15.2" y2="10.5" stroke="white" strokeWidth="0.75" strokeLinecap="round" />
            <line x1="10" y1="3" x2="10" y2="14" stroke="white" strokeWidth="0.75" strokeLinecap="round" />
            <line x1="12" y1="2.2" x2="12" y2="14.8" stroke="white" strokeWidth="0.75" strokeLinecap="round" />
            <line x1="14" y1="3" x2="14" y2="14" stroke="white" strokeWidth="0.75" strokeLinecap="round" />
            <path d="M10.2 15.5 L11.2 17.5 L12.8 17.5 L13.8 15.5" stroke="white" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
            <rect x="11" y="17.5" width="2" height="5" rx="1" fill="white" />
          </svg>
        </div>
        <h1 className="page-title text-foreground mb-2">Hudson Valley Tennis</h1>
        <p className="text-muted-foreground text-base mb-4">Everything you need to run a tennis league:</p>
        <ul className="text-left text-muted-foreground text-base space-y-2 mb-6 inline-block">
          <li className="flex items-start gap-2"><span className="text-primary mt-0.5">-</span>Create and manage multiple leagues</li>
          <li className="flex items-start gap-2"><span className="text-primary mt-0.5">-</span>Schedule matches with tiebreak scoring</li>
          <li className="flex items-start gap-2"><span className="text-primary mt-0.5">-</span>Track live standings and player rankings in real-time</li>
        </ul>
        <p className="text-foreground font-semibold text-lg mb-0">Ready to compete?</p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={() => setLocation("/sign-in")}
          className="px-6 py-2.5 rounded-md bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
        >
          Sign In
        </button>
        <button
          onClick={() => setLocation("/sign-up")}
          className="px-6 py-2.5 rounded-md border border-border text-foreground font-semibold text-sm hover:bg-accent transition-colors"
        >
          Create Account
        </button>
      </div>
    </div>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <Layout>
          <Component />
        </Layout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { isLoaded } = useUser();
  const isAdmin = useIsAdmin();
  return (
    <>
      <Show when="signed-in">
        {!isLoaded ? null : isAdmin ? (
          <Layout>
            <Component />
          </Layout>
        ) : (
          <Redirect to="/leagues" />
        )}
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/onboarding" component={() => <ProtectedRoute component={Onboarding} />} />
      <Route path="/join/:code" component={JoinLeague} />
      <Route path="/dashboard" component={() => <AdminRoute component={Dashboard} />} />
      <Route path="/admin/leagues" component={() => <AdminRoute component={AllLeagues} />} />
      <Route path="/leagues" component={() => <ProtectedRoute component={Leagues} />} />
      <Route path="/leagues/:id" component={() => <ProtectedRoute component={LeagueDetail} />} />
      <Route path="/players" component={() => <ProtectedRoute component={Players} />} />
      <Route path="/players/:id" component={() => <ProtectedRoute component={PlayerDetail} />} />
      <Route path="/matches/:id" component={() => <ProtectedRoute component={MatchDetail} />} />
      <Route path="/matches/:id/replay" component={() => <ProtectedRoute component={BallBoiReplay} />} />
      <Route path="/matches" component={() => <Redirect to="/my-matches" />} />
      <Route path="/schedule" component={() => <Redirect to="/my-matches" />} />
      <Route path="/profile" component={() => <ProtectedRoute component={Profile} />} />
      <Route path="/admin/schedule-review" component={() => <AdminRoute component={ScheduleReview} />} />
      <Route path="/my-matches" component={() => <ProtectedRoute component={MyMatches} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryCacheInvalidator />
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="tennis-theme">
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
    </ThemeProvider>
  );
}

export default App;

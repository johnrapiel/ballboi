import { useLocation, Link } from "wouter";
import { LayoutDashboard, Layers, Swords, Menu, X, LogOut, Globe, UserCircle, Sun, Moon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useUser, useClerk } from "@clerk/react";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useTheme } from "@/components/theme-provider";

function NavLink({ href, label, icon: Icon }: { href: string; label: string; icon: React.ElementType }) {
  const [location] = useLocation();
  const active = location === href || (href !== "/dashboard" && location.startsWith(href));
  return (
    <Link
      href={href}
      data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-150",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-accent"
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {label}
    </Link>
  );
}

function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  return (
    <button
      onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
      className={cn(
        "icon-btn",
        className
      )}
      title={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {resolved === "dark" ? (
        <Sun className="w-3.5 h-3.5" />
      ) : (
        <Moon className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

function UserSection() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();

  if (!user) return null;

  const initials = (user.fullName || user.firstName || "U")
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="px-3 py-3 border-t border-sidebar-border space-y-1">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
          {user.imageUrl ? (
            <img src={user.imageUrl} alt={user.fullName || ""} className="w-7 h-7 rounded-full object-cover" />
          ) : (
            <span className="text-xs font-bold text-primary">{initials}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-foreground truncate">{user.fullName || user.firstName || "Player"}</div>
          <div className="text-[11px] text-muted-foreground truncate">{user.primaryEmailAddress?.emailAddress}</div>
        </div>
      </div>
      <button
        onClick={() => signOut(() => setLocation("/"))}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <LogOut className="w-3.5 h-3.5 shrink-0" />
        Sign Out
      </button>
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const isAdmin = useIsAdmin();

  const leagueNavItems = isAdmin
    ? [
        { href: "/admin/leagues", label: "All Leagues", icon: Globe },
        { href: "/leagues", label: "My Leagues", icon: Layers },
      ]
    : [{ href: "/leagues", label: "My Leagues", icon: Layers }];

  const navItems = [
    ...(isAdmin ? [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] : []),
    ...leagueNavItems,
    { href: "/my-matches", label: "My Matches", icon: Swords },
    { href: "/profile", label: "My Profile", icon: UserCircle },
  ];

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex flex-col w-56 bg-sidebar border-r border-sidebar-border fixed inset-y-0 left-0 z-30">
        <div className="px-5 py-4 border-b border-sidebar-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-primary flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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
              <div>
                <div className="brand-name text-foreground">TennisLeague</div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-widest font-mono">Manager</div>
              </div>
            </div>
            <ThemeToggle />
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => <NavLink key={item.href} {...item} />)}
        </nav>
        <UserSection />
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 inset-x-0 z-40 bg-sidebar border-b border-sidebar-border flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-primary flex items-center justify-center shrink-0">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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
          <span className="brand-name text-foreground">TennisLeague</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {user && (
            <button
              onClick={() => signOut(() => setLocation("/"))}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
          <button
            data-testid="mobile-menu-toggle"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-30 bg-black/60" onClick={() => setMobileOpen(false)}>
          <aside className="w-56 bg-sidebar h-full border-r border-sidebar-border pt-14 flex flex-col" onClick={(e) => e.stopPropagation()}>
            <nav className="flex-1 px-3 py-4 space-y-0.5">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  {item.label}
                </Link>
              ))}
            </nav>
            {user && (
              <div className="px-3 py-3 border-t border-sidebar-border">
                <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <span className="text-[11px] font-bold text-primary">
                      {(user.fullName || user.firstName || "U")[0].toUpperCase()}
                    </span>
                  </div>
                  <div className="text-xs font-medium text-foreground truncate">{user.fullName || user.firstName}</div>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 md:ml-56 min-h-screen pt-14 md:pt-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}

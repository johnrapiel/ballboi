import { useState, useEffect } from "react";
import { Bell, BellOff } from "lucide-react";
import { subscribeToPush, unsubscribeFromPush, getPushStatus } from "@/lib/pushNotifications";
import { cn } from "@/lib/utils";

export default function NotificationToggle() {
  const [status, setStatus] = useState<"loading" | "unsupported" | "denied" | "prompt" | "subscribed">("loading");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    getPushStatus().then(({ supported, browserPermission, subscribed }) => {
      if (!supported) { setStatus("unsupported"); return; }
      if (subscribed) { setStatus("subscribed"); return; }
      if (browserPermission === "denied") { setStatus("denied"); return; }
      setStatus("prompt");
    });
  }, []);

  const handleToggle = async () => {
    if (working || status === "loading" || status === "unsupported" || status === "denied") return;
    setWorking(true);
    if (status === "subscribed") {
      await unsubscribeFromPush();
      setStatus("prompt");
    } else {
      const result = await subscribeToPush();
      if (result.success) setStatus("subscribed");
      else if (result.error === "denied") setStatus("denied");
    }
    setWorking(false);
  };

  if (status === "loading" || status === "unsupported") return null;

  const on = status === "subscribed";
  const blocked = status === "denied";

  return (
    <button
      onClick={handleToggle}
      disabled={working || blocked}
      title={
        blocked ? "Notifications blocked — enable in browser settings"
        : on ? "Notifications on — click to turn off"
        : "Turn on match notifications"
      }
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors",
        on
          ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
          : blocked
          ? "border-border bg-transparent text-muted-foreground/50 cursor-not-allowed"
          : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-border/80",
        working && "opacity-50 cursor-wait"
      )}
    >
      {on ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
      {working ? "..." : on ? "Notifications on" : "Notifications off"}
    </button>
  );
}

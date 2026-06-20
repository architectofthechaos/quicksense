"use client";
import { useEffect, useState } from "react";

// Sidebar status pill: pings the API (via the BFF) and reflects reachability.
// "Connected" (green) when the control-plane API answers, "Disconnected" (red)
// on network/5xx failure. (SPEC-003.5 §4.1)
export function ConnectionStatus() {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const res = await fetch("/api/clusters", { method: "HEAD", cache: "no-store" });
        if (alive) setOk(res.ok);
      } catch {
        if (alive) setOk(false);
      }
    };
    void ping();
    const t = setInterval(ping, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const connected = ok !== false;
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
      <span
        className={`h-2 w-2 rounded-full ${connected ? "bg-success" : "bg-error"}`}
        aria-hidden
      />
      {ok === null ? "Connecting…" : connected ? "Connected" : "Disconnected"}
    </div>
  );
}

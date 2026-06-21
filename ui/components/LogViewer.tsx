"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDownToLine, WrapText } from "lucide-react";

const POLL_MS = 4000;

// LogViewer streams a cluster's driver logs by polling the text endpoint every
// ~4s (the BFF returns text/plain). Follow-tail auto-scrolls to the bottom on new
// content; turning it off (or scrolling up) lets the user read history. A wrap
// toggle switches between pre-wrap and horizontal scroll.
export function LogViewer({ clusterId, className = "" }: { clusterId: string; className?: string }) {
  const [text, setText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(true);
  const preRef = useRef<HTMLPreElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`/api/clusters/${clusterId}/logs`, { cache: "no-store" });
      if (!res.ok) {
        setError(`Could not load logs (${res.status}).`);
        return;
      }
      setText(await res.text());
      setError(null);
    } catch {
      setError("Could not reach the API.");
    } finally {
      setLoading(false);
    }
  }, [clusterId]);

  // Poll on an interval; restarted whenever the cluster changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const tick = async () => {
      if (cancelled) return;
      await fetchLogs();
      if (cancelled) return;
      timer.current = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fetchLogs]);

  // Auto-scroll to the tail after content updates when following.
  useLayoutEffect(() => {
    if (follow && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [text, follow, wrap]);

  // If the user scrolls up, stop following; scrolling back to the bottom resumes.
  function onScroll() {
    const el = preRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setFollow(atBottom);
  }

  const toggleCls = (on: boolean) =>
    `focus-ring inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
      on
        ? "border-primary bg-primary-tint text-primary"
        : "border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground"
    }`;

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {loading ? "Loading logs…" : error ? "" : "Driver logs · auto-refreshing"}
        </span>
        <div className="flex items-center gap-2">
          <button type="button" aria-pressed={follow} onClick={() => setFollow((f) => !f)} className={toggleCls(follow)}>
            <ArrowDownToLine className="h-3.5 w-3.5" /> Follow
          </button>
          <button type="button" aria-pressed={wrap} onClick={() => setWrap((w) => !w)} className={toggleCls(wrap)}>
            <WrapText className="h-3.5 w-3.5" /> Wrap
          </button>
        </div>
      </div>
      {error && (
        <div role="alert" className="mb-2 text-xs text-error">
          {error}
        </div>
      )}
      <pre
        ref={preRef}
        onScroll={onScroll}
        data-testid="log-output"
        className={`h-80 overflow-auto rounded-lg border border-border bg-[var(--bg)] p-3 font-mono text-[12.5px] leading-relaxed text-foreground ${
          wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
        }`}
      >
        {text || (loading ? "" : "No log output yet.")}
      </pre>
    </div>
  );
}

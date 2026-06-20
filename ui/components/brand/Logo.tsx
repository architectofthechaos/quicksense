// QuickSense brand mark (Q-pulse): an open indigo→violet ring with a heartbeat
// pulse crossing the center and a tail exiting lower-right. The mark keeps its
// gradient in both light and dark themes (SPEC-003.5 §1). Server-compatible
// (no hooks); the gradient id is fixed and identical across instances.

export function Mark({ className, title = "QuickSense" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" role="img" aria-label={title} className={className}>
      <defs>
        <linearGradient id="qpGrad" x1="14" y1="12" x2="52" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5A48E0" />
          <stop offset="1" stopColor="#7A6BF5" />
        </linearGradient>
      </defs>
      {/* Q ring — open at the lower-right */}
      <path
        d="M42.5 50.2 A21 21 0 1 1 51.7 39.2"
        stroke="url(#qpGrad)"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      {/* tail exiting lower-right */}
      <path d="M47.5 45.5 L58 56" stroke="url(#qpGrad)" strokeWidth="5" strokeLinecap="round" />
      {/* heartbeat pulse across the center (lighter violet for depth) */}
      <path
        d="M12 32 H22 L26 24 L31 40 L36 27 L40 34 H50"
        stroke="#8B7CF8"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

// MarkBadge — the mark on a near-black rounded square (the app-icon lockup),
// for the favicon-style treatment and collapsed nav.
export function MarkBadge({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-[22%] bg-[#15131F] ${className ?? "h-8 w-8"}`}
    >
      <Mark className="h-[72%] w-[72%]" />
    </span>
  );
}

// Wordmark — the mark + "QuickSense" lockup. "Quick" uses --text, "Sense" uses
// --primary, so the wordmark adapts correctly in dark mode (SPEC-003.5 §1).
export function Wordmark({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <Mark className={markClassName ?? "h-7 w-7"} />
      <span className="text-[19px] font-bold leading-none tracking-tight">
        <span className="text-foreground">Quick</span>
        <span className="text-primary">Sense</span>
      </span>
    </span>
  );
}

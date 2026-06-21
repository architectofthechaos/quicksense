"use client";
import { CircleAlert, Loader, Terminal } from "lucide-react";
import type { RunOutput } from "@/lib/types";
import { SampleGrid } from "@/components/SampleGrid";

// Per-cell run state. `unavailable` is the graceful 501 case (the Spark-Connect
// broker is not wired yet); `done` renders whatever frames a successful run
// returned (stdout / result table / error traceback).
export type CellRunState = "idle" | "running" | "done" | "error" | "unavailable";

// OutputRenderer is presentational: the editor owns the run lifecycle and passes
// the resolved state + frames. It tolerates the 501 ("execution unavailable")
// and renders text, table, and error outputs the run *would* produce.
export function OutputRenderer({
  state,
  outputs,
  errorMessage,
}: {
  state: CellRunState;
  outputs: RunOutput[] | null;
  errorMessage?: string;
}) {
  if (state === "idle" && (!outputs || outputs.length === 0)) return null;

  if (state === "running") {
    return (
      <div className="flex items-center gap-2 border-t border-border px-3 py-2.5 text-xs text-muted-foreground">
        <Loader className="h-3.5 w-3.5 animate-dot-pulse" aria-hidden />
        Running…
      </div>
    );
  }

  if (state === "unavailable") {
    return (
      <div className="border-t border-border px-3 py-3">
        <div className="flex items-start gap-2.5 rounded-md border border-dashed border-border bg-surface-2 px-3 py-2.5">
          <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="text-xs">
            <p className="font-semibold text-foreground">Execution is not yet available</p>
            <p className="mt-0.5 text-muted-foreground">
              {errorMessage ||
                "The Spark execution broker isn’t wired up in this environment yet. Attach a running cluster and try again once it’s available."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (state === "error" && (!outputs || outputs.length === 0)) {
    return (
      <div className="border-t border-border px-3 py-3">
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-xs"
          style={{
            color: "var(--error)",
            borderColor: "color-mix(in srgb, var(--error) 30%, var(--border))",
            background: "color-mix(in srgb, var(--error) 8%, var(--surface))",
          }}
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{errorMessage || "The run failed."}</span>
        </div>
      </div>
    );
  }

  const frames = outputs ?? [];
  if (frames.length === 0) return null;

  return (
    <div className="space-y-2 border-t border-border px-3 py-3">
      {frames.map((o, i) => (
        <OutputFrame key={i} output={o} />
      ))}
    </div>
  );
}

function OutputFrame({ output }: { output: RunOutput }) {
  if (output.type === "stdout") {
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-surface-2 px-3 py-2 font-mono text-[12.5px] leading-relaxed text-foreground">
        {output.text}
      </pre>
    );
  }
  if (output.type === "result") {
    return <SampleGrid columns={output.columns} rows={output.rows} />;
  }
  // error frame — Python-style traceback
  return (
    <div
      role="alert"
      className="overflow-x-auto rounded-md border px-3 py-2.5 font-mono text-[12px] leading-relaxed"
      style={{
        color: "var(--error)",
        borderColor: "color-mix(in srgb, var(--error) 30%, var(--border))",
        background: "color-mix(in srgb, var(--error) 8%, var(--surface))",
      }}
    >
      <div className="font-semibold">
        {output.ename}: {output.evalue}
      </div>
      {output.traceback.length > 0 && (
        <pre className="mt-1 whitespace-pre-wrap text-[11.5px] text-foreground/80">{output.traceback.join("\n")}</pre>
      )}
    </div>
  );
}

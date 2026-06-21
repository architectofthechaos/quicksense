"use client";
import { useId } from "react";
import type { ResourceSpec } from "@/lib/types";

// ResourceField edits one container's CPU + memory request/limit as the raw
// Kubernetes quantity strings the API expects (cpu: "500m"/"1"/"2"; memory:
// "512Mi"/"1Gi"/"2Gi"). Controlled — emits a full ResourceSpec on every edit.
export function ResourceField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ResourceSpec;
  onChange: (next: ResourceSpec) => void;
}) {
  const id = useId();
  const set = (patch: Partial<ResourceSpec>) => onChange({ ...value, ...patch });

  const cell = (
    key: keyof ResourceSpec,
    cellLabel: string,
    placeholder: string,
  ) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-${key}`} className="text-[11px] font-medium uppercase tracking-[0.04em] text-faint">
        {cellLabel}
      </label>
      <input
        id={`${id}-${key}`}
        value={value[key]}
        onChange={(e) => set({ [key]: e.target.value } as Partial<ResourceSpec>)}
        placeholder={placeholder}
        inputMode="text"
        className="focus-ring rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-[13px] text-foreground placeholder:text-faint"
      />
    </div>
  );

  return (
    <fieldset className="rounded-lg border border-border bg-surface p-3">
      <legend className="px-1 text-xs font-semibold text-foreground">{label}</legend>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">CPU</span>
          <div className="grid grid-cols-2 gap-2">
            {cell("cpu_request", "Request", "500m")}
            {cell("cpu_limit", "Limit", "1")}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Memory</span>
          <div className="grid grid-cols-2 gap-2">
            {cell("memory_request", "Request", "1Gi")}
            {cell("memory_limit", "Limit", "2Gi")}
          </div>
        </div>
      </div>
    </fieldset>
  );
}

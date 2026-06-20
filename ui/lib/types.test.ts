import { describe, it, expect } from "vitest";
import { phaseToBadge, isTerminalReady, connectUrl } from "@/lib/types";

describe("phaseToBadge", () => {
  it("ready flag wins regardless of phase string", () => {
    expect(phaseToBadge({ phase: "anything", ready: true })).toEqual({ kind: "ready", label: "Ready" });
  });
  it("maps Running phase", () => {
    expect(phaseToBadge({ phase: "Running", ready: false }).kind).toBe("running");
  });
  it("maps Failed/Error phases", () => {
    expect(phaseToBadge({ phase: "Failed", ready: false }).kind).toBe("failed");
    expect(phaseToBadge({ phase: "ErrorState", ready: false }).kind).toBe("failed");
  });
  it("treats empty/Unknown as unknown", () => {
    expect(phaseToBadge({ phase: "", ready: false }).kind).toBe("unknown");
    expect(phaseToBadge({ phase: "Unknown", ready: false }).kind).toBe("unknown");
  });
  it("treats other non-empty phases as pending and shows the raw phase as label", () => {
    const b = phaseToBadge({ phase: "Provisioning", ready: false });
    expect(b.kind).toBe("pending");
    expect(b.label).toBe("Provisioning");
  });
});

describe("isTerminalReady", () => {
  it("is true when ready", () => {
    expect(isTerminalReady({ phase: "", ready: true })).toBe(true);
  });
  it("is true when phase is Running (mirrors api-e2e semantics)", () => {
    expect(isTerminalReady({ phase: "Running", ready: false })).toBe(true);
  });
  it("is false otherwise", () => {
    expect(isTerminalReady({ phase: "Provisioning", ready: false })).toBe(false);
  });
});

describe("connectUrl", () => {
  it("builds the Spark Connect URL from the CR name (operator names the svc <cr>-server:15002)", () => {
    expect(connectUrl("qs-demo-ab12cd34")).toBe("sc://qs-demo-ab12cd34-server:15002");
  });
});

"use client";
import { Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Wordmark } from "@/components/brand/Logo";
import { Button } from "@/components/ui/Button";

function LoginCard() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/app/clusters";
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      {/* Subtle brand glow — tasteful, enterprise. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-[460px] w-[460px] -translate-x-1/2 rounded-full opacity-50 blur-3xl"
        style={{ background: "radial-gradient(closest-side, color-mix(in srgb, var(--primary) 28%, transparent), transparent)" }}
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-pop">
        <Wordmark className="mb-6" markClassName="h-8 w-8" />
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Sign in</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          The air-gapped agent control plane for your lakehouse.
        </p>
        <Button className="mt-6 w-full py-2.5" onClick={() => signIn("keycloak", { callbackUrl })}>
          Sign in with Keycloak
        </Button>
        <p className="mt-4 text-center text-xs text-faint">Secured by Keycloak · OpenID Connect</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginCard />
    </Suspense>
  );
}

import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";

// Auth-gated wrapper for every /app/* route. Middleware already redirects
// unauthenticated requests; this is the server-side belt-and-suspenders that
// also resolves the username for the shell.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");
  const username = session.user.name ?? "user";
  return <AppShell username={username}>{children}</AppShell>;
}

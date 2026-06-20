// isProtectedPath reports whether a pathname requires an authenticated session.
// Only the /app section is gated; "/applesauce" and similar must NOT match.
export function isProtectedPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

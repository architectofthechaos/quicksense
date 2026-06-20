import { auth } from "@/auth";
import { isProtectedPath } from "@/lib/route-guard";

// Gate /app/* on an authenticated session. Unauthenticated users are sent to
// the Auth.js sign-in route (which redirects to Keycloak), preserving the
// originally-requested URL as callbackUrl.
export default auth((req) => {
  if (isProtectedPath(req.nextUrl.pathname) && !req.auth) {
    const url = new URL("/api/auth/signin", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", req.nextUrl.href);
    return Response.redirect(url);
  }
});

// Run middleware on app routes only; static assets + auth endpoints are skipped.
export const config = {
  matcher: ["/app/:path*"],
};

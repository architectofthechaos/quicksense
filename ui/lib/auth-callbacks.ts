// Pure Auth.js callback helpers — no next-auth import, so they are unit-testable
// in isolation (auth.ts wires them into NextAuth). The access token lives only
// in the server-side JWT/session; client JS never reads it (route handlers do).

// refreshAccessToken exchanges the refresh_token for a fresh access_token via the
// Keycloak token endpoint. On failure it marks the token so the session can
// surface a re-auth requirement.
export async function refreshAccessToken(token: any): Promise<any> {
  try {
    const issuer = process.env.AUTH_KEYCLOAK_ISSUER!;
    const res = await fetch(`${issuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.AUTH_KEYCLOAK_ID!,
        client_secret: process.env.AUTH_KEYCLOAK_SECRET!,
        refresh_token: token.refresh_token,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "refresh_failed");
    return {
      ...token,
      access_token: data.access_token,
      expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 300),
      refresh_token: data.refresh_token ?? token.refresh_token,
      error: undefined,
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export async function jwtCallback({ token, account, profile }: any) {
  // Initial sign-in: persist tokens + expiry + username.
  if (account) {
    return {
      ...token,
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (account.expires_in ?? 300),
      username: profile?.preferred_username ?? token.name ?? token.username,
    };
  }
  // Still valid (60s skew) → reuse.
  if (token.expires_at && Date.now() / 1000 < token.expires_at - 60) {
    return token;
  }
  // Expired (or near) → refresh.
  if (token.refresh_token) return refreshAccessToken(token);
  return token;
}

export async function sessionCallback({ session, token }: any) {
  if (session.user) session.user.name = token.username ?? session.user.name;
  // Server-side only: route handlers read this to call the Go API. Delivered via
  // the HttpOnly session cookie; client JS never sees the raw token.
  (session as any).access_token = token.access_token;
  (session as any).error = token.error;
  return session;
}

import { describe, it, expect, vi, beforeEach } from "vitest";
import { jwtCallback, sessionCallback, refreshAccessToken } from "@/lib/auth-callbacks";

describe("jwtCallback", () => {
  it("stores tokens + expiry + username from the initial account", async () => {
    const token = {};
    const account = { access_token: "AT", refresh_token: "RT", expires_in: 300 } as any;
    const out = await jwtCallback({ token, account, profile: { preferred_username: "qsuser" } } as any);
    expect(out.access_token).toBe("AT");
    expect(out.refresh_token).toBe("RT");
    expect(typeof out.expires_at).toBe("number");
    expect(out.username).toBe("qsuser");
  });

  it("returns the existing token unchanged while not expired", async () => {
    const token = { access_token: "AT", expires_at: Math.floor(Date.now() / 1000) + 999, refresh_token: "RT" };
    const out = await jwtCallback({ token, account: null } as any);
    expect(out.access_token).toBe("AT");
  });
});

describe("sessionCallback", () => {
  it("exposes username on session.user.name and access_token on the session", async () => {
    const session: any = { user: {} };
    const token: any = { username: "qsuser", access_token: "AT", error: undefined };
    const out = await sessionCallback({ session, token } as any);
    expect(out.user.name).toBe("qsuser");
    expect(out.access_token).toBe("AT");
  });
});

describe("refreshAccessToken", () => {
  beforeEach(() => {
    process.env.AUTH_KEYCLOAK_ISSUER = "http://kc.test/realms/quicksense";
    process.env.AUTH_KEYCLOAK_ID = "quicksense-ui";
    process.env.AUTH_KEYCLOAK_SECRET = "secret";
    vi.restoreAllMocks();
  });

  it("exchanges the refresh token for a new access token", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "AT2", refresh_token: "RT2", expires_in: 300 }), { status: 200 }),
    );
    const out = await refreshAccessToken({ refresh_token: "RT" } as any);
    expect(out.access_token).toBe("AT2");
    expect(out.refresh_token).toBe("RT2");
    expect(out.error).toBeUndefined();
  });

  it("marks the token with an error when refresh fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    );
    const out = await refreshAccessToken({ refresh_token: "RT" } as any);
    expect(out.error).toBe("RefreshAccessTokenError");
  });
});

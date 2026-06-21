import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    adminListUsers: vi.fn(),
    adminCreateUser: vi.fn(),
    adminAssignRole: vi.fn(),
    adminListGroups: vi.fn(),
    adminCreateGroup: vi.fn(),
  };
});

import { auth } from "@/auth";
import {
  adminListUsers,
  adminCreateUser,
  adminAssignRole,
  adminListGroups,
  adminCreateGroup,
  ApiClientError,
} from "@/lib/api";
import { GET, POST, PUT } from "@/app/api/admin/[...path]/route";

beforeEach(() => vi.clearAllMocks());
const SESSION = { access_token: "TOK" };

function req(url = "http://x/api/admin/users", method = "GET", body?: unknown) {
  return new Request(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  });
}
function ctx(path: string[]) {
  return { params: Promise.resolve({ path }) } as any;
}

describe("admin BFF — auth", () => {
  it("401s every verb when unauthenticated", async () => {
    (auth as any).mockResolvedValue(null);
    expect((await GET(req(), ctx(["users"]))).status).toBe(401);
    expect((await POST(req("http://x", "POST", {}), ctx(["users"]))).status).toBe(401);
    expect((await PUT(req("http://x", "PUT", {}), ctx(["users", "u1", "roles"]))).status).toBe(401);
    expect(adminListUsers).not.toHaveBeenCalled();
  });
});

describe("admin BFF — GET", () => {
  beforeEach(() => (auth as any).mockResolvedValue(SESSION));

  it("lists users, wrapped in an envelope, injecting the token", async () => {
    (adminListUsers as any).mockResolvedValue([{ id: "u1", username: "alice", email: "a@x", enabled: true }]);
    const res = await GET(req(), ctx(["users"]));
    expect(res.status).toBe(200);
    expect((await res.json()).users).toHaveLength(1);
    expect(adminListUsers).toHaveBeenCalledWith("TOK");
  });

  it("lists groups, wrapped in an envelope", async () => {
    (adminListGroups as any).mockResolvedValue([{ id: "g1", name: "data" }]);
    const res = await GET(req("http://x/api/admin/groups"), ctx(["groups"]));
    expect(res.status).toBe(200);
    expect((await res.json()).groups).toEqual([{ id: "g1", name: "data" }]);
    expect(adminListGroups).toHaveBeenCalledWith("TOK");
  });

  it("404s an unknown GET path", async () => {
    const res = await GET(req("http://x/api/admin/widgets"), ctx(["widgets"]));
    expect(res.status).toBe(404);
  });

  it("propagates a 403 (non-admin) status + code", async () => {
    (adminListUsers as any).mockRejectedValue(new ApiClientError("admin only", 403, "forbidden"));
    const res = await GET(req(), ctx(["users"]));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
  });

  it("propagates a 501 (unconfigured) status", async () => {
    (adminListGroups as any).mockRejectedValue(new ApiClientError("not configured", 501, "not_implemented"));
    const res = await GET(req("http://x/api/admin/groups"), ctx(["groups"]));
    expect(res.status).toBe(501);
  });
});

describe("admin BFF — POST", () => {
  beforeEach(() => (auth as any).mockResolvedValue(SESSION));

  it("creates a user from username + email and returns 201", async () => {
    const user = { id: "u2", username: "bob", email: "b@x", enabled: true };
    (adminCreateUser as any).mockResolvedValue(user);
    const res = await POST(req("http://x/api/admin/users", "POST", { username: "bob", email: "b@x" }), ctx(["users"]));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(user);
    expect(adminCreateUser).toHaveBeenCalledWith("TOK", "bob", "b@x");
  });

  it("400s a user create missing username", async () => {
    const res = await POST(req("http://x/api/admin/users", "POST", { email: "b@x" }), ctx(["users"]));
    expect(res.status).toBe(400);
    expect(adminCreateUser).not.toHaveBeenCalled();
  });

  it("creates a group from name and returns 201", async () => {
    (adminCreateGroup as any).mockResolvedValue({ id: "g2", name: "ml" });
    const res = await POST(req("http://x/api/admin/groups", "POST", { name: "ml" }), ctx(["groups"]));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "g2", name: "ml" });
    expect(adminCreateGroup).toHaveBeenCalledWith("TOK", "ml");
  });

  it("400s a group create missing name", async () => {
    const res = await POST(req("http://x/api/admin/groups", "POST", {}), ctx(["groups"]));
    expect(res.status).toBe(400);
    expect(adminCreateGroup).not.toHaveBeenCalled();
  });

  it("404s an unknown POST path", async () => {
    const res = await POST(req("http://x/api/admin/widgets", "POST", {}), ctx(["widgets"]));
    expect(res.status).toBe(404);
  });

  it("propagates an upstream 409 on create", async () => {
    (adminCreateUser as any).mockRejectedValue(new ApiClientError("exists", 409, "conflict"));
    const res = await POST(req("http://x/api/admin/users", "POST", { username: "bob", email: "b@x" }), ctx(["users"]));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflict");
  });
});

describe("admin BFF — PUT (assign role)", () => {
  beforeEach(() => (auth as any).mockResolvedValue(SESSION));

  it("assigns a role to a user and returns 204", async () => {
    (adminAssignRole as any).mockResolvedValue(undefined);
    const res = await PUT(
      req("http://x/api/admin/users/u1/roles", "PUT", { role: "quicksense_admin" }),
      ctx(["users", "u1", "roles"]),
    );
    expect(res.status).toBe(204);
    expect(adminAssignRole).toHaveBeenCalledWith("TOK", "u1", "quicksense_admin");
  });

  it("400s a role assignment missing role", async () => {
    const res = await PUT(req("http://x/api/admin/users/u1/roles", "PUT", {}), ctx(["users", "u1", "roles"]));
    expect(res.status).toBe(400);
    expect(adminAssignRole).not.toHaveBeenCalled();
  });

  it("404s an unknown PUT path", async () => {
    const res = await PUT(req("http://x/api/admin/users/u1", "PUT", { role: "x" }), ctx(["users", "u1"]));
    expect(res.status).toBe(404);
  });

  it("propagates an upstream 403 on assign", async () => {
    (adminAssignRole as any).mockRejectedValue(new ApiClientError("admin only", 403, "forbidden"));
    const res = await PUT(
      req("http://x/api/admin/users/u1/roles", "PUT", { role: "quicksense_admin" }),
      ctx(["users", "u1", "roles"]),
    );
    expect(res.status).toBe(403);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, listPermissions: vi.fn(), grantPermission: vi.fn(), revokePermission: vi.fn() };
});

import { auth } from "@/auth";
import { listPermissions, grantPermission, revokePermission, ApiClientError } from "@/lib/api";
import { GET, PUT, DELETE } from "@/app/api/clusters/[id]/permissions/route";

beforeEach(() => vi.clearAllMocks());
const ctx = { params: Promise.resolve({ id: "c1" }) };
const SESSION = { access_token: "TOK" };

function req(url = "http://x/api/clusters/c1/permissions", method = "GET", body?: unknown) {
  return new Request(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  });
}

describe("clusters permissions BFF — auth", () => {
  it("401s every verb when unauthenticated", async () => {
    (auth as any).mockResolvedValue(null);
    expect((await GET(req(), ctx as any)).status).toBe(401);
    expect((await PUT(req("http://x", "PUT", {}), ctx as any)).status).toBe(401);
    expect((await DELETE(req("http://x", "DELETE"), ctx as any)).status).toBe(401);
  });
});

describe("clusters permissions BFF — GET", () => {
  beforeEach(() => (auth as any).mockResolvedValue(SESSION));

  it("lists permissions for the cluster, wrapped in an envelope", async () => {
    (listPermissions as any).mockResolvedValue([{ principal_type: "user", principal_id: "alice", level: "manage" }]);
    const res = await GET(req(), ctx as any);
    expect(res.status).toBe(200);
    expect((await res.json()).permissions).toHaveLength(1);
    expect(listPermissions).toHaveBeenCalledWith("clusters", "c1", "TOK");
  });

  it("propagates an upstream error status + code", async () => {
    (listPermissions as any).mockRejectedValue(new ApiClientError("nope", 403, "forbidden"));
    const res = await GET(req(), ctx as any);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
  });
});

describe("clusters permissions BFF — PUT (grant)", () => {
  beforeEach(() => (auth as any).mockResolvedValue(SESSION));

  it("grants a permission and returns 200 with the grant", async () => {
    const grant = { principal_type: "user", principal_id: "bob", level: "attach" };
    (grantPermission as any).mockResolvedValue(grant);
    const res = await PUT(req("http://x", "PUT", grant), ctx as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(grant);
    expect(grantPermission).toHaveBeenCalledWith("clusters", "c1", grant, "TOK");
  });

  it("400s a grant missing required fields", async () => {
    const res = await PUT(req("http://x", "PUT", { principal_type: "user" }), ctx as any);
    expect(res.status).toBe(400);
    expect(grantPermission).not.toHaveBeenCalled();
  });

  it("propagates a 400 invalid-level from upstream", async () => {
    (grantPermission as any).mockRejectedValue(new ApiClientError("bad level", 400, "invalid_level"));
    const res = await PUT(req("http://x", "PUT", { principal_type: "user", principal_id: "x", level: "bogus" }), ctx as any);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_level");
  });
});

describe("clusters permissions BFF — DELETE (revoke)", () => {
  beforeEach(() => (auth as any).mockResolvedValue(SESSION));

  it("revokes a permission, forwarding the principal query", async () => {
    (revokePermission as any).mockResolvedValue(undefined);
    const res = await DELETE(
      req("http://x/api/clusters/c1/permissions?principal_type=group&principal_id=data", "DELETE"),
      ctx as any,
    );
    expect(res.status).toBe(204);
    expect(revokePermission).toHaveBeenCalledWith("clusters", "c1", "group", "data", "TOK");
  });

  it("400s a revoke missing principal params", async () => {
    const res = await DELETE(req("http://x/api/clusters/c1/permissions", "DELETE"), ctx as any);
    expect(res.status).toBe(400);
    expect(revokePermission).not.toHaveBeenCalled();
  });
});

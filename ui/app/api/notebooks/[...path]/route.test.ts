import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listNotebooks: vi.fn(),
    createNotebook: vi.fn(),
    getNotebook: vi.fn(),
    saveNotebook: vi.fn(),
    trashNotebook: vi.fn(),
    attachNotebook: vi.fn(),
    listRevisions: vi.fn(),
    saveRevision: vi.fn(),
    restoreRevision: vi.fn(),
    runCell: vi.fn(),
    listNotebookPermissions: vi.fn(),
    putNotebookPermission: vi.fn(),
    deleteNotebookPermission: vi.fn(),
  };
});

import { auth } from "@/auth";
import {
  listNotebooks,
  createNotebook,
  getNotebook,
  saveNotebook,
  trashNotebook,
  attachNotebook,
  listRevisions,
  saveRevision,
  restoreRevision,
  runCell,
  listNotebookPermissions,
  putNotebookPermission,
  deleteNotebookPermission,
  ApiClientError,
} from "@/lib/api";
import { GET, POST, PUT, DELETE } from "@/app/api/notebooks/[...path]/route";

beforeEach(() => vi.clearAllMocks());

function ctx(path: string[]) {
  return { params: Promise.resolve({ path }) } as any;
}
function req(url = "http://x/api/notebooks", method = "GET", body?: unknown) {
  return new Request(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  });
}

const SESSION = { access_token: "TOK" };

describe("notebooks BFF — auth", () => {
  it("401s every verb when unauthenticated", async () => {
    (auth as any).mockResolvedValue(null);
    expect((await GET(req(), ctx([]))).status).toBe(401);
    expect((await POST(req("http://x/api/notebooks", "POST", { name: "a" }), ctx([]))).status).toBe(401);
    expect((await PUT(req("http://x/api/notebooks/n1", "PUT", {}), ctx(["n1"]))).status).toBe(401);
    expect((await DELETE(req("http://x/api/notebooks/n1", "DELETE"), ctx(["n1"]))).status).toBe(401);
  });
});

describe("notebooks BFF — GET", () => {
  beforeEach(() => (auth as any).mockResolvedValue(SESSION));

  it("lists notebooks (empty path)", async () => {
    (listNotebooks as any).mockResolvedValue([{ id: "n1" }]);
    const res = await GET(req(), ctx([]));
    expect(res.status).toBe(200);
    expect((await res.json()).notebooks).toHaveLength(1);
    expect(listNotebooks).toHaveBeenCalledWith("TOK");
  });

  it("gets a single notebook", async () => {
    (getNotebook as any).mockResolvedValue({ id: "n1", content: { cells: [] } });
    const res = await GET(req("http://x/api/notebooks/n1"), ctx(["n1"]));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("n1");
    expect(getNotebook).toHaveBeenCalledWith("TOK", "n1");
  });

  it("lists revisions", async () => {
    (listRevisions as any).mockResolvedValue([{ id: "r1" }]);
    const res = await GET(req("http://x/api/notebooks/n1/revisions"), ctx(["n1", "revisions"]));
    expect(res.status).toBe(200);
    expect((await res.json()).revisions).toHaveLength(1);
    expect(listRevisions).toHaveBeenCalledWith("TOK", "n1");
  });

  it("lists permissions", async () => {
    (listNotebookPermissions as any).mockResolvedValue([{ principal_type: "user", principal_id: "a", level: "run" }]);
    const res = await GET(req("http://x/api/notebooks/n1/permissions"), ctx(["n1", "permissions"]));
    expect(res.status).toBe(200);
    expect((await res.json()).permissions).toHaveLength(1);
    expect(listNotebookPermissions).toHaveBeenCalledWith("TOK", "n1");
  });

  it("404s an unknown GET shape", async () => {
    const res = await GET(req("http://x/api/notebooks/n1/bogus"), ctx(["n1", "bogus"]));
    expect(res.status).toBe(404);
  });
});

describe("notebooks BFF — POST", () => {
  beforeEach(() => (auth as any).mockResolvedValue(SESSION));

  it("creates a notebook (empty path)", async () => {
    (createNotebook as any).mockResolvedValue({ id: "n1" });
    const res = await POST(req("http://x/api/notebooks", "POST", { name: "A", path: "/A" }), ctx([]));
    expect(res.status).toBe(201);
    expect(createNotebook).toHaveBeenCalledWith("TOK", { name: "A", path: "/A" });
  });

  it("400s a create with no name", async () => {
    const res = await POST(req("http://x/api/notebooks", "POST", { path: "/A" }), ctx([]));
    expect(res.status).toBe(400);
    expect(createNotebook).not.toHaveBeenCalled();
  });

  it("attaches a cluster", async () => {
    (attachNotebook as any).mockResolvedValue({ id: "n1", attached_cluster_id: "cl1" });
    const res = await POST(req("http://x/api/notebooks/n1/attach", "POST", { cluster_id: "cl1" }), ctx(["n1", "attach"]));
    expect(res.status).toBe(200);
    expect(attachNotebook).toHaveBeenCalledWith("TOK", "n1", "cl1");
  });

  it("400s an attach with no cluster_id", async () => {
    const res = await POST(req("http://x/api/notebooks/n1/attach", "POST", {}), ctx(["n1", "attach"]));
    expect(res.status).toBe(400);
    expect(attachNotebook).not.toHaveBeenCalled();
  });

  it("saves a revision", async () => {
    (saveRevision as any).mockResolvedValue({ id: "r2" });
    const res = await POST(req("http://x/api/notebooks/n1/revisions", "POST", { message: "cp" }), ctx(["n1", "revisions"]));
    expect(res.status).toBe(201);
    expect(saveRevision).toHaveBeenCalledWith("TOK", "n1", "cp");
  });

  it("restores a revision", async () => {
    (restoreRevision as any).mockResolvedValue({ id: "n1" });
    const res = await POST(
      req("http://x/api/notebooks/n1/revisions/r1/restore", "POST"),
      ctx(["n1", "revisions", "r1", "restore"]),
    );
    expect(res.status).toBe(200);
    expect(restoreRevision).toHaveBeenCalledWith("TOK", "n1", "r1");
  });

  it("runs a cell and passes the body through", async () => {
    (runCell as any).mockResolvedValue({ outputs: [{ type: "stdout", text: "hi" }] });
    const res = await POST(req("http://x/api/notebooks/n1/run", "POST", { cell_id: "c1" }), ctx(["n1", "run"]));
    expect(res.status).toBe(200);
    expect((await res.json()).outputs).toHaveLength(1);
    expect(runCell).toHaveBeenCalledWith("TOK", "n1", { cell_id: "c1" });
  });

  it("propagates the 501 execution-unavailable from /run", async () => {
    (runCell as any).mockRejectedValue(new ApiClientError("broker pending", 501, "execution_unavailable"));
    const res = await POST(req("http://x/api/notebooks/n1/run", "POST", {}), ctx(["n1", "run"]));
    expect(res.status).toBe(501);
    expect((await res.json()).error.code).toBe("execution_unavailable");
  });

  it("404s an unknown POST shape", async () => {
    const res = await POST(req("http://x/api/notebooks/n1/bogus", "POST", {}), ctx(["n1", "bogus"]));
    expect(res.status).toBe(404);
  });
});

describe("notebooks BFF — PUT", () => {
  beforeEach(() => (auth as any).mockResolvedValue(SESSION));

  it("saves notebook content", async () => {
    (saveNotebook as any).mockResolvedValue({ id: "n1" });
    const content = { cells: [{ id: "c1", type: "code", source: "x" }] };
    const res = await PUT(req("http://x/api/notebooks/n1", "PUT", { content }), ctx(["n1"]));
    expect(res.status).toBe(200);
    expect(saveNotebook).toHaveBeenCalledWith("TOK", "n1", content);
  });

  it("grants a permission", async () => {
    (putNotebookPermission as any).mockResolvedValue(undefined);
    const perm = { principal_type: "user", principal_id: "alice", level: "edit" };
    const res = await PUT(req("http://x/api/notebooks/n1/permissions", "PUT", perm), ctx(["n1", "permissions"]));
    expect(res.status).toBe(204);
    expect(putNotebookPermission).toHaveBeenCalledWith("TOK", "n1", perm);
  });

  it("400s a content save with no content", async () => {
    const res = await PUT(req("http://x/api/notebooks/n1", "PUT", {}), ctx(["n1"]));
    expect(res.status).toBe(400);
    expect(saveNotebook).not.toHaveBeenCalled();
  });
});

describe("notebooks BFF — DELETE", () => {
  beforeEach(() => (auth as any).mockResolvedValue(SESSION));

  it("trashes a notebook (204)", async () => {
    (trashNotebook as any).mockResolvedValue(undefined);
    const res = await DELETE(req("http://x/api/notebooks/n1", "DELETE"), ctx(["n1"]));
    expect(res.status).toBe(204);
    expect(trashNotebook).toHaveBeenCalledWith("TOK", "n1");
  });

  it("revokes a permission, forwarding the principal query", async () => {
    (deleteNotebookPermission as any).mockResolvedValue(undefined);
    const res = await DELETE(
      req("http://x/api/notebooks/n1/permissions?principal_type=group&principal_id=data", "DELETE"),
      ctx(["n1", "permissions"]),
    );
    expect(res.status).toBe(204);
    expect(deleteNotebookPermission).toHaveBeenCalledWith("TOK", "n1", "group", "data");
  });

  it("400s a permission revoke missing principal params", async () => {
    const res = await DELETE(req("http://x/api/notebooks/n1/permissions", "DELETE"), ctx(["n1", "permissions"]));
    expect(res.status).toBe(400);
    expect(deleteNotebookPermission).not.toHaveBeenCalled();
  });
});

describe("notebooks BFF — error propagation", () => {
  beforeEach(() => (auth as any).mockResolvedValue(SESSION));
  it("propagates an upstream error status + code", async () => {
    (getNotebook as any).mockRejectedValue(new ApiClientError("gone", 404, "not_found"));
    const res = await GET(req("http://x/api/notebooks/n1"), ctx(["n1"]));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});

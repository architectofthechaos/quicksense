import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, notebookExport: vi.fn() };
});

import { auth } from "@/auth";
import { notebookExport, ApiClientError } from "@/lib/api";
import { GET } from "@/app/api/notebooks/[id]/export/route";

beforeEach(() => vi.clearAllMocks());

function ctx(id: string) {
  return { params: Promise.resolve({ id }) } as any;
}
function req(url: string) {
  return new Request(url, { method: "GET" });
}

describe("GET /api/notebooks/[id]/export", () => {
  it("401 when unauthenticated", async () => {
    (auth as any).mockResolvedValue(null);
    const res = await GET(req("http://x/api/notebooks/n1/export?format=py"), ctx("n1"));
    expect(res.status).toBe(401);
  });

  it("streams the upstream body and preserves content-type + content-disposition", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (notebookExport as any).mockResolvedValue(
      new Response("print(1)\n", {
        status: 200,
        headers: { "content-type": "text/x-python", "content-disposition": 'attachment; filename="Analysis.py"' },
      }),
    );
    const res = await GET(req("http://x/api/notebooks/n1/export?format=py"), ctx("n1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/x-python");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="Analysis.py"');
    expect(await res.text()).toBe("print(1)\n");
    expect(notebookExport).toHaveBeenCalledWith("TOK", "n1", "py");
  });

  it("defaults the format to ipynb when absent or invalid", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (notebookExport as any).mockResolvedValue(new Response("{}", { status: 200 }));
    await GET(req("http://x/api/notebooks/n1/export"), ctx("n1"));
    expect(notebookExport).toHaveBeenCalledWith("TOK", "n1", "ipynb");
    await GET(req("http://x/api/notebooks/n1/export?format=bogus"), ctx("n1"));
    expect(notebookExport).toHaveBeenLastCalledWith("TOK", "n1", "ipynb");
  });

  it("synthesizes a content-disposition when the upstream omits one", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (notebookExport as any).mockResolvedValue(new Response("data", { status: 200 }));
    const res = await GET(req("http://x/api/notebooks/n1/export?format=py"), ctx("n1"));
    expect(res.headers.get("content-disposition")).toMatch(/attachment/);
  });

  it("propagates an upstream error status", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (notebookExport as any).mockRejectedValue(new ApiClientError("gone", 404, "not_found"));
    const res = await GET(req("http://x/api/notebooks/n1/export?format=py"), ctx("n1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "@/components/Markdown";

describe("Markdown", () => {
  it("renders headings at the right level", () => {
    render(<Markdown source={"# Title\n## Sub"} />);
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Sub" })).toBeInTheDocument();
  });

  it("renders bold and italic and inline code", () => {
    const { container } = render(<Markdown source={"This is **bold** and *italic* and `code`."} />);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    expect(container.querySelector("code")?.textContent).toBe("code");
  });

  it("renders unordered and ordered lists", () => {
    const { container } = render(<Markdown source={"- one\n- two\n\n1. first\n2. second"} />);
    const uls = container.querySelectorAll("ul");
    const ols = container.querySelectorAll("ol");
    expect(uls).toHaveLength(1);
    expect(ols).toHaveLength(1);
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
  });

  it("renders fenced code blocks as a pre/code, not interpreting inner markup", () => {
    const { container } = render(<Markdown source={"```\n# not a heading\nprint(1)\n```"} />);
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toContain("# not a heading");
    expect(container.querySelector("h1")).toBeNull();
  });

  it("renders links with href", () => {
    const { container } = render(<Markdown source={"[QuickSense](https://example.com)"} />);
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.textContent).toBe("QuickSense");
  });

  it("escapes raw HTML to prevent injection", () => {
    const { container } = render(<Markdown source={"<img src=x onerror=alert(1)>"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img");
  });

  it("renders an empty-state hint when source is blank", () => {
    render(<Markdown source={"   "} />);
    expect(screen.getByText(/empty markdown/i)).toBeInTheDocument();
  });
});

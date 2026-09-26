import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The Could not refresh data notice used to float over the page. At 390 wide
// it sat on the Choose item picker of Check-Out, so a tap meant for the picker
// landed on the notice. It now sits in the page flow above the page content,
// where it pushes the page down and covers nothing at any width.

const src = (...parts: string[]) =>
  readFileSync(path.join(__dirname, "..", "client", "src", ...parts), "utf8");

function noticeJsx(source: string): string {
  const at = source.indexOf('data-testid="notice-refresh-failed"');
  if (at < 0) return "";
  const open = source.lastIndexOf("<div", at);
  const close = source.indexOf("</div>", at);
  return source.slice(open, close);
}

describe("refresh notice placement", () => {
  it("is rendered by the shell before the page content, not by the provider", () => {
    const shell = src("components", "layout", "AppShell.tsx");
    const noticeAt = shell.indexOf("<RefreshNotice");
    expect(noticeAt).toBeGreaterThan(-1);
    expect(noticeAt).toBeLessThan(shell.indexOf("<main"));
    const provider = src("lib", "repository.tsx");
    const providerReturn = provider.slice(provider.indexOf("<RepositoryContext.Provider"));
    expect(providerReturn).not.toContain("notice-refresh-failed");
  });

  it("is never positioned over other content", () => {
    const jsx = noticeJsx(src("lib", "repository.tsx"));
    expect(jsx).not.toBe("");
    expect(jsx).not.toMatch(/\b(fixed|absolute|sticky)\b/);
    expect(jsx).toContain('role="status"');
    expect(jsx).toContain("button-refresh-retry");
  });
});

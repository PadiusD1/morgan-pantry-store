import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// A success toast closes by itself after about 3 seconds, and only a
// destructive toast stays pinned. So every toast that reports a failure must
// be destructive, or the failure can vanish before anyone reads it.

const pagesDir = path.join(__dirname, "..", "client", "src", "pages");
const FAILURE_TITLE = /title:\s*["'`][^"'`]*\b(failed|error|invalid|not saved|not recorded)\b/i;

function toastCalls(source: string): string[] {
  const calls: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf("toast({", from);
    if (start < 0) return calls;
    let depth = 0;
    let end = start + "toast(".length;
    for (; end < source.length; end++) {
      const ch = source[end];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(start, end + 1));
    from = end + 1;
  }
}

describe("failure toasts stay pinned", () => {
  const offenders: string[] = [];
  for (const file of readdirSync(pagesDir).filter((f) => f.endsWith(".tsx"))) {
    const source = readFileSync(path.join(pagesDir, file), "utf8");
    for (const call of toastCalls(source)) {
      if (FAILURE_TITLE.test(call) && !/variant:\s*["']destructive["']/.test(call)) {
        offenders.push(`${file} ${call.replace(/\s+/g, " ").slice(0, 90)}`);
      }
    }
  }

  it("marks every failure toast on every page destructive", () => {
    expect(offenders).toEqual([]);
  });
});

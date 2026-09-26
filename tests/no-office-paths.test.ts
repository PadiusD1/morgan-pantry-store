import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This repository is public. No tracked file may name a folder on the office
// server, so tools read their locations from settings with neutral defaults.

const repo = path.join(__dirname, "..");
const OFFICE_PATH = /\/srv\/|\/home\/ops\b/;
const SKIP = new Set(["package-lock.json", "api/index.js"]);

describe("office paths", () => {
  it("appear in no tracked file", () => {
    const files = execFileSync("git", ["ls-files", "-z"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    }).split("\0").filter((f) => f && !SKIP.has(f));
    const hits = files.filter((f) => {
      try {
        return OFFICE_PATH.test(readFileSync(path.join(repo, f), "utf8"));
      } catch {
        return false;
      }
    });
    expect(hits).toEqual([]);
  });
});

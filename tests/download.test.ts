import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CSV_BOM } from "@shared/csv";
import { REVOKE_DELAY_MS, canUseServerExports, downloadBlob, downloadCsvText } from "@/lib/download";

type FakeLink = { href: string; download: string; style: Record<string, string>; click: () => void; remove: () => void };

let attached: FakeLink[];
let clickedWhileAttached: boolean[];
let lastBlob: Blob | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  attached = [];
  clickedWhileAttached = [];
  lastBlob = undefined;
  const fakeDocument = {
    createElement: () => {
      const link: FakeLink = {
        href: "",
        download: "",
        style: {},
        click: () => clickedWhileAttached.push(attached.includes(link)),
        remove: () => {
          attached = attached.filter((l) => l !== link);
        },
      };
      return link;
    },
    body: { appendChild: (link: FakeLink) => attached.push(link) },
  };
  vi.stubGlobal("document", fakeDocument);
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob: Blob) => {
    lastBlob = blob;
    return "blob:test-1";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("downloadBlob", () => {
  it("clicks the link while it is attached to the page and removes it after", () => {
    downloadBlob(new Blob(["x"]), "file.csv");
    expect(clickedWhileAttached).toEqual([true]);
    expect(attached).toHaveLength(0);
  });

  it("revokes the object URL only after the delay", () => {
    downloadBlob(new Blob(["x"]), "file.csv");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVOKE_DELAY_MS - 1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-1");
  });
});

describe("downloadCsvText", () => {
  it("writes exactly one byte order mark", async () => {
    downloadCsvText(`${CSV_BOM}a,b`, "file.csv");
    const first = new Uint8Array(await lastBlob!.arrayBuffer());
    downloadCsvText("a,b", "file.csv");
    const second = new Uint8Array(await lastBlob!.arrayBuffer());
    for (const bytes of [first, second]) {
      expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
      expect(Array.from(bytes.slice(3))).toEqual([0x61, 0x2c, 0x62]);
    }
  });
});

describe("canUseServerExports", () => {
  it("allows only the roles the server lets export", () => {
    expect(canUseServerExports("admin")).toBe(true);
    expect(canUseServerExports("staff")).toBe(true);
    expect(canUseServerExports("volunteer")).toBe(false);
    expect(canUseServerExports("student")).toBe(false);
    expect(canUseServerExports(undefined)).toBe(false);
  });
});

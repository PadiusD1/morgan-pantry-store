import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));
import { lookupBarcode } from "@/lib/barcode-lookup";

beforeEach(() => {
  apiRequest.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("barcode lookup client", () => {
  it("returns every repeated physical scan, even within two seconds", async () => {
    const result = { status: "exists", item: { id: "rice" }, logs: [] };
    apiRequest.mockImplementation(async () => ({ json: async () => result }));
    expect(await lookupBarcode("123456789012")).toEqual(result);
    expect(await lookupBarcode("123456789012")).toEqual(result);
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("uses the same-origin API and encodes a barcode as one path segment", async () => {
    apiRequest.mockResolvedValue({ json: async () => ({ status: "not_found", logs: [] }) });
    await lookupBarcode("  abc/123?x=1  ");
    expect(apiRequest).toHaveBeenCalledWith("GET", "/api/barcode-lookup/abc%2F123%3Fx%3D1");
  });

  it("keeps an outage or expired-session error distinct from a missing product", async () => {
    const error = new Error("401: Sign in again");
    apiRequest.mockRejectedValue(error);
    await expect(lookupBarcode("123456789012")).rejects.toBe(error);
  });

  it("does not send an empty lookup", async () => {
    expect(await lookupBarcode("  ")).toEqual({ status: "not_found", barcode: "", logs: [] });
    expect(apiRequest).not.toHaveBeenCalled();
  });
});

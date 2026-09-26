import { describe, expect, it } from "vitest";
import { clientUpdateFailureText, postVisitAfterClient, sendClientUpdate } from "@/lib/client-update";
import { SessionExpiredError } from "@/lib/queryClient";
import { duplicateRefusal } from "@shared/identity";

type Call = { method: string; url: string; data?: unknown };

function fakeRequest(answers: Record<string, number | "network">) {
  const calls: Call[] = [];
  const request = async (method: string, url: string, data?: unknown) => {
    calls.push({ method, url, data });
    // Let the check out run ahead, as a slow network would.
    await new Promise((r) => setTimeout(r, 5));
    const answer = answers[method] ?? 200;
    if (answer === "network") throw new TypeError("Failed to fetch");
    if (answer >= 400) throw new Error(`${answer}: {"message":"failed"}`);
    return new Response("{}", { status: answer });
  };
  return { calls, request };
}

const visit = (clientId: string) => ({ type: "OUT", clientId, clientClassification: "Senior" });

describe("check out after an existing person's update", () => {
  it("sends no visit and gives no success when the update answers 500", async () => {
    const { calls, request } = fakeRequest({ PATCH: 500 });
    const ready = sendClientUpdate(request, "c1", { classification: "Senior" });
    await expect(postVisitAfterClient(request, ready, visit)).rejects.toThrow(/^500/);
    expect(calls.map((c) => c.method)).toEqual(["PATCH"]);
  });

  it("sends no visit when the update is lost on the network", async () => {
    const { calls, request } = fakeRequest({ PATCH: "network" });
    const ready = sendClientUpdate(request, "c1", { classification: "Senior" });
    await expect(postVisitAfterClient(request, ready, visit)).rejects.toThrow(/Failed to fetch/);
    expect(calls.map((c) => c.method)).toEqual(["PATCH"]);
  });

  it("sends no visit when the update is refused as a duplicate", async () => {
    const { calls, request } = fakeRequest({ PATCH: 409 });
    const ready = sendClientUpdate(request, "c1", { email: "shared@example.test" });
    await expect(postVisitAfterClient(request, ready, visit)).rejects.toThrow(/^409/);
    expect(calls.map((c) => c.method)).toEqual(["PATCH"]);
  });

  it("sends the visit for that person only after the update is confirmed", async () => {
    const { calls, request } = fakeRequest({});
    const ready = sendClientUpdate(request, "c1", { classification: "Senior" });
    const res = await postVisitAfterClient(request, ready, visit);
    expect(res.status).toBe(200);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["PATCH /api/clients/c1", "POST /api/transactions"]);
    expect(calls[1].data).toEqual(visit("c1"));
  });
});

describe("what a check out shows when the person's update failed", () => {
  const fail = async (answer: number | "network", body = '{"message":"failed"}') => {
    const request = async () => {
      if (answer === "network") throw new TypeError("Failed to fetch");
      throw new Error(`${answer}: ${body}`);
    };
    return sendClientUpdate(request, "c1", {}).catch((e) => e);
  };

  it("says the details may be saved and the visit was not, after a 500 or a lost answer", async () => {
    for (const err of [await fail(500), await fail("network")]) {
      expect(clientUpdateFailureText(err)).toBe(
        "The visit was not recorded. The person's details may already be saved. Please try again.",
      );
    }
  });

  it("shows the server's refusal and says the visit was not recorded", async () => {
    const err = await fail(400, '{"message":"Classification is not valid"}');
    expect(clientUpdateFailureText(err)).toBe("Classification is not valid. The visit was not recorded.");
  });

  it("leaves a duplicate refusal and an ended session to their own messages", async () => {
    const dup = await fail(409, '{"message":"Test Student One is already in","duplicateOf":"c2"}');
    expect(duplicateRefusal(dup)).toBe("Test Student One is already in");
    const expired = new SessionExpiredError("signed out");
    const passed = await sendClientUpdate(async () => { throw expired; }, "c1", {}).catch((e) => e);
    expect(passed).toBe(expired);
    expect(clientUpdateFailureText(passed)).toBeNull();
    expect(clientUpdateFailureText(new Error("500: other step"))).toBeNull();
  });
});

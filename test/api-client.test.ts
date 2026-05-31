import { afterEach, describe, expect, it, vi } from "vitest";
import { ReplicateHttpClient } from "../src/lib/api-client.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ReplicateHttpClient", () => {
  it("retries safe read requests on retryable status codes", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: "busy" }), {
          headers: { "content-type": "application/json", "retry-after": "0" },
          status: 500
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200
      });
    });

    const client = new ReplicateHttpClient({ baseUrl: "https://example.test" });
    await expect(client.request("GET", "/models", { maxRetries: 1 })).resolves.toMatchObject({
      data: { ok: true }
    });
    expect(calls).toBe(2);
  });

  it("does not retry write requests", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "busy" }), {
        headers: { "content-type": "application/json", "retry-after": "0" },
        status: 500
      })
    );
    globalThis.fetch = fetch;

    const client = new ReplicateHttpClient({ baseUrl: "https://example.test" });
    await expect(client.request("POST", "/predictions", { body: {} })).rejects.toMatchObject({
      status: 500
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

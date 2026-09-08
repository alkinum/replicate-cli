import { afterEach, describe, expect, it, vi } from "vitest";
import { ReplicateHttpClient } from "../src/lib/api-client.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ReplicateHttpClient", () => {
  it("rejects cross-origin pagination URLs before sending credentials", async () => {
    const fetch = vi.fn();
    globalThis.fetch = fetch;
    const client = new ReplicateHttpClient({ token: "test-token" });
    await expect(client.request("GET", "https://untrusted.test/models")).rejects.toMatchObject({
      code: "invalid_api_url"
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts absolute pagination URLs on an explicitly configured API origin", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{"results":[]}', { headers: { "content-type": "application/json" } }));
    globalThis.fetch = fetch;
    const client = new ReplicateHttpClient({ baseUrl: "https://proxy.test/v1", token: "test-token" });
    await client.request("GET", "https://proxy.test/v1/models?cursor=next");
    expect(fetch.mock.calls[0]?.[0]).toBe("https://proxy.test/v1/models?cursor=next");
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer test-token");
  });

  it("accepts empty JSON responses from HEAD requests", async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { headers: { "content-type": "application/json" } }));
    await expect(new ReplicateHttpClient().request("HEAD", "/account")).resolves.toMatchObject({ data: null });
  });

  it("preserves HTTP error status for malformed JSON response bodies", async () => {
    globalThis.fetch = vi.fn(async () => new Response("gateway unavailable", {
      status: 502, headers: { "content-type": "application/json" }
    }));
    await expect(new ReplicateHttpClient().request("GET", "/models", { maxRetries: 0 })).rejects.toMatchObject({
      code: "replicate_server_error", status: 502, message: "gateway unavailable"
    });
  });

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

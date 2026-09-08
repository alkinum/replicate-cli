import { afterEach, describe, expect, it, vi } from "vitest";
import { ReplicateHttpClient } from "../src/lib/api-client.js";
import { CliError } from "../src/lib/errors.js";
import { isTerminalStatus, waitForResource } from "../src/lib/predictions.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("prediction utilities", () => {
  it("reports the wait timeout when the deadline timer fires slightly early", async () => {
    vi.useFakeTimers();
    const client = new ReplicateHttpClient();
    vi.spyOn(client, "request").mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 49));
      throw new CliError("network_timeout", "Request timed out", { exitCode: 5 });
    });
    const wait = waitForResource({ client, path: "/predictions/abc", timeout: "50ms", type: "prediction" });
    const assertion = expect(wait).rejects.toMatchObject({ code: "prediction_wait_timeout" });
    await vi.advanceTimersByTimeAsync(49);
    await assertion;
  });

  it("bounds requests and polling sleeps by the remaining wait timeout", async () => {
    vi.useFakeTimers();
    const client = new ReplicateHttpClient();
    const request = vi.spyOn(client, "request").mockResolvedValue({ data: { id: "abc", status: "processing" }, headers: new Headers(), status: 200 });
    const wait = waitForResource({ client, path: "/predictions/abc", pollInterval: "60s", timeout: "100ms", type: "prediction" });
    const assertion = expect(wait).rejects.toMatchObject({ code: "prediction_wait_timeout" });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(request).toHaveBeenCalledExactlyOnceWith("GET", "/predictions/abc", { timeoutMs: 100, maxRetries: 0 });
  });

  it("keeps polling without an overall timeout until success", async () => {
    vi.useFakeTimers();
    const client = new ReplicateHttpClient();
    const request = vi.spyOn(client, "request")
      .mockResolvedValueOnce({ data: { status: "processing" }, headers: new Headers(), status: 200 })
      .mockResolvedValueOnce({ data: { status: "succeeded" }, headers: new Headers(), status: 200 });
    const wait = waitForResource({ client, path: "/predictions/abc", pollInterval: "1s", type: "prediction" });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(wait).resolves.toMatchObject({ status: "succeeded" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("treats aborted resources as terminal", () => {
    expect(isTerminalStatus("aborted")).toBe(true);
  });
});

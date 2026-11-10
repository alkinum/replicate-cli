import { CliError } from "./errors.js";
import { ReplicateHttpClient } from "./api-client.js";
import { parseDurationMs } from "./parse.js";

export type TerminalStatus = "succeeded" | "failed" | "canceled" | "aborted";

export function isTerminalStatus(status: unknown): status is TerminalStatus {
  return status === "succeeded" || status === "failed" || status === "canceled" || status === "aborted";
}

export function throwIfResourceFailed(resource: Record<string, unknown>, type: "prediction" | "training"): void {
  if (isTerminalStatus(resource.status) && resource.status !== "succeeded") {
    throw new CliError(`${type}_${resource.status}`, `${type} ${String(resource.id ?? "")} ${resource.status}: ${String(resource.error ?? "no error message")}`, { exitCode: 4, details: resource });
  }
}

export async function waitForResource(options: {
  client: ReplicateHttpClient;
  path: string;
  pollInterval?: string;
  timeout?: string;
  type: "prediction" | "training";
}): Promise<Record<string, unknown>> {
  const pollMs = parseDurationMs(options.pollInterval ?? "2s") ?? 2000;
  if (pollMs <= 0 || pollMs > 2_147_483_647) {
    throw new CliError("invalid_poll_interval", "--poll-interval must be greater than zero and at most 2147483647ms.");
  }
  const timeoutMs = parseDurationMs(options.timeout);
  const started = Date.now();
  let last: Record<string, unknown> | undefined;

  while (timeoutMs === undefined || Date.now() - started < timeoutMs) {
    const remaining = timeoutMs === undefined ? undefined : timeoutMs - (Date.now() - started);
    if (remaining !== undefined && remaining <= 0) break;
    try {
      last = (await options.client.request("GET", options.path, remaining === undefined ? {} : {
        timeoutMs: Math.min(options.client.timeoutMs, remaining),
        maxRetries: 0
      })).data as Record<string, unknown>;
    } catch (error) {
      if (
        remaining !== undefined && remaining <= options.client.timeoutMs &&
        error instanceof CliError && error.code === "network_timeout"
      ) break;
      throw error;
    }
    if (isTerminalStatus(last.status)) {
      throwIfResourceFailed(last, options.type);
      return last;
    }
    const sleepMs = timeoutMs === undefined ? pollMs : Math.min(pollMs, timeoutMs - (Date.now() - started));
    if (sleepMs > 0) await sleep(sleepMs);
  }

  throw new CliError(
    `${options.type}_wait_timeout`,
    `Timed out waiting for ${options.type}.`,
    { exitCode: 5, details: last }
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

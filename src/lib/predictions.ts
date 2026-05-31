import { CliError } from "./errors.js";
import { ReplicateHttpClient } from "./api-client.js";
import { parseDurationMs } from "./parse.js";

export type TerminalStatus = "succeeded" | "failed" | "canceled" | "aborted";

export function isTerminalStatus(status: unknown): status is TerminalStatus {
  return status === "succeeded" || status === "failed" || status === "canceled" || status === "aborted";
}

export async function waitForResource(options: {
  client: ReplicateHttpClient;
  path: string;
  pollInterval?: string;
  timeout?: string;
  type: "prediction" | "training";
}): Promise<Record<string, unknown>> {
  const pollMs = parseDurationMs(options.pollInterval ?? "2s") ?? 2000;
  const timeoutMs = parseDurationMs(options.timeout ?? "30m") ?? 30 * 60 * 1000;
  const started = Date.now();
  let last: Record<string, unknown> | undefined;

  while (Date.now() - started <= timeoutMs) {
    last = (await options.client.request("GET", options.path)).data as Record<string, unknown>;
    if (isTerminalStatus(last.status)) {
      if (last.status !== "succeeded") {
        throw new CliError(
          `${options.type}_${last.status}`,
          `${options.type} ${String(last.id ?? "")} ${last.status}: ${String(last.error ?? "no error message")}`,
          { exitCode: 4, details: last }
        );
      }
      return last;
    }
    await sleep(pollMs);
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

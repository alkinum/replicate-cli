import { CliError, errorFromUnknown, redactDeep } from "./errors.js";

export type OutputMode = "json" | "human";

export interface SuccessEnvelope {
  ok: true;
  type: string;
  data: unknown;
  artifacts?: unknown[];
  meta?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    status?: number;
    retryAfterSeconds?: number;
    details?: unknown;
  };
  meta?: Record<string, unknown>;
}

export function successEnvelope(
  type: string,
  data: unknown,
  options: { artifacts?: unknown[]; meta?: Record<string, unknown> } = {}
): SuccessEnvelope {
  return {
    ok: true,
    type,
    data: redactDeep(data),
    artifacts: options.artifacts,
    meta: options.meta
  };
}

export function errorEnvelope(
  error: unknown,
  meta?: Record<string, unknown>
): ErrorEnvelope {
  const cliError = errorFromUnknown(error);
  return {
    ok: false,
    error: {
      code: cliError.code,
      message: cliError.message,
      status: cliError.status,
      retryAfterSeconds: cliError.retryAfterSeconds,
      details: cliError.details ? redactDeep(cliError.details) : undefined
    },
    meta
  };
}

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function writeHuman(value: unknown): void {
  if (typeof value === "string") {
    process.stdout.write(`${value}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(redactDeep(value), null, 2)}\n`);
}

export async function runWithOutput(
  options: {
    json?: boolean;
    type: string;
    meta?: Record<string, unknown>;
  },
  handler: () => Promise<unknown>
): Promise<void> {
  try {
    const result = await handler();
    if (options.json) {
      const envelope =
        result &&
        typeof result === "object" &&
        "data" in result &&
        ("type" in result || "artifacts" in result)
          ? successEnvelope(
              String((result as { type?: unknown }).type ?? options.type),
              (result as { data: unknown }).data,
              {
                artifacts: (result as { artifacts?: unknown[] }).artifacts,
                meta: {
                  ...options.meta,
                  ...((result as { meta?: Record<string, unknown> }).meta ?? {})
                }
              }
            )
          : successEnvelope(options.type, result, { meta: options.meta });
      writeJson(envelope);
    } else {
      writeHuman(result);
    }
  } catch (error) {
    const cliError = errorFromUnknown(error);
    if (options.json) {
      writeJson(errorEnvelope(cliError, options.meta));
    } else {
      process.stderr.write(`Error: ${cliError.message}\n`);
    }
    process.exitCode = cliError.exitCode;
  }
}

export function asResult(
  type: string,
  data: unknown,
  options: { artifacts?: unknown[]; meta?: Record<string, unknown> } = {}
): { type: string; data: unknown; artifacts?: unknown[]; meta?: Record<string, unknown> } {
  return { type, data, artifacts: options.artifacts, meta: options.meta };
}

export function throwIfMissing(value: unknown, name: string): asserts value {
  if (value === undefined || value === null || value === "") {
    throw new CliError("missing_required_option", `${name} is required.`);
  }
}

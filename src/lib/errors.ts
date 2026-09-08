export type ErrorDetails = Record<string, unknown>;

export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly status?: number;
  readonly details?: ErrorDetails;
  readonly retryAfterSeconds?: number;

  constructor(
    code: string,
    message: string,
    options: {
      exitCode?: number;
      status?: number;
      details?: ErrorDetails;
      retryAfterSeconds?: number;
      cause?: unknown;
    } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "CliError";
    this.code = code;
    this.exitCode = options.exitCode ?? 1;
    this.status = options.status;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export class ApiError extends CliError {
  constructor(
    message: string,
    options: {
      status: number;
      data?: unknown;
      retryAfterSeconds?: number;
      cause?: unknown;
    }
  ) {
    const code =
      options.status === 401 || options.status === 403
        ? "replicate_auth_failed"
        : options.status === 404
          ? "replicate_not_found"
          : options.status === 422
            ? "replicate_validation_failed"
            : options.status === 429
              ? "replicate_rate_limited"
              : options.status >= 500
                ? "replicate_server_error"
                : "replicate_api_error";

    super(code, message, {
      exitCode: options.status === 401 || options.status === 403 ? 2 : 3,
      status: options.status,
      details: options.data === undefined ? undefined : { data: options.data },
      retryAfterSeconds: options.retryAfterSeconds,
      cause: options.cause
    });
    this.name = "ApiError";
  }
}

export function errorFromUnknown(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  if (error instanceof Error) {
    return new CliError("unexpected_error", error.message, {
      exitCode: 1,
      cause: error
    });
  }

  return new CliError("unexpected_error", String(error), { exitCode: 1 });
}

export function assertConfirm(
  confirmed: boolean | undefined,
  action: string,
  dryRun?: boolean
): void {
  if (dryRun || confirmed) return;
  throw new CliError(
    "confirmation_required",
    `${action} is a live write. Re-run with --confirm or inspect it first with --dry-run.`,
    { exitCode: 1 }
  );
}

export function redactSecret(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function redactDeep(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/r8_[A-Za-z0-9]+/g, redactSecret);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (/token|authorization|secret|api[_-]?key/i.test(key)) {
        output[key] = redactSensitiveValue(child);
      } else {
        output[key] = redactDeep(child);
      }
    }
    return output;
  }

  return value;
}

function redactSensitiveValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof value === "string") return redactSecret(value);
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (isSchemaDescriptor(value)) return redactDeep(value);
  return "***";
}

function isSchemaDescriptor(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).some((key) =>
    [
      "$ref",
      "allOf",
      "anyOf",
      "default",
      "description",
      "enum",
      "format",
      "items",
      "nullable",
      "oneOf",
      "properties",
      "title",
      "type",
      "x-order"
    ].includes(key)
  );
}

import { Command } from "commander";
import packageJson from "../../package.json" with { type: "json" };
import { requireAuth, resolveAuth } from "../lib/auth.js";
import { ReplicateHttpClient } from "../lib/api-client.js";
import { CliError } from "../lib/errors.js";
import { applyInputFiles, downloadArtifacts, normalizeFileMode, previewFileInput } from "../lib/files.js";
import { runWithOutput, throwIfMissing } from "../lib/output.js";
import {
  mergeInput,
  parseDurationMs,
  parseLimit,
  parseModelRef,
  parseOwnerName,
  parseWaitSeconds,
  readJsonFile,
  setDeep
} from "../lib/parse.js";
import { validateInputAgainstOpenApiSchema } from "../lib/schema.js";

export const VERSION = packageJson.version;

export type AnyRecord = Record<string, any>;

export interface GlobalOptions {
  json?: boolean;
  token?: string;
  profile?: string;
  config?: string;
  baseUrl?: string;
  timeout?: string;
  verbose?: boolean;
}

export interface ClientBundle {
  client: ReplicateHttpClient;
  auth: Awaited<ReturnType<typeof resolveAuth>>;
  timeoutMs: number | undefined;
}

export function globals(command: Command): GlobalOptions {
  return command.optsWithGlobals() as GlobalOptions;
}

export function timeoutMs(command: Command): number | undefined {
  return parseDurationMs(globals(command).timeout);
}

export function waitTimeout(command: Command): string | undefined {
  // Commander consumes --timeout as a global option even after a subcommand.
  // Only an explicit value should impose an overall wait deadline.
  return command.getOptionValueSourceWithGlobals("timeout") === "cli"
    ? globals(command).timeout
    : undefined;
}

export async function clientFor(command: Command, authRequired = true): Promise<ClientBundle> {
  const opts = globals(command);
  const auth = authRequired
    ? await requireAuth(opts)
    : await resolveAuth(opts);
  const parsedTimeout = timeoutMs(command);
  return {
    client: new ReplicateHttpClient({
      baseUrl: opts.baseUrl,
      token: auth.token,
      timeoutMs: parsedTimeout
    }),
    auth,
    timeoutMs: parsedTimeout
  };
}

export function metaFor(bundle?: ClientBundle): Record<string, unknown> {
  return {
    cliVersion: VERSION,
    authSource: bundle?.auth.source,
    profile: bundle?.auth.profile,
    apiVersion: "v1"
  };
}

export function action(
  type: string,
  handler: (command: Command, ...args: any[]) => Promise<unknown>
): (...args: any[]) => Promise<void> {
  return async (...args: any[]) => {
    const command = args[args.length - 1] as Command;
    const opts = globals(command);
    await runWithOutput(
      {
        json: opts.json,
        type,
        meta: { cliVersion: VERSION }
      },
      () => handler(command, ...args.slice(0, -1))
    );
  };
}

export function addInputOptions(command: Command): Command {
  return command
    .option("-i, --input <key=value>", "model input key/value; repeatable", collect, [])
    .option("--set <key=value>", "alias for --input; repeatable", collect, [])
    .option("--input-json <path>", "JSON file containing model input object")
    .option("--input-file <key=path>", "local or remote file input; repeatable", collect, [])
    .option("--file-mode <mode>", "file handling: auto, data-url, upload, or url", "auto")
    .option("--metadata-json <path>", "metadata JSON for uploaded files");
}

export function addWriteSafety(command: Command): Command {
  return command.option("--dry-run", "preview request without writing").option("--confirm", "confirm live write");
}

export function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

export async function buildInput(
  opts: AnyRecord,
  client: ReplicateHttpClient,
  dryRun = false
): Promise<Record<string, unknown>> {
  const input = await mergeInput({
    input: opts.input,
    set: opts.set,
    inputJson: opts.inputJson
  });
  const fileMode = normalizeFileMode(opts.fileMode);
  if (dryRun && Array.isArray(opts.inputFile)) {
    const preview = { ...input };
    for (const item of opts.inputFile as string[]) {
      const index = item.indexOf("=");
      if (index <= 0) throw new CliError("invalid_input_file", `Expected key=path, got: ${item}`);
      setDeep(preview, item.slice(0, index), previewFileInput(item.slice(index + 1), fileMode));
    }
    return preview;
  }
  const metadata = opts.metadataJson
    ? ((await readJsonFile(opts.metadataJson)) as Record<string, unknown>)
    : undefined;
  return applyInputFiles(client, input, opts.inputFile, {
    fileMode,
    metadata
  });
}

export async function bodyFromOptions(
  opts: AnyRecord,
  fallback: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  if (opts.bodyJson) {
    const body = await readJsonFile(opts.bodyJson);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new CliError("invalid_body_json", "--body-json must contain a JSON object.");
    }
    return body as Record<string, unknown>;
  }
  return Object.fromEntries(Object.entries(fallback).filter(([, value]) => value !== undefined && value !== ""));
}

export function requestPreview(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): unknown {
  return { method, path, headers, body };
}

export async function requestPaginated(
  client: ReplicateHttpClient,
  path: string,
  options: {
    limit?: string;
    query?: Record<string, string | number | boolean | undefined>;
  } = {}
): Promise<Record<string, any>> {
  const limit = parseLimit(options.limit);
  const first = (await client.request("GET", path, { query: options.query })).data as Record<string, any>;
  return collectPaginatedResults(client, first, limit);
}

export async function collectPaginatedResults(
  client: ReplicateHttpClient,
  first: Record<string, any>,
  limit?: number
): Promise<Record<string, any>> {
  if (!Array.isArray(first.results) || limit === undefined) return first;
  if (limit <= first.results.length) return { ...first, results: first.results.slice(0, limit) };
  const results = [...first.results];
  const visited = new Set<string>();
  let next = typeof first.next === "string" ? first.next : undefined;
  while (next && results.length < limit) {
    if (visited.has(next)) {
      throw new CliError("pagination_cycle", "The API returned a repeated pagination URL.");
    }
    visited.add(next);
    const page = (await client.request("GET", next)).data as Record<string, any>;
    if (!Array.isArray(page.results)) break;
    results.push(...page.results);
    next = typeof page.next === "string" ? page.next : undefined;
  }

  return {
    ...first,
    next,
    results: results.slice(0, limit)
  };
}

export async function createPrediction(
  command: Command,
  options: {
    model?: string;
    version?: string;
    deployment?: string;
    input: Record<string, unknown>;
    sync?: boolean;
    wait?: string | number;
    deadline?: string;
    webhook?: string;
    webhookEvents?: string;
    dryRun?: boolean;
  }
): Promise<{ data: unknown; bundle: ClientBundle; path: string; body: Record<string, unknown> }> {
  const bundle = await clientFor(command, !options.dryRun);
  const headers: Record<string, string> = {};
  if (options.sync) headers.Prefer = `wait=${parseWaitSeconds(options.wait, 60)}`;
  if (options.deadline) {
    const deadlineMs = parseDurationMs(options.deadline);
    if (deadlineMs !== undefined && deadlineMs < 5000) {
      throw new CliError("invalid_deadline", "--deadline must be at least 5 seconds.");
    }
    headers["Cancel-After"] = options.deadline;
  }

  const body: Record<string, unknown> = {
    input: options.input
  };
  if (options.webhook) body.webhook = options.webhook;
  if (options.webhookEvents) body.webhook_events_filter = options.webhookEvents.split(",").map((item) => item.trim());

  let path: string;
  if (options.deployment) {
    const deployment = parseOwnerName(options.deployment, "deployment");
    path = `/deployments/${deployment.owner}/${deployment.name}/predictions`;
  } else {
    const modelRef = options.model ? parseModelRef(options.model) : undefined;
    const versionRef = options.version?.includes("/") ? parseModelRef(options.version) : undefined;
    const ref = modelRef ?? versionRef;
    const version = options.version ?? ref?.version;
    if (version) {
      path = "/predictions";
      body.version = version.includes("/") || !ref ? version : `${ref.owner}/${ref.name}:${version}`;
    } else {
      throwIfMissing(ref, "model or --version");
      path = `/models/${ref.owner}/${ref.name}/predictions`;
    }
  }

  if (options.dryRun) {
    return { data: requestPreview("POST", path, body, headers), bundle, path, body };
  }

  const response = await bundle.client.request("POST", path, { body, headers });
  return { data: response.data, bundle, path, body };
}

export async function validatePredictionInput(
  command: Command,
  options: {
    deployment?: string;
    input: Record<string, unknown>;
    model?: string;
    validateSchema?: boolean;
    version?: string;
  }
): Promise<void> {
  if (!options.validateSchema) return;
  if (options.deployment) {
    throw new CliError("schema_validation_unavailable", "Schema validation is not available for deployment predictions.");
  }

  const bundle = await clientFor(command);
  const modelRef = options.model ? parseModelRef(options.model) : undefined;
  const versionRef = options.version?.includes("/") ? parseModelRef(options.version) : undefined;
  const ref = modelRef ?? versionRef;
  if (!ref) {
    throw new CliError(
      "schema_validation_unavailable",
      "Schema validation for a bare version ID requires --model owner/name or --version owner/model:version."
    );
  }
  const version = options.version ?? ref.version;

  const versionId = version?.includes("/") ? parseModelRef(version).version : version;
  const data = versionId
    ? ((await bundle.client.request("GET", `/models/${ref.owner}/${ref.name}/versions/${versionId}`)).data as Record<string, any>)
    : ((await bundle.client.request("GET", `/models/${ref.owner}/${ref.name}`)).data as Record<string, any>);
  const openapi = version ? data.openapi_schema : data.latest_version?.openapi_schema;
  if (!openapi) {
    throw new CliError("schema_missing", "Model schema is not available.", { details: data });
  }
  const issues = validateInputAgainstOpenApiSchema(openapi, options.input);
  if (issues.length > 0) {
    throw new CliError("schema_validation_failed", "Input does not match the model schema.", {
      details: { issues },
      exitCode: 1
    });
  }
}

export async function maybeDownloadPredictionOutput(
  data: unknown,
  options: { output?: string; bundle: ClientBundle; manifest?: Record<string, unknown> }
): Promise<{ data: unknown; artifacts?: unknown[] }> {
  if (!options.output || !data || typeof data !== "object") {
    return { data };
  }
  const prediction = data as Record<string, unknown>;
  if (prediction.data_removed) {
    throw new CliError(
      "prediction_output_unavailable",
      "Prediction output is not available. Replicate may have removed the output data; download outputs soon after completion.",
      { exitCode: 4, details: prediction }
    );
  }
  if (prediction.status !== "succeeded") {
    return { data };
  }
  if (prediction.output === undefined || prediction.output === null) {
    throw new CliError("prediction_output_unavailable", "Prediction succeeded but did not include output data.", {
      exitCode: 4,
      details: prediction
    });
  }
  const artifacts = await downloadArtifacts({
    output: prediction.output,
    predictionId: String(prediction.id ?? "prediction"),
    outputDir: options.output,
    token: options.bundle.auth.token,
    timeoutMs: options.bundle.timeoutMs,
    manifest: {
      model: prediction.model,
      version: prediction.version,
      input: prediction.input,
      type: options.manifest?.type ?? "prediction"
    }
  });
  return { data, artifacts };
}

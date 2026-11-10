import type { Command } from "commander";
import { z } from "zod";
import { CliError } from "./errors.js";
import {
  parseDurationMs,
  parseLimit,
  parseModelRef,
  parseOwnerName,
  parseWaitSeconds,
  validatePathSegment,
} from "./parse.js";

export function webhookOptions(
  webhook?: string,
  events?: string,
): string[] | undefined {
  if (webhook !== undefined) {
    let url: URL;
    try {
      url = new URL(webhook);
    } catch {
      throw new CliError("invalid_webhook", "--webhook must be an HTTPS URL.");
    }
    if (url.protocol !== "https:" || url.username || url.password)
      throw new CliError(
        "invalid_webhook",
        "--webhook must be an HTTPS URL without embedded credentials.",
      );
  }
  if (events === undefined) return undefined;
  if (!webhook)
    throw new CliError(
      "invalid_webhook_events",
      "--webhook-events requires --webhook.",
    );
  const values = events.split(",").map((value) => value.trim());
  if (
    values.some(
      (value) => !["start", "output", "logs", "completed"].includes(value),
    )
  ) {
    throw new CliError(
      "invalid_webhook_events",
      "--webhook-events accepts start, output, logs, and completed.",
    );
  }
  return [...new Set(values)];
}

export function validatePredictionTarget(options: {
  model?: string;
  version?: string;
  deployment?: string;
}): void {
  if (options.deployment) {
    if (options.model || options.version)
      throw new CliError(
        "conflicting_target",
        "Use --deployment on its own, or specify a model/version.",
      );
    parseOwnerName(options.deployment, "deployment");
    return;
  }
  if (!options.model && !options.version)
    throw new CliError(
      "missing_required_option",
      "Provide a model, --version, or --deployment.",
    );
  const model = options.model ? parseModelRef(options.model) : undefined;
  if (options.version) {
    if (options.version.includes("/")) {
      const version = parseModelRef(options.version);
      if (
        model &&
        (model.owner !== version.owner || model.name !== version.name)
      )
        throw new CliError(
          "conflicting_target",
          "The model and --version must refer to the same model.",
        );
      if (model?.version && version.version !== model.version)
        throw new CliError(
          "conflicting_target",
          "The model ref and --version specify different versions.",
        );
    } else {
      validatePathSegment(options.version, "version");
      if (model?.version && model.version !== options.version)
        throw new CliError(
          "conflicting_target",
          "The model ref and --version specify different versions.",
        );
    }
  }
}

export function validateCommand(command: Command): void {
  const name = command.name();
  const group = command.parent?.name();
  const opts = command.opts();
  const first = command.args[0];
  if (opts.limit !== undefined)
    parseLimit(opts.limit, name === "search" ? { max: 50 } : {});
  if (name === "search" || (group === "models" && name === "query")) {
    if (!first?.trim())
      throw new CliError("invalid_query", "Search query cannot be empty.");
  }
  if (
    ["models", "versions", "deployments"].includes(group ?? "") &&
    first &&
    name !== "query"
  ) {
    if (group === "versions" && name !== "list") {
      const ref = parseModelRef(first);
      if (name !== "list" && !ref.version)
        throw new CliError(
          "missing_required_option",
          "Specify a version as owner/model:version.",
        );
    } else
      parseOwnerName(first, group === "deployments" ? "deployment" : "model");
  }
  if (name === "schema" && first) parseOwnerName(first, "model");
  if (name === "schema" && opts.version)
    validatePathSegment(opts.version, "version");
  if (
    ["predictions", "trainings", "outputs", "files", "collections"].includes(
      group ?? "",
    ) &&
    first &&
    !["create", "upload", "download"].includes(name)
  )
    validatePathSegment(first, `${group} ID`);
  if (group === "outputs" && first) validatePathSegment(first, "prediction ID");
  if (
    opts.sortBy !== undefined &&
    !["model_created_at", "latest_version_created_at"].includes(opts.sortBy)
  )
    throw new CliError(
      "invalid_sort",
      "--sort-by accepts model_created_at or latest_version_created_at.",
    );
  if (
    opts.sortDirection !== undefined &&
    !["asc", "desc"].includes(opts.sortDirection)
  )
    throw new CliError("invalid_sort", "--sort-direction accepts asc or desc.");
  if (
    opts.visibility !== undefined &&
    !["public", "private"].includes(opts.visibility)
  )
    throw new CliError(
      "invalid_visibility",
      "--visibility must be public or private.",
    );
  if (group === "predictions" && name === "list") {
    if (opts.source !== undefined && opts.source !== "web")
      throw new CliError(
        "invalid_source",
        "--source currently accepts only web; omit it to include all sources.",
      );
    for (const key of ["createdAfter", "createdBefore"]) {
      if (
        opts[key] !== undefined &&
        !z.iso.datetime({ offset: true, local: true }).safeParse(opts[key])
          .success
      )
        throw new CliError(
          "invalid_date",
          `--${key === "createdAfter" ? "created-after" : "created-before"} must be a valid ISO date-time.`,
        );
    }
    if (
      opts.createdAfter &&
      opts.createdBefore &&
      Date.parse(opts.createdAfter) >= Date.parse(opts.createdBefore)
    )
      throw new CliError(
        "invalid_date_range",
        "--created-after must be earlier than --created-before.",
      );
  }
  if (name === "wait" && ["predictions", "trainings"].includes(group ?? "")) {
    const interval = parseDurationMs(opts.pollInterval) ?? 0;
    if (interval <= 0 || interval > 2_147_483_647)
      throw new CliError(
        "invalid_poll_interval",
        "--poll-interval must be greater than zero and at most 2147483647ms.",
      );
  }
  const predictionCommand =
    name === "run" ||
    (group === "predictions" && name === "create") ||
    (["image", "video", "audio"].includes(group ?? "") &&
      ["generate", "edit"].includes(name));
  if (predictionCommand) {
    validatePredictionTarget({
      model: name === "run" ? first : opts.model,
      version: opts.version,
      deployment: opts.deployment,
    });
    if (
      opts.async &&
      opts.sync &&
      command.getOptionValueSource("sync") === "cli"
    )
      throw new CliError(
        "conflicting_options",
        "Choose either --sync or --async.",
      );
    if (opts.wait !== undefined) parseWaitSeconds(opts.wait);
    if (opts.deadline && (parseDurationMs(opts.deadline) ?? 0) < 5000)
      throw new CliError(
        "invalid_deadline",
        "--deadline must be at least 5 seconds.",
      );
    webhookOptions(opts.webhook, opts.webhookEvents);
    if (opts.validateSchema && opts.deployment)
      throw new CliError(
        "schema_validation_unavailable",
        "Schema validation is not available for deployment predictions.",
      );
    if (
      opts.validateSchema &&
      !(name === "run" ? first : opts.model) &&
      opts.version &&
      !opts.version.includes("/")
    )
      throw new CliError(
        "schema_validation_unavailable",
        "Schema validation for a bare version ID requires --model owner/name or --version owner/model:version.",
      );
  }
  if (group === "trainings" && name === "create") {
    const ref = parseModelRef(first!);
    if (!ref.version)
      throw new CliError(
        "missing_required_option",
        "Specify the training model as owner/model:version.",
      );
    parseOwnerName(opts.destination, "destination model");
    webhookOptions(opts.webhook, opts.webhookEvents);
  }
}

export function requireBodyFields(
  body: Record<string, unknown>,
  fields: string[],
): void {
  for (const field of fields) {
    if (
      body[field] === undefined ||
      body[field] === null ||
      (typeof body[field] === "string" && !body[field].trim())
    )
      throw new CliError(
        "missing_required_option",
        `${field} is required. Supply --${field.replaceAll("_", "-")} or include it in --body-json.`,
      );
  }
}

export function validateBodyStrings(
  body: Record<string, unknown>,
  fields: string[],
): void {
  for (const field of fields) {
    if (
      body[field] !== undefined &&
      (typeof body[field] !== "string" || !(body[field] as string).trim())
    )
      throw new CliError(
        "invalid_body",
        `${field} must be a non-empty string.`,
      );
  }
}

export function validateScaling(body: Record<string, unknown>): void {
  for (const field of ["min_instances", "max_instances"]) {
    const value = body[field];
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    )
      throw new CliError(
        "invalid_scaling",
        `${field} must be a non-negative integer.`,
      );
  }
  if (
    typeof body.min_instances === "number" &&
    typeof body.max_instances === "number" &&
    body.min_instances > body.max_instances
  )
    throw new CliError(
      "invalid_scaling",
      "min_instances cannot exceed max_instances.",
    );
}

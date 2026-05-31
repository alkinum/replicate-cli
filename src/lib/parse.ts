import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CliError } from "./errors.js";

export interface ModelRef {
  owner: string;
  name: string;
  version?: string;
}

export function parseJsonLiteral(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (/^(true|false|null)$/i.test(trimmed)) {
    return JSON.parse(trimmed.toLowerCase());
  }
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return JSON.parse(trimmed);
  }
  return value;
}

export function parseKeyValue(input: string): [string, unknown] {
  const index = input.indexOf("=");
  if (index <= 0) {
    throw new CliError("invalid_key_value", `Expected key=value, got: ${input}`);
  }
  const key = input.slice(0, index).trim();
  const value = input.slice(index + 1);
  if (!key) throw new CliError("invalid_key_value", `Missing key in: ${input}`);
  return [key, parseJsonLiteral(value)];
}

export function setDeep(target: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split(".").filter(Boolean);
  if (parts.length === 0) {
    throw new CliError("invalid_key", "Input key cannot be empty.");
  }
  let cursor: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
}

export function parseKeyValues(values?: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const value of values ?? []) {
    const [key, parsed] = parseKeyValue(value);
    setDeep(output, key, parsed);
  }
  return output;
}

export async function readJsonFile<T = unknown>(path: string): Promise<T> {
  const raw = await readFile(resolve(path), "utf8");
  return JSON.parse(raw) as T;
}

export async function mergeInput(options: {
  input?: string[];
  set?: string[];
  inputJson?: string;
}): Promise<Record<string, unknown>> {
  const base = options.inputJson
    ? ((await readJsonFile(options.inputJson)) as Record<string, unknown>)
    : {};
  if (!base || typeof base !== "object" || Array.isArray(base)) {
    throw new CliError("invalid_input_json", "--input-json must contain a JSON object.");
  }

  return {
    ...base,
    ...parseKeyValues(options.input),
    ...parseKeyValues(options.set)
  };
}

export function parseModelRef(value: string): ModelRef {
  const [modelPart, version] = value.split(":", 2);
  const parts = modelPart?.split("/") ?? [];
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new CliError("invalid_model_ref", `Expected owner/model or owner/model:version, got: ${value}`);
  }
  return { owner: parts[0], name: parts[1], version };
}

export function parseOwnerName(value: string, label = "resource"): { owner: string; name: string } {
  const parts = value.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new CliError("invalid_resource_ref", `Expected owner/name for ${label}, got: ${value}`);
  }
  return { owner: parts[0], name: parts[1] };
}

export function parseDurationMs(input: string | number | undefined): number | undefined {
  if (input === undefined) return undefined;
  if (typeof input === "number") return input;
  const value = input.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const matches = [...value.matchAll(/(\d+)(ms|h|m|s)/g)];
  if (matches.length === 0) {
    throw new CliError("invalid_duration", `Invalid duration: ${input}`);
  }
  let total = 0;
  for (const match of matches) {
    const amount = Number(match[1]);
    const unit = match[2];
    total +=
      unit === "h"
        ? amount * 60 * 60 * 1000
        : unit === "m"
          ? amount * 60 * 1000
          : unit === "s"
            ? amount * 1000
            : amount;
  }
  return total;
}

export function parseWaitSeconds(value: string | number | undefined, fallback = 60): number {
  const raw = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(raw) || raw < 1 || raw > 60) {
    throw new CliError("invalid_wait", "--wait must be an integer from 1 to 60.");
  }
  return raw;
}

export function parseLimit(
  value: string | number | undefined,
  options: { min?: number; max?: number } = {}
): number | undefined {
  if (value === undefined) return undefined;
  const min = options.min ?? 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || (options.max !== undefined && parsed > options.max)) {
    const range = options.max === undefined ? `at least ${min}` : `from ${min} to ${options.max}`;
    throw new CliError("invalid_limit", `--limit must be an integer ${range}.`);
  }
  return parsed;
}

export function toQuery(values?: string[]): Record<string, string> {
  const output: Record<string, string> = {};
  for (const value of values ?? []) {
    const [key, parsed] = parseKeyValue(value);
    output[key] = String(parsed);
  }
  return output;
}

export function absolutePath(path: string): string {
  return resolve(path);
}

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { CliError } from "./errors.js";
import { ReplicateHttpClient } from "./api-client.js";

export interface Artifact {
  path: string;
  bytes: number;
  sourceUrl: string;
  outputPath: string;
  contentType?: string;
}

export type FileMode = "auto" | "data-url" | "upload" | "url";

const DATA_URL_LIMIT_BYTES = 256 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  ".apng": "image/apng",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".zip": "application/zip"
};

export function contentTypeForPath(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export async function fileToDataUrl(path: string): Promise<string> {
  const absolute = resolve(path);
  const bytes = await readFile(absolute);
  return `data:${contentTypeForPath(absolute)};base64,${bytes.toString("base64")}`;
}

export async function uploadFile(
  client: ReplicateHttpClient,
  path: string,
  options: { metadata?: Record<string, unknown> } = {}
): Promise<unknown> {
  const absolute = resolve(path);
  const bytes = await readFile(absolute);
  const form = new FormData();
  form.set("content", new Blob([bytes], { type: contentTypeForPath(absolute) }), basename(absolute));
  form.set("filename", basename(absolute));
  form.set("type", contentTypeForPath(absolute));
  if (options.metadata) {
    form.set("metadata", JSON.stringify(options.metadata));
  }
  return (await client.request("POST", "/files", { formData: form })).data;
}

export async function fileInputValue(
  client: ReplicateHttpClient,
  path: string,
  mode: FileMode,
  options: { metadata?: Record<string, unknown> } = {}
): Promise<unknown> {
  if (/^https?:\/\//.test(path)) return path;
  const absolute = resolve(path);
  if (mode === "url") {
    throw new CliError("invalid_file_mode", `Local path cannot be used with --file-mode url: ${path}`);
  }
  const size = (await stat(absolute)).size;
  if (mode === "data-url" || (mode === "auto" && size <= DATA_URL_LIMIT_BYTES)) {
    return fileToDataUrl(absolute);
  }
  const response = (await uploadFile(client, absolute, options)) as Record<string, unknown>;
  const urls = response.urls as Record<string, unknown> | undefined;
  return urls?.get ?? response.url ?? response.id;
}

export async function applyInputFiles(
  client: ReplicateHttpClient,
  input: Record<string, unknown>,
  inputFiles?: string[],
  options: {
    fileMode?: FileMode;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<Record<string, unknown>> {
  const next = { ...input };
  for (const item of inputFiles ?? []) {
    const index = item.indexOf("=");
    if (index <= 0) throw new CliError("invalid_input_file", `Expected key=path, got: ${item}`);
    const key = item.slice(0, index);
    const path = item.slice(index + 1);
    next[key] = await fileInputValue(client, path, options.fileMode ?? "auto", {
      metadata: options.metadata
    });
  }
  return next;
}

export function normalizeFileMode(value: unknown): FileMode {
  if (value === undefined || value === "") return "auto";
  if (value === "auto" || value === "data-url" || value === "upload" || value === "url") {
    return value;
  }
  throw new CliError("invalid_file_mode", `Invalid --file-mode: ${String(value)}. Expected auto, data-url, upload, or url.`);
}

export interface DiscoveredUrl {
  path: string;
  url: string;
}

export function discoverUrls(value: unknown, currentPath = "output"): DiscoveredUrl[] {
  if (typeof value === "string" && /^https?:\/\//.test(value)) {
    return [{ path: currentPath, url: value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => discoverUrls(item, `${currentPath}.${index}`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => discoverUrls(child, `${currentPath}.${key}`));
  }
  return [];
}

export async function downloadArtifacts(options: {
  output: unknown;
  predictionId: string;
  outputDir: string;
  token?: string;
  timeoutMs?: number;
  manifest?: Record<string, unknown>;
}): Promise<Artifact[]> {
  const urls = discoverUrls(options.output);
  const dir = resolve(options.outputDir);
  if (urls.length === 0) {
    throw new CliError("artifact_urls_missing", "No downloadable URLs were found in the output.", {
      exitCode: 4,
      details: { output: options.output }
    });
  }
  await mkdir(dir, { recursive: true });
  const artifacts: Artifact[] = [];
  for (let index = 0; index < urls.length; index += 1) {
    const item = urls[index]!;
    const response = await fetch(item.url, {
      headers: options.token ? { Authorization: `Bearer ${options.token}` } : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? 120_000)
    });
    if (!response.ok) {
      throw new CliError(
        "artifact_download_failed",
        `Failed to download ${item.url}: HTTP ${response.status}`,
        { exitCode: 5, status: response.status }
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    const contentType = response.headers.get("content-type") ?? undefined;
    const filename = `${options.predictionId}-${sanitizePath(item.path)}-${index}${extensionForUrl(item.url, contentType)}`;
    const filePath = join(dir, filename);
    await writeFile(filePath, bytes);
    artifacts.push({
      path: filePath,
      bytes: bytes.byteLength,
      sourceUrl: item.url,
      outputPath: item.path,
      contentType
    });
  }
  await writeFile(
    join(dir, "manifest.json"),
    `${JSON.stringify(
      {
        predictionId: options.predictionId,
        output: options.output,
        artifacts,
        createdAt: new Date().toISOString(),
        ...(options.manifest ?? {})
      },
      null,
      2
    )}\n`
  );
  return artifacts;
}

function sanitizePath(path: string): string {
  return path.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "output";
}

function extensionForUrl(url: string, contentType?: string): string {
  const pathname = new URL(url).pathname;
  const fromPath = extname(pathname);
  if (fromPath && fromPath.length <= 8) return fromPath;
  if (contentType?.includes("png")) return ".png";
  if (contentType?.includes("jpeg")) return ".jpg";
  if (contentType?.includes("webp")) return ".webp";
  if (contentType?.includes("gif")) return ".gif";
  if (contentType?.includes("mp4")) return ".mp4";
  if (contentType?.includes("mpeg")) return ".mp3";
  if (contentType?.includes("wav")) return ".wav";
  if (contentType?.includes("json")) return ".json";
  return ".bin";
}

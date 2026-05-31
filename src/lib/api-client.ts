import { ApiError, CliError } from "./errors.js";

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  formData?: FormData;
  timeoutMs?: number;
  rawBody?: BodyInit;
}

export interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  headers: Headers;
}

export class ReplicateHttpClient {
  readonly baseUrl: string;
  readonly token?: string;
  readonly timeoutMs: number;

  constructor(options: { baseUrl?: string; token?: string; timeoutMs?: number } = {}) {
    this.baseUrl = (options.baseUrl ?? "https://api.replicate.com/v1").replace(/\/$/, "");
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path, options.query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);

    const headers = new Headers(options.headers);
    if (this.token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }

    let body: BodyInit | undefined;
    if (options.formData) {
      body = options.formData;
    } else if (options.rawBody) {
      body = options.rawBody;
    } else if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url, {
        method: method.toUpperCase(),
        headers,
        body,
        signal: controller.signal
      });
      const data = await parseResponseBody(response);
      if (!response.ok) {
        throw new ApiError(apiMessage(data, response.status), {
          status: response.status,
          data,
          retryAfterSeconds: retryAfterSeconds(response.headers)
        });
      }
      return { data: data as T, status: response.status, headers: response.headers };
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new CliError("network_timeout", `Request timed out: ${method} ${url}`, {
          exitCode: 5,
          cause: error
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  buildUrl(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(path.startsWith("http://") || path.startsWith("https://") ? path : `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  const text = await response.text();
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function apiMessage(data: unknown, status: number): string {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.detail === "string") return record.detail;
    if (typeof record.error === "string") return record.error;
    if (typeof record.message === "string") return record.message;
  }
  if (typeof data === "string") return data;
  return `Replicate API request failed with status ${status}.`;
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  }
  return undefined;
}

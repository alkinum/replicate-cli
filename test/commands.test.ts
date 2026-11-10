import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

describe("resource command workflows", () => {
  let directory: string;
  let baseUrl: string;
  const requests: Array<{ method?: string; path: string; body?: any }> = [];
  const schema = {
    components: {
      schemas: {
        Input: {
          type: "object",
          required: ["prompt"],
          properties: {
            prompt: { type: "string", description: "Describe the result" },
          },
        },
      },
    },
  };
  const model = {
    owner: "owner",
    name: "model",
    description: "A helpful model",
    run_count: 42,
    visibility: "public",
    latest_version: { id: "v1", openapi_schema: schema },
  };
  const version = {
    id: "v1",
    created_at: "2026-11-01T00:00:00Z",
    openapi_schema: schema,
  };
  const prediction = {
    id: "p1",
    status: "succeeded",
    model: "owner/model",
    output: "Hello from the model",
  };
  const training = {
    ...prediction,
    id: "t1",
    output: { version: "owner/model:v2" },
  };
  const deployment = {
    owner: "owner",
    name: "deployment",
    current_release: {
      number: 1,
      model: "owner/model",
      version: "v1",
      configuration: { hardware: "cpu", min_instances: 0, max_instances: 2 },
    },
  };
  const file = {
    id: "f1",
    name: "sample.txt",
    size: 5,
    content_type: "text/plain",
  };
  const collection = {
    slug: "featured",
    name: "Featured",
    description: "Useful models",
    models: [model],
  };
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += String(chunk);
    const path = new URL(request.url!, "http://localhost").pathname;
    const body =
      request.headers["content-type"]?.includes("application/json") && raw
        ? JSON.parse(raw)
        : raw;
    requests.push({ method: request.method, path: request.url!, body });
    response.setHeader("content-type", "application/json");
    const send = (value: unknown) => response.end(JSON.stringify(value));
    const page = (value: unknown) => send({ next: null, results: [value] });
    if (path === "/asset.txt") {
      response.setHeader("content-type", "text/plain");
      response.end("hello");
    } else if (request.method === "DELETE") {
      response.statusCode = 204;
      response.end();
    } else if (path.endsWith("/cancel"))
      send({ ...prediction, status: "canceled" });
    else if (path === "/v1/search")
      send({
        models: [model],
        collections: [collection],
        docs: [{ title: "Guide", url: "https://replicate.com/docs" }],
      });
    else if (path === "/v1/hardware") send([{ sku: "cpu", name: "CPU" }]);
    else if (path === "/v1/webhooks/default/secret")
      send({ key: "whsec_example" });
    else if (path === "/v1/models" && request.method === "POST")
      send({ ...model, ...body });
    else if (path === "/v1/models") page(model);
    else if (path.endsWith("/readme"))
      send({ content: "# Model README\nUseful instructions" });
    else if (path.endsWith("/examples")) page(prediction);
    else if (path.endsWith("/versions")) page(version);
    else if (path.endsWith("/versions/v1")) send(version);
    else if (path.endsWith("/trainings") && request.method === "POST")
      send(training);
    else if (path.endsWith("/predictions") && request.method === "POST") {
      const prompt = body?.input?.prompt;
      send({
        ...prediction,
        status:
          prompt === "fail"
            ? "failed"
            : prompt === "pending"
              ? "processing"
              : "succeeded",
        error: prompt === "fail" ? "Inference failed" : null,
        output:
          prompt === "download"
            ? `${baseUrl.replace("/v1", "")}/asset.txt`
            : prediction.output,
      });
    } else if (path === "/v1/models/owner/model") send(model);
    else if (path === "/v1/predictions") page(prediction);
    else if (path === "/v1/predictions/pending")
      send({ ...prediction, status: "processing", output: null });
    else if (path === "/v1/predictions/missing")
      send({ ...prediction, output: null, data_removed: true });
    else if (path === "/v1/predictions/download")
      send({
        ...prediction,
        output: `${baseUrl.replace("/v1", "")}/asset.txt`,
      });
    else if (path.startsWith("/v1/predictions/")) send(prediction);
    else if (path === "/v1/trainings") page(training);
    else if (path.startsWith("/v1/trainings/")) send(training);
    else if (path === "/v1/deployments" && request.method === "POST")
      send(deployment);
    else if (path === "/v1/deployments") page(deployment);
    else if (path.startsWith("/v1/deployments/")) send(deployment);
    else if (path === "/v1/files" && request.method === "POST") send(file);
    else if (path === "/v1/files") page(file);
    else if (path.startsWith("/v1/files/")) send(file);
    else if (path === "/v1/collections") page(collection);
    else if (path.startsWith("/v1/collections/")) send(collection);
    else {
      response.statusCode = 404;
      send({ detail: "Unknown test route" });
    }
  });

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "replicate-commands-"));
    await writeFile(join(directory, "sample.txt"), "hello");
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  async function run(args: string[]) {
    const flags = [
      "--config",
      join(directory, "config.json"),
      "--token",
      "local-test-token",
      "--base-url",
      baseUrl,
    ];
    try {
      const { stdout, stderr } = await exec(
        pnpmBin,
        ["exec", "tsx", "src/cli.ts", ...flags, ...args],
        {
          env: { ...process.env, REPLICATE_API_TOKEN: "", NO_COLOR: "1" },
          timeout: 5000,
        },
      );
      return { stdout, stderr, code: 0 };
    } catch (error) {
      const result = error as { stdout: string; stderr: string; code: number };
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code,
      };
    }
  }

  it.each([
    { args: ["search", "image"], expected: "Models" },
    { args: ["collections", "list"], expected: "Featured" },
    { args: ["collections", "get", "featured"], expected: "owner/model" },
    { args: ["hardware", "list"], expected: "Available hardware" },
    { args: ["models", "list"], expected: "owner/model" },
    { args: ["models", "query", "image"], expected: "owner/model" },
    { args: ["models", "get", "owner/model"], expected: "A helpful model" },
    { args: ["models", "examples", "owner/model"], expected: "p1" },
    { args: ["versions", "list", "owner/model"], expected: "v1" },
    { args: ["versions", "get", "owner/model:v1"], expected: "Model version" },
    { args: ["schema", "owner/model"], expected: "Describe the result" },
    { args: ["schema", "owner/model", "--raw"], expected: '"components"' },
    { args: ["predictions", "list"], expected: "p1" },
    { args: ["predictions", "get", "p1"], expected: "Hello from the model" },
    { args: ["predictions", "wait", "p1"], expected: "succeeded" },
    { args: ["trainings", "list"], expected: "t1" },
    { args: ["trainings", "get", "t1"], expected: "owner/model:v2" },
    { args: ["trainings", "wait", "t1"], expected: "succeeded" },
    { args: ["deployments", "list"], expected: "owner/deployment" },
    {
      args: ["deployments", "get", "owner/deployment"],
      expected: "Minimum instances",
    },
    { args: ["files", "list"], expected: "sample.txt" },
    { args: ["files", "get", "f1"], expected: "text/plain" },
    { args: ["webhooks", "secret"], expected: "Webhook signing secret" },
    {
      args: ["api", "GET", "/models/owner/model"],
      expected: '"owner": "owner"',
    },
    { args: ["skill", "print"], expected: "# Replicate CLI" },
  ])("renders readable output for $args", async ({ args, expected }) => {
    const result = await run(args);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(expected);
    expect(result.stdout).not.toContain('"cliVersion"');
    expect(result.stdout).not.toContain("\u001b[");
  });

  it("prints model output and README content directly", async () => {
    expect((await run(["outputs", "print", "p1"])).stdout).toBe(
      "Hello from the model\n",
    );
    expect((await run(["models", "readme", "owner/model"])).stdout).toBe(
      "# Model README\nUseful instructions\n",
    );
    const json = await run(["outputs", "print", "p1", "--json"]);
    expect(JSON.parse(json.stdout)).toMatchObject({
      ok: true,
      type: "output",
      data: "Hello from the model",
    });
  });

  it("writes verbose metadata to stderr without changing JSON stdout", async () => {
    const result = await run(["models", "list", "--json", "--verbose"]);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, type: "models" });
    expect(result.stderr).toContain('"authSource":"flag"');
    expect(result.stderr).not.toContain("local-test-token");
  });

  it.each([
    ["models", "delete", "owner/model"],
    ["versions", "delete", "owner/model:v1"],
    ["deployments", "delete", "owner/deployment"],
    ["files", "delete", "f1"],
  ])("confirms successful deletion: %j", async (...args) => {
    const result = await run([...args, "--confirm"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("deleted");
    expect(result.stdout).not.toContain("null");
  });

  it.each([
    ["image", "generate", "a lighthouse"],
    ["video", "generate", "a lighthouse"],
    ["audio", "generate", "a melody"],
  ])("supports model shortcuts: %j", async (...args) => {
    const result = await run([...args, "--model", "owner/model"]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("succeeded");
    expect(requests.at(-1)?.body.input.prompt).toBe(args[2]);
  });

  it("uploads, edits, downloads, and installs using local fixtures", async () => {
    expect(
      (await run(["files", "upload", join(directory, "sample.txt")])).stdout,
    ).toContain("sample.txt");
    const edit = await run([
      "image",
      "edit",
      "--model",
      "owner/model",
      "--image",
      join(directory, "sample.txt"),
    ]);
    expect(edit.code, edit.stderr).toBe(0);
    expect(requests.at(-1)?.body.input.image).toMatch(
      /^data:text\/plain|^data:application\/octet-stream/,
    );
    const downloaded = await run([
      "files",
      "download",
      `${baseUrl.replace("/v1", "")}/asset.txt`,
      "--output",
      join(directory, "download.txt"),
    ]);
    expect(downloaded.stdout).toContain("File downloaded");
    expect(await readFile(join(directory, "download.txt"), "utf8")).toBe(
      "hello",
    );
    const artifacts = await run([
      "outputs",
      "download",
      "download",
      "--output",
      join(directory, "artifacts"),
    ]);
    expect(artifacts.stdout).toContain("Downloaded files");
    expect(
      JSON.parse(
        await readFile(join(directory, "artifacts", "manifest.json"), "utf8"),
      ).artifacts,
    ).toHaveLength(1);
    const skill = await run([
      "skill",
      "install",
      "--target",
      join(directory, "skill"),
    ]);
    expect(skill.stdout).toContain("Companion skill installed");
    expect(
      await readFile(join(directory, "skill", "SKILL.md"), "utf8"),
    ).toContain("# Replicate CLI");
  });

  it("shows next steps for pending predictions and fails when inference fails", async () => {
    const pending = await run([
      "run",
      "owner/model",
      "--input",
      "prompt=pending",
      "--async",
      "--output",
      directory,
    ]);
    expect(pending.code).toBe(0);
    expect(pending.stdout).toContain("replicate predictions wait p1");
    expect(pending.stdout).toContain("--output <dir>");
    const failed = await run([
      "run",
      "owner/model",
      "--input",
      "prompt=fail",
      "--json",
    ]);
    expect(failed.code).toBe(4);
    expect(JSON.parse(failed.stdout).error.code).toBe("prediction_failed");
  });

  it("rejects unavailable output with actionable errors", async () => {
    const pending = await run([
      "outputs",
      "download",
      "pending",
      "--output",
      directory,
      "--json",
    ]);
    expect(pending.code).toBe(4);
    expect(JSON.parse(pending.stdout).error.code).toBe(
      "prediction_output_not_ready",
    );
    const missing = await run(["outputs", "print", "missing", "--json"]);
    expect(missing.code).toBe(4);
    expect(JSON.parse(missing.stdout).error.code).toBe(
      "prediction_output_unavailable",
    );
  });

  it("includes literal query parameters in raw API previews and requests", async () => {
    const preview = await run([
      "api",
      "GET",
      "/models",
      "--query",
      "cursor=00123",
      "--query",
      'filter={"x":1}',
      "--dry-run",
      "--json",
    ]);
    expect(JSON.parse(preview.stdout).data.query).toEqual({
      cursor: "00123",
      filter: '{"x":1}',
    });
    await run(["api", "GET", "/models", "--query", "cursor=00123"]);
    expect(requests.at(-1)?.path).toBe("/v1/models?cursor=00123");
  });

  it("allows clearing model metadata instead of discarding empty strings", async () => {
    const result = await run([
      "models",
      "update",
      "owner/model",
      "--description",
      "",
      "--confirm",
      "--json",
    ]);
    expect(result.code).toBe(0);
    expect(requests.at(-1)?.body).toEqual({ description: "" });
  });

  it("validates JSON file contents and metadata before writing to the API", async () => {
    const count = requests.length;
    const metadata = join(directory, "metadata.json");
    await writeFile(metadata, "[]");
    const invalidMetadata = await run([
      "files",
      "upload",
      join(directory, "sample.txt"),
      "--metadata-json",
      metadata,
      "--json",
    ]);
    expect(JSON.parse(invalidMetadata.stdout).error.code).toBe(
      "invalid_metadata",
    );
    await writeFile(metadata, "{");
    const invalidJson = await run([
      "run",
      "owner/model",
      "--input-json",
      metadata,
      "--json",
    ]);
    expect(JSON.parse(invalidJson.stdout).error.code).toBe("invalid_json");
    expect(requests).toHaveLength(count);
  });

  it("validates schemas when --version names an official model", async () => {
    const result = await run([
      "run",
      "--version",
      "owner/model",
      "--input",
      "prompt=hello",
      "--validate-schema",
      "--json",
    ]);
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).data.status).toBe("succeeded");
  });

  it("creates models, deployments, and trainings with validated bodies", async () => {
    const modelResult = await run([
      "models",
      "create",
      "owner/model",
      "--hardware",
      "cpu",
      "--visibility",
      "private",
      "--confirm",
    ]);
    expect(modelResult.code, modelResult.stderr).toBe(0);
    expect(requests.at(-1)?.body).toMatchObject({
      owner: "owner",
      name: "model",
      hardware: "cpu",
      visibility: "private",
    });
    const deploy = await run([
      "deployments",
      "create",
      "owner/deployment",
      "--model",
      "owner/model",
      "--version",
      "v1",
      "--hardware",
      "cpu",
      "--min-instances",
      "0",
      "--max-instances",
      "2",
      "--confirm",
    ]);
    expect(deploy.code, deploy.stderr).toBe(0);
    expect(requests.at(-1)?.body).toMatchObject({
      name: "deployment",
      min_instances: 0,
      max_instances: 2,
    });
    const trained = await run([
      "trainings",
      "create",
      "owner/model:v1",
      "--destination",
      "owner/model",
      "--confirm",
    ]);
    expect(trained.code, trained.stderr).toBe(0);
    expect(requests.at(-1)?.body.destination).toBe("owner/model");
  });

  it.each([
    {
      args: ["run", "owner/model", "--deployment", "owner/deployment"],
      code: "conflicting_target",
    },
    {
      args: [
        "run",
        "--version",
        "v1",
        "--validate-schema",
        "--input-file",
        "image=/missing.png",
      ],
      code: "schema_validation_unavailable",
    },
    {
      args: [
        "run",
        "owner/model",
        "--input-file",
        "image=/missing.png",
        "--input-file",
        "__proto__.image=/missing.png",
      ],
      code: "invalid_key",
    },
    {
      args: ["predictions", "wait", "p1", "--poll-interval", "2147483648ms"],
      code: "invalid_poll_interval",
    },
    {
      args: ["run", "owner/model", "--version", "other/model:v1"],
      code: "conflicting_target",
    },
    {
      args: ["run", "owner/model:v1", "--version", "v2"],
      code: "conflicting_target",
    },
    {
      args: ["run", "owner/model", "--sync", "--async"],
      code: "conflicting_options",
    },
    {
      args: [
        "run",
        "owner/model",
        "--wait",
        "61",
        "--input-file",
        "image=/missing.png",
      ],
      code: "invalid_wait",
    },
    {
      args: ["run", "owner/model", "--webhook", "http://example.test/hook"],
      code: "invalid_webhook",
    },
    {
      args: ["run", "owner/model", "--webhook-events", "completed"],
      code: "invalid_webhook_events",
    },
    { args: ["models", "list", "--sort-by", "unknown"], code: "invalid_sort" },
    {
      args: ["models", "get", "owner/model?bad=true"],
      code: "invalid_resource_ref",
    },
    { args: ["search", "  "], code: "invalid_query" },
    { args: ["files", "list", "--limit", "0"], code: "invalid_limit" },
    {
      args: ["predictions", "list", "--source", "api"],
      code: "invalid_source",
    },
    {
      args: ["predictions", "list", "--created-after", "invalid"],
      code: "invalid_date",
    },
    {
      args: ["predictions", "list", "--created-after", "2026-02-31T00:00:00Z"],
      code: "invalid_date",
    },
    {
      args: [
        "predictions",
        "list",
        "--created-after",
        "2026-11-10T00:00:00Z",
        "--created-before",
        "2026-11-01T00:00:00Z",
      ],
      code: "invalid_date_range",
    },
    {
      args: ["predictions", "get", "p1?delete=true"],
      code: "invalid_resource_ref",
    },
    {
      args: ["models", "create", "owner/model", "--dry-run"],
      code: "missing_required_option",
    },
    {
      args: ["models", "update", "owner/model", "--dry-run"],
      code: "empty_update",
    },
    {
      args: ["deployments", "create", "owner/deployment", "--dry-run"],
      code: "missing_required_option",
    },
    {
      args: [
        "deployments",
        "update",
        "owner/deployment",
        "--min-instances",
        "NaN",
        "--dry-run",
      ],
      code: "invalid_scaling",
    },
    {
      args: [
        "deployments",
        "update",
        "owner/deployment",
        "--min-instances",
        "3",
        "--max-instances",
        "2",
        "--dry-run",
      ],
      code: "invalid_scaling",
    },
    {
      args: [
        "trainings",
        "create",
        "owner/model:v1",
        "--destination",
        "bad",
        "--dry-run",
      ],
      code: "invalid_resource_ref",
    },
    { args: ["api", "BOGUS", "/models", "--dry-run"], code: "invalid_method" },
    {
      args: ["api", "GET", "/models", "--body", "{}", "--dry-run"],
      code: "invalid_body",
    },
    {
      args: ["api", "POST", "/models", "--body", "{", "--dry-run"],
      code: "invalid_json",
    },
    {
      args: ["api", "POST", "/models", "--body", "", "--dry-run"],
      code: "invalid_json",
    },
    {
      args: ["api", "GET", "https://other.test/models", "--dry-run"],
      code: "invalid_api_url",
    },
    {
      args: ["api", "GET", "/models", "--base-url", "invalid", "--dry-run"],
      code: "invalid_api_url",
    },
    {
      args: ["run", "owner/model", "--timeout", "0", "--dry-run"],
      code: "invalid_duration",
    },
  ])("rejects invalid arguments before I/O: $args", async ({ args, code }) => {
    const count = requests.length;
    const result = await run([...args, "--json"]);
    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.stdout).error.code).toBe(code);
    expect(requests).toHaveLength(count);
  });
});

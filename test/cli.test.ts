import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const testHome = join(tmpdir(), `replicate-cli-test-home-${process.pid}`);

async function runCli(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(pnpmBin, ["exec", "tsx", "src/cli.ts", ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      APPDATA: join(testHome, "AppData", "Roaming"),
      HOME: testHome,
      REPLICATE_API_TOKEN: "",
      XDG_CONFIG_HOME: join(testHome, ".config")
    }
  });
  return stdout;
}

async function runCliResult(args: string[]) {
  try {
    return { stdout: await runCli(args), code: 0 };
  } catch (error) {
    const err = error as { stdout?: string; code?: number };
    return { stdout: err.stdout ?? "", code: err.code ?? 1 };
  }
}

describe("CLI command contract", () => {
  it.each(["predictions", "trainings"])("honors an explicit overall timeout for %s wait", async (group) => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ id: "abc", status: "processing" }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const result = await runCliResult([
        "--json", "--token", "local-test-token", "--base-url", `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        group, "wait", "abc", "--timeout", "50ms", "--poll-interval", "60s"
      ]);
      expect(result.code).toBe(5);
      expect(JSON.parse(result.stdout).error.code).toBe(`${group === "predictions" ? "prediction" : "training"}_wait_timeout`);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it.each([
    ["--json", "unknown-command"],
    ["--json", "models", "get"],
    ["run", "--unknown-option", "--json"],
    ["--json", "files", "download", "https://example.test/a"]
  ])("reports argument errors as JSON: %j", async (...args) => {
    const result = await runCliResult(args);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: "invalid_arguments" } });
  });

  it("supports the documented explicit async prediction creation", async () => {
    const result = JSON.parse(await runCli(["--json", "predictions", "create", "--model", "owner/model", "--async", "--dry-run"]));
    expect(result.data.path).toBe("/models/owner/model/predictions");
    expect(result.data.headers).not.toHaveProperty("Prefer");
  });

  it("preserves remote URLs and nested keys in file input previews", async () => {
    const result = JSON.parse(await runCli([
      "--json", "run", "owner/model", "--input", "nested.prompt=hello", "--input-file", "nested.image=https://example.test/a.png", "--dry-run"
    ]));
    expect(result.data.body.input).toEqual({ nested: { prompt: "hello", image: "https://example.test/a.png" } });
  });

  it("keeps root --version while allowing run --version", async () => {
    await expect(runCli(["--version"])).resolves.toBe("0.1.0\n");

    const output = JSON.parse(
      await runCli(["--json", "run", "owner/model", "--version", "abc", "--input", "prompt=test", "--dry-run"])
    );
    expect(output.data.body.version).toBe("owner/model:abc");
  });

  it("supports version-only prediction refs", async () => {
    const output = JSON.parse(
      await runCli(["--json", "run", "--version", "owner/model:abc", "--input", "prompt=test", "--dry-run"])
    );
    expect(output.data.path).toBe("/predictions");
    expect(output.data.body.version).toBe("owner/model:abc");
  });

  it("supports bare version ids for predictions", async () => {
    const version = "9dcd6d78e7c6560c340d916fe32e9f24aabfa331e5cce95fe31f77fb03121426";
    const output = JSON.parse(
      await runCli(["--json", "run", "--version", version, "--input", "text=Alice", "--dry-run"])
    );
    expect(output.data.path).toBe("/predictions");
    expect(output.data.body.version).toBe(version);
  });

  it("previews destructive deletes without auth", async () => {
    const output = JSON.parse(await runCli(["--json", "models", "delete", "owner/model", "--dry-run"]));
    expect(output.data).toEqual({
      method: "DELETE",
      path: "/models/owner/model"
    });
    expect(output.meta.authSource).toBe("missing");
  });

  it("rejects invalid file modes during dry-run", async () => {
    const result = await runCliResult([
      "--json",
      "run",
      "owner/model",
      "--input-file",
      "image=./input.png",
      "--file-mode",
      "bogus",
      "--dry-run"
    ]);
    const output = JSON.parse(result.stdout);
    expect(result.code).toBe(1);
    expect(output.error.code).toBe("invalid_file_mode");
  });

  it("rejects bare file ids for downloads", async () => {
    const result = await runCliResult(["--json", "files", "download", "file-id", "-o", "out.bin"]);
    const output = JSON.parse(result.stdout);
    expect(result.code).toBe(1);
    expect(output.error.code).toBe("file_download_url_required");
  });

  it("validates sync wait and deadline headers before dry-run output", async () => {
    const tooLongWait = await runCliResult([
      "--json",
      "run",
      "owner/model",
      "--input",
      "prompt=test",
      "--wait",
      "61",
      "--dry-run"
    ]);
    expect(tooLongWait.code).toBe(1);
    expect(JSON.parse(tooLongWait.stdout).error.code).toBe("invalid_wait");

    const tooShortDeadline = await runCliResult([
      "--json",
      "run",
      "owner/model",
      "--input",
      "prompt=test",
      "--deadline",
      "4s",
      "--dry-run"
    ]);
    expect(tooShortDeadline.code).toBe(1);
    expect(JSON.parse(tooShortDeadline.stdout).error.code).toBe("invalid_deadline");
  });
});

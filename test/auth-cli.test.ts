import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const testHome = join(tmpdir(), `replicate-cli-test-home-${process.pid}`);

async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<string> {
  const { stdout } = await execFileAsync(
    pnpmBin,
    ["exec", "tsx", "src/cli.ts", ...args],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        APPDATA: join(testHome, "AppData", "Roaming"),
        HOME: testHome,
        REPLICATE_API_TOKEN: "",
        XDG_CONFIG_HOME: join(testHome, ".config"),
        ...env,
      },
    },
  );
  return stdout;
}

async function runCliResult(args: string[], env: NodeJS.ProcessEnv = {}) {
  try {
    return { stdout: await runCli(args, env), stderr: "", code: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      code: err.code ?? 1,
    };
  }
}

describe("authentication", () => {
  const token = "r8_abcdefghijklmnopqrstuvwxyz0123456789abc";
  const account = { type: "user", username: "ada", name: "Ada Lovelace" };
  const requests: Array<{ url?: string; authorization?: string }> = [];
  const server = createServer((request, response) => {
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
    });
    response.setHeader("content-type", "application/json");
    if (request.headers.authorization === `Bearer ${token}`) {
      response.end(JSON.stringify(account));
    } else if (request.headers.authorization === "Bearer unavailable") {
      response.statusCode = 503;
      response.end(JSON.stringify({ detail: "Service unavailable" }));
    } else if (request.headers.authorization === "Bearer unexpected") {
      response.end(JSON.stringify({ message: "Not an account" }));
    } else if (request.headers.authorization === "Bearer timeout") {
      // Keep the response pending to exercise the real HTTP abort path.
    } else if (request.headers.authorization === "Bearer forbidden") {
      response.statusCode = 403;
      response.end(JSON.stringify({ detail: "Forbidden" }));
    } else {
      response.statusCode = 401;
      response.end(
        JSON.stringify({ detail: `Rejected ${request.headers.authorization}` }),
      );
    }
  });
  let root: string;
  let baseUrl: string;

  // Each command uses a fresh config path; never touch the user's credentials.
  async function context() {
    root ??= await mkdtemp(join(tmpdir(), "replicate-auth-"));
    if (!server.listening) {
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    }
    const directory = await mkdtemp(join(root, "case-"));
    const config = join(directory, "config.json");
    return { config, flags: ["--config", config, "--base-url", baseUrl] };
  }

  afterAll(async () => {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    if (root) await rm(root, { recursive: true, force: true });
  });

  it.each(["positional", "local flag", "global flag"])(
    "verifies and saves a token from a %s",
    async (form) => {
      const { config, flags } = await context();
      const args =
        form === "positional"
          ? ["auth", "set", token]
          : form === "local flag"
            ? ["auth", "set", "--token", token]
            : ["--token", token, "auth", "set"];
      const output = await runCli([
        "--json",
        ...flags,
        "--profile",
        "work",
        ...args,
      ]);
      expect(JSON.parse(output)).toMatchObject({
        ok: true,
        type: "auth",
        data: { verified: true, profile: "work", account },
      });
      expect(output).not.toContain(token);
      expect(requests.at(-1)).toEqual({
        url: "/v1/account",
        authorization: `Bearer ${token}`,
      });
      expect(JSON.parse(await readFile(config, "utf8"))).toMatchObject({
        defaultProfile: "work",
        profiles: { work: { token } },
      });
      if (process.platform !== "win32")
        expect((await stat(config)).mode & 0o777).toBe(0o600);
    },
  );

  it("verifies the supplied token instead of the environment token and explains precedence", async () => {
    const { flags } = await context();
    const output = JSON.parse(
      await runCli(["--json", ...flags, "auth", "set", token], {
        REPLICATE_API_TOKEN: "environment-token",
      }),
    );
    expect(output.data.verified).toBe(true);
    expect(output.data.warning).toContain("takes precedence");
    expect(requests.at(-1)?.authorization).toBe(`Bearer ${token}`);
  });

  it("leaves the saved token unchanged when validation fails", async () => {
    const { config, flags } = await context();
    await runCli([...flags, "auth", "set", token]);
    const before = await readFile(config, "utf8");
    const result = await runCliResult([
      "--json",
      ...flags,
      "auth",
      "set",
      "rejected",
    ]);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "replicate_auth_failed", status: 401 },
    });
    expect(await readFile(config, "utf8")).toBe(before);
    expect(result.stdout).not.toContain("Bearer rejected");
  });

  it("does not overwrite saved credentials when verification times out", async () => {
    const { config, flags } = await context();
    await runCli([...flags, "auth", "set", token, "--no-verify"]);
    const before = await readFile(config, "utf8");
    const result = await runCliResult([
      "--json",
      ...flags,
      "--timeout",
      "20ms",
      "auth",
      "set",
      "timeout",
    ]);
    expect(result.code).toBe(5);
    expect(JSON.parse(result.stdout).error.code).toBe("network_timeout");
    expect(await readFile(config, "utf8")).toBe(before);
  });

  it("reports forbidden tokens as authentication failures", async () => {
    const { flags } = await context();
    const result = await runCliResult([
      "--json",
      ...flags,
      "--token",
      "forbidden",
      "auth",
      "status",
    ]);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout).error).toMatchObject({
      code: "replicate_auth_failed",
      status: 403,
    });
  });

  it.each(["unavailable", "unexpected"])(
    "does not save when verification is %s",
    async (input) => {
      const { config, flags } = await context();
      const result = await runCliResult([
        "--json",
        ...flags,
        "auth",
        "set",
        input,
      ]);
      expect(result.code).not.toBe(0);
      expect(JSON.parse(result.stdout).error.code).toBe(
        input === "unavailable"
          ? "replicate_server_error"
          : "invalid_account_response",
      );
      await expect(readFile(config)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("supports offline save and status without making requests", async () => {
    const { flags } = await context();
    const count = requests.length;
    const saved = JSON.parse(
      await runCli(["--json", ...flags, "auth", "set", token, "--no-verify"]),
    );
    expect(saved.data.verified).toBe(false);
    const result = await runCli([
      "--json",
      ...flags,
      "auth",
      "status",
      "--offline",
    ]);
    expect(JSON.parse(result).data).toMatchObject({
      status: "unverified",
      source: "config",
      token: "r8_a...9abc",
      redacted: "r8_a...9abc",
    });
    expect(result).not.toContain(token);
    expect(requests).toHaveLength(count);
  });

  it("checks the active token and prints readable status and account details", async () => {
    const { flags } = await context();
    await runCli([...flags, "auth", "set", token]);
    const output = await runCli([...flags, "auth", "status"]);
    expect(output).toContain("Replicate authentication");
    expect(output).toContain("Valid token");
    expect(output).toContain("Ada Lovelace (@ada)");
    expect(output).toContain("Saved config");
    expect(output).toContain("r8_a...9abc");
    expect(output).not.toContain(token);
    expect(output).not.toContain("\u001b[");
    const json = JSON.parse(
      await runCli(["--json", ...flags, "auth", "status"]),
    );
    expect(json.data).toMatchObject({
      status: "valid",
      source: "config",
      account,
    });
    const accountOutput = await runCli([...flags, "account", "get"]);
    expect(accountOutput).toContain("Replicate account");
    expect(accountOutput).toContain("Ada Lovelace (@ada)");
  });

  it("rejects invalid active tokens and distinguishes service failures", async () => {
    const { flags } = await context();
    const rejected = await runCliResult([
      "--json",
      ...flags,
      "--token",
      "rejected",
      "auth",
      "status",
    ]);
    expect(rejected.code).toBe(2);
    expect(JSON.parse(rejected.stdout).error.code).toBe(
      "replicate_auth_failed",
    );
    const unavailable = await runCliResult([
      "--json",
      ...flags,
      "--token",
      "unavailable",
      "auth",
      "status",
    ]);
    expect(unavailable.code).toBe(3);
    expect(JSON.parse(unavailable.stdout).error.code).toBe(
      "replicate_server_error",
    );
  });

  it("provides setup guidance when no token is configured", async () => {
    const { flags } = await context();
    const count = requests.length;
    const output = await runCli([...flags, "auth", "status"]);
    expect(output).toContain("No token configured");
    expect(output).toContain("replicate auth set");
    expect(requests).toHaveLength(count);
  });

  it.each([{ mode: ["--json"] }, { mode: [] }])(
    "fails promptly without a token in non-interactive mode: %j",
    async ({ mode }) => {
      const { flags } = await context();
      const result = await runCliResult([...mode, ...flags, "auth", "set"]);
      expect(result.code).toBe(2);
      expect(result.stdout + result.stderr).toContain(
        "replicate auth set <token>",
      );
    },
  );

  it.each([["   "], ["has spaces"], [token, "--token", token]])(
    "rejects invalid or ambiguous token arguments",
    async (...input) => {
      const { flags } = await context();
      const count = requests.length;
      const result = await runCliResult([
        "--json",
        ...flags,
        "auth",
        "set",
        ...input,
      ]);
      expect(result.code).not.toBe(0);
      expect(requests).toHaveLength(count);
    },
  );

  it("reports authentication failures and reachability separately in doctor", async () => {
    const { flags } = await context();
    const result = await runCliResult([
      "--json",
      ...flags,
      "--token",
      "rejected",
      "doctor",
    ]);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout).data).toMatchObject({
      reachable: true,
      auth: { status: "invalid" },
      error: { code: "replicate_auth_failed" },
    });
    const healthy = await runCli([...flags, "--token", token, "doctor"]);
    expect(healthy).toContain("Replicate diagnostics");
    expect(healthy).toContain("Valid token");
    expect(healthy).toContain("Reachable");
  });

  it("clears a saved profile and explains an environment token that remains active", async () => {
    const { flags } = await context();
    await runCli([...flags, "--profile", "work", "auth", "set", token]);
    const result = await runCli(
      [...flags, "--profile", "work", "auth", "clear"],
      { REPLICATE_API_TOKEN: token },
    );
    expect(result).toContain("Saved authentication cleared");
    expect(result).toContain("work");
    expect(result).toContain("REPLICATE_API_TOKEN is still set");
    const status = JSON.parse(
      await runCli(["--json", ...flags, "--profile", "work", "auth", "status"]),
    );
    expect(status.data.status).toBe("missing");
  });

  it.each(["", "__proto__", "constructor", "prototype"])(
    "does not clear saved credentials for invalid profile %j",
    async (profile) => {
      const { flags, config } = await context();
      await runCli([...flags, "auth", "set", token, "--no-verify"]);
      const before = await readFile(config, "utf8");
      const result = await runCliResult([
        "--json",
        ...flags,
        "--profile",
        profile,
        "auth",
        "clear",
      ]);
      expect(JSON.parse(result.stdout).error.code).toBe("invalid_profile");
      expect(await readFile(config, "utf8")).toBe(before);
    },
  );

  it("rejects an explicitly empty token instead of falling back to the environment", async () => {
    const { flags } = await context();
    const result = await runCliResult(
      ["--json", ...flags, "--token", "", "auth", "status"],
      { REPLICATE_API_TOKEN: token },
    );
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout).error.code).toBe("invalid_token");
  });
});

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

async function runCli(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(pnpmBin, ["exec", "tsx", "src/cli.ts", ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      REPLICATE_API_TOKEN: ""
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
});

import { password } from "@inquirer/prompts";
import { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clearAuthToken, resolveAuth, setAuthToken } from "../lib/auth.js";
import { ReplicateHttpClient } from "../lib/api-client.js";
import { asResult } from "../lib/output.js";
import { action, clientFor, globals, metaFor, timeoutMs, VERSION } from "./shared.js";

export function registerDoctor(root: Command): void {
  root
    .command("doctor")
    .description("verify config, auth, and endpoint reachability")
    .action(
      action("doctor", async (command) => {
        const opts = globals(command);
        const auth = await resolveAuth(opts);
        const data: Record<string, unknown> = {
          version: VERSION,
          baseUrl: opts.baseUrl,
          auth: {
            available: Boolean(auth.token),
            source: auth.source,
            profile: auth.profile,
            token: auth.redacted
          }
        };
        if (auth.token) {
          const client = new ReplicateHttpClient({
            baseUrl: opts.baseUrl,
            token: auth.token,
            timeoutMs: timeoutMs(command)
          });
          try {
            data.account = (await client.request("GET", "/account")).data;
            data.reachable = true;
          } catch (error) {
            data.reachable = false;
            data.error = error instanceof Error ? error.message : String(error);
          }
        }
        return data;
      })
    );
}

export function registerAuth(root: Command): void {
  const auth = root.command("auth").description("manage Replicate API token");

  auth
    .command("set")
    .description("store an API token in the local config")
    .option("--token <token>", "token to store")
    .action(
      action("auth", async (command) => {
        const opts = { ...globals(command), ...command.opts() };
        const token = opts.token ?? (await password({ message: "Replicate API token" }));
        return setAuthToken(token, opts);
      })
    );

  auth
    .command("status")
    .description("show token source without revealing the token")
    .action(action("auth", async (command) => resolveAuth(globals(command))));

  auth
    .command("clear")
    .description("remove stored API token config")
    .action(action("auth", async (command) => clearAuthToken(globals(command))));
}

export function registerAccount(root: Command): void {
  root
    .command("account")
    .description("account commands")
    .command("get")
    .description("get the authenticated account")
    .action(
      action("account", async (command) => {
        const bundle = await clientFor(command);
        return asResult("account", (await bundle.client.request("GET", "/account")).data, {
          meta: metaFor(bundle)
        });
      })
    );
}

export function registerSkill(root: Command): void {
  const skill = root.command("skill").description("companion Codex skill commands");
  skill
    .command("print")
    .description("print bundled companion skill")
    .action(action("skill", async () => readFile(skillPath(), "utf8")));
  skill
    .command("install")
    .description("install bundled companion skill")
    .option("--target <path>", "target skill directory", "~/.codex/skills/replicate")
    .action(
      action("skill", async (command) => {
        const target = expandHome(command.opts().target);
        await mkdir(target, { recursive: true });
        const targetPath = resolve(target, "SKILL.md");
        await writeFile(targetPath, await readFile(skillPath(), "utf8"));
        return { installed: true, path: targetPath };
      })
    );
}

function skillPath(): string {
  const bundled = fileURLToPath(new URL("../skills/replicate/SKILL.md", import.meta.url));
  if (existsSync(bundled)) return bundled;
  return fileURLToPath(new URL("../../skills/replicate/SKILL.md", import.meta.url));
}

function expandHome(path: string): string {
  const home = homedir();
  if (path === "~") return home;
  if (path.startsWith("~/")) return resolve(home, path.slice(2));
  return resolve(path);
}

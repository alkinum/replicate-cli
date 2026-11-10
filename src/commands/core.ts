import { password } from "@inquirer/prompts";
import { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearAuthToken,
  normalizeAuthToken,
  resolveAuth,
  setAuthToken,
  verifyAuthToken,
} from "../lib/auth.js";
import { resolveConfigPath } from "../lib/config.js";
import { CliError, errorFromUnknown } from "../lib/errors.js";
import { asResult, errorEnvelope } from "../lib/output.js";
import { accountLabel, authSourceLabel, details } from "../lib/terminal.js";
import {
  action,
  clientFor,
  globals,
  metaFor,
  timeoutMs,
  VERSION,
} from "./shared.js";

export function registerDoctor(root: Command): void {
  root
    .command("doctor")
    .description("verify config, auth, and endpoint reachability")
    .action(
      action(
        "doctor",
        async (command) => {
          const opts = globals(command);
          const auth = await resolveAuth(opts);
          const data: Record<string, unknown> = {
            version: VERSION,
            baseUrl: opts.baseUrl,
            auth: {
              available: Boolean(auth.token),
              status: auth.token ? "unverified" : "missing",
              source: auth.source,
              profile: auth.profile,
              token: auth.redacted,
            },
          };
          if (auth.token) {
            try {
              data.account = await verifyAuthToken(auth.token, {
                baseUrl: opts.baseUrl,
                timeoutMs: timeoutMs(command),
              });
              (data.auth as Record<string, unknown>).status = "valid";
              data.reachable = true;
            } catch (error) {
              const failure = errorFromUnknown(error);
              data.reachable = failure.status !== undefined;
              (data.auth as Record<string, unknown>).status =
                failure.code === "replicate_auth_failed"
                  ? "invalid"
                  : "unverified";
              data.error = errorEnvelope(failure).error;
              process.exitCode = failure.exitCode;
            }
          }
          if (!auth.token) process.exitCode = 2;
          return data;
        },
        (data) =>
          details(
            "Replicate diagnostics",
            [
              ["Version", data.version],
              ["Endpoint", data.baseUrl],
              [
                "Authentication",
                data.auth.status === "valid"
                  ? "Valid token"
                  : data.auth.status === "invalid"
                    ? "Invalid token"
                    : data.auth.status === "missing"
                      ? "No token configured"
                      : "Could not verify token",
              ],
              ["Account", accountLabel(data.account)],
              ["Source", authSourceLabel(data.auth.source)],
              ["Profile", data.auth.profile],
              ["Token", data.auth.token],
              [
                "API",
                data.reachable === undefined
                  ? "Not checked"
                  : data.reachable
                    ? "Reachable"
                    : "Could not connect",
              ],
            ],
            data.error?.message ??
              (!data.auth.available
                ? "Run `replicate auth set` to connect your account."
                : undefined),
          ),
      ),
    );
}

export function registerAuth(root: Command): void {
  const auth = root.command("auth").description("manage Replicate API token");

  auth
    .command("set [token]")
    .description("verify and store an API token (prompts when omitted)")
    .option("--token <token>", "token to store")
    .option("--no-verify", "save without checking the API (offline)")
    .action(
      action(
        "auth",
        async (command, tokenArgument?: string) => {
          const opts = { ...globals(command), ...command.opts() };
          if (tokenArgument !== undefined && opts.token !== undefined) {
            throw new CliError(
              "invalid_arguments",
              "Pass the token as an argument or with --token, using only one form.",
            );
          }
          let input = tokenArgument ?? opts.token;
          if (input === undefined) {
            if (opts.json || !process.stdin.isTTY) {
              throw new CliError(
                "token_required",
                "Provide a token with `replicate auth set <token>` or `replicate auth set --token <token>`. Run without --json in a terminal to use the hidden prompt.",
                { exitCode: 2 },
              );
            }
            input = await password({ message: "Replicate API token" });
          }
          const token = normalizeAuthToken(input);
          const account = command.opts().verify
            ? await verifyAuthToken(token, {
                baseUrl: opts.baseUrl,
                timeoutMs: timeoutMs(command),
              })
            : undefined;
          const saved = await setAuthToken(token, opts);
          return {
            ...saved,
            verified: Boolean(account),
            account,
            warning: process.env.REPLICATE_API_TOKEN
              ? "REPLICATE_API_TOKEN takes precedence over the saved token. Unset it to use this profile."
              : undefined,
          };
        },
        (data) =>
          details(
            data.verified
              ? "Token verified and saved"
              : "Token saved (not verified)",
            [
              ["Account", accountLabel(data.account)],
              ["Profile", data.profile],
              ["Token", data.token],
              ["Config", data.configPath],
            ],
            data.warning,
          ),
      ),
    );

  auth
    .command("status")
    .description("verify the active token and show its account and source")
    .option(
      "--offline",
      "show local token configuration without checking the API",
    )
    .action(
      action(
        "auth",
        async (command) => {
          const opts = globals(command);
          const resolved = await resolveAuth(opts);
          const account =
            resolved.token && !command.opts().offline
              ? await verifyAuthToken(resolved.token, {
                  baseUrl: opts.baseUrl,
                  timeoutMs: timeoutMs(command),
                })
              : undefined;
          return {
            available: Boolean(resolved.token),
            status: account
              ? "valid"
              : resolved.token
                ? "unverified"
                : "missing",
            source: resolved.source,
            profile: resolved.profile,
            token: resolved.redacted,
            redacted: resolved.redacted,
            configPath:
              resolved.source === "config" || resolved.source === "missing"
                ? resolveConfigPath(opts.config)
                : undefined,
            account,
          };
        },
        (data) =>
          details(
            "Replicate authentication",
            [
              [
                "Status",
                data.status === "valid"
                  ? "Valid token"
                  : data.status === "unverified"
                    ? "Not verified (offline)"
                    : "No token configured",
              ],
              ["Account", accountLabel(data.account)],
              ["Source", authSourceLabel(data.source)],
              ["Profile", data.profile],
              ["Token", data.token],
              ["Config", data.configPath],
            ],
            !data.available
              ? "Run `replicate auth set` to connect your account."
              : undefined,
          ),
      ),
    );

  auth
    .command("clear")
    .description("remove stored API token config")
    .action(
      action(
        "auth",
        async (command) => {
          const opts = globals(command);
          return {
            ...(await clearAuthToken(opts)),
            profile: opts.profile,
            configPath: resolveConfigPath(opts.config),
            warning: process.env.REPLICATE_API_TOKEN
              ? "REPLICATE_API_TOKEN is still set and will continue to authenticate requests."
              : undefined,
          };
        },
        (data) =>
          details(
            "Saved authentication cleared",
            [
              ["Profile", data.profile ?? "All profiles"],
              ["Config", data.configPath],
            ],
            data.warning,
          ),
      ),
    );
}

export function registerAccount(root: Command): void {
  root
    .command("account")
    .description("account commands")
    .command("get")
    .description("get the authenticated account")
    .action(
      action(
        "account",
        async (command) => {
          const bundle = await clientFor(command);
          return asResult(
            "account",
            (await bundle.client.request("GET", "/account")).data,
            {
              meta: metaFor(bundle),
            },
          );
        },
        (result) =>
          details("Replicate account", [
            ["Account", accountLabel(result.data)],
            ["Type", result.data.type],
            ["GitHub", result.data.github_url],
          ]),
      ),
    );
}

export function registerSkill(root: Command): void {
  const skill = root
    .command("skill")
    .description("companion Codex skill commands");
  skill
    .command("print")
    .description("print bundled companion skill")
    .action(action("skill", async () => readFile(skillPath(), "utf8")));
  skill
    .command("install")
    .description("install bundled companion skill")
    .option(
      "--target <path>",
      "target skill directory",
      "~/.codex/skills/replicate",
    )
    .action(
      action("skill", async (command) => {
        const target = expandHome(command.opts().target);
        await mkdir(target, { recursive: true });
        const targetPath = resolve(target, "SKILL.md");
        await writeFile(targetPath, await readFile(skillPath(), "utf8"));
        return { installed: true, path: targetPath };
      }),
    );
}

function skillPath(): string {
  const bundled = fileURLToPath(
    new URL("../skills/replicate/SKILL.md", import.meta.url),
  );
  if (existsSync(bundled)) return bundled;
  return fileURLToPath(
    new URL("../../skills/replicate/SKILL.md", import.meta.url),
  );
}

function expandHome(path: string): string {
  const home = homedir();
  if (path === "~") return home;
  if (path.startsWith("~/")) return resolve(home, path.slice(2));
  return resolve(path);
}

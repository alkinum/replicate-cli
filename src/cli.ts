#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { registerCommands } from "./commands/index.js";
import { VERSION } from "./commands/shared.js";
import { CliError, errorFromUnknown, redactDeep } from "./lib/errors.js";
import { errorEnvelope, writeJson } from "./lib/output.js";

const program = new Command();
const argv = process.argv.slice(2);
const json = argv.includes("--json");

if (argv.length === 1 && argv[0] === "--version") {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

program
  .exitOverride()
  .configureOutput({
    writeErr: (message) => { if (!json) process.stderr.write(String(redactDeep(message))); }
  })
  .name("replicate")
  .description("AI-first Replicate CLI")
  .version(VERSION, "-V, --cli-version", "output the CLI version number")
  .option("--json", "emit stable JSON envelopes")
  .option("--token <token>", "one-off Replicate API token")
  .option("--profile <name>", "config profile name")
  .option("--config <path>", "config file path")
  .option("--base-url <url>", "Replicate API base URL", "https://api.replicate.com/v1")
  .option("--timeout <duration>", "HTTP timeout, e.g. 30s or 120000ms; bare numbers are seconds", "120s")
  .option("--verbose", "include debug metadata");

registerCommands(program);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode;
    if (json && error.exitCode !== 0) {
      writeJson(errorEnvelope(new CliError("invalid_arguments", error.message), { cliVersion: VERSION }));
    }
  } else {
    const cliError = errorFromUnknown(error);
    process.exitCode = cliError.exitCode;
    if (json) writeJson(errorEnvelope(cliError, { cliVersion: VERSION }));
    else process.stderr.write(`Error: ${redactDeep(cliError.message)}\n`);
  }
}

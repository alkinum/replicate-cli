#!/usr/bin/env node
import { Command } from "commander";
import { registerCommands } from "./commands/index.js";
import { VERSION } from "./commands/shared.js";

const program = new Command();
const argv = process.argv.slice(2);

if (argv.length === 1 && argv[0] === "--version") {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

program
  .name("replicate")
  .description("AI-first Replicate CLI")
  .version(VERSION, "-V, --cli-version", "output the CLI version number")
  .option("--json", "emit stable JSON envelopes")
  .option("--token <token>", "one-off Replicate API token")
  .option("--profile <name>", "config profile name")
  .option("--config <path>", "config file path")
  .option("--base-url <url>", "Replicate API base URL", "https://api.replicate.com/v1")
  .option("--timeout <duration>", "HTTP timeout, e.g. 30s or 120000", "120s")
  .option("--verbose", "include debug metadata");

registerCommands(program);

await program.parseAsync(process.argv);

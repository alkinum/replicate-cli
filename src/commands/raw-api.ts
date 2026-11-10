import { Command } from "commander";
import { assertConfirm, CliError } from "../lib/errors.js";
import { asResult } from "../lib/output.js";
import { parseJson, readJsonFile, toQuery } from "../lib/parse.js";
import { action, clientFor, collect, metaFor, requestPreview } from "./shared.js";

export function registerRawApi(root: Command): void {
  root.command("api").description("raw Replicate API request").argument("<method>", "HTTP method").argument("<path>", "API path or URL").option("--query <key=value>", "query parameter; repeatable", collect, []).option("--body-json <path>", "JSON request body file").option("--body <json>", "inline JSON body").option("--dry-run", "preview request").option("--confirm", "confirm non-GET request").action(
    action("api", async (command, methodRaw: string, path: string) => {
      const method = methodRaw.toUpperCase();
      const opts = command.opts();
      if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "QUERY"].includes(method)) throw new CliError("invalid_method", "Use GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, or QUERY.");
      if (opts.bodyJson !== undefined && opts.body !== undefined) throw new CliError("conflicting_options", "Choose --body or --body-json.");
      if (["GET", "HEAD"].includes(method) && (opts.body !== undefined || opts.bodyJson !== undefined)) throw new CliError("invalid_body", `${method} requests cannot include a body. Use --query for query parameters.`);
      if (!["GET", "HEAD"].includes(method)) {
        assertConfirm(opts.confirm, `Raw ${method} request`, opts.dryRun);
      }
      const body = opts.bodyJson !== undefined
        ? await readJsonFile(opts.bodyJson)
        : opts.body !== undefined
          ? parseJson(opts.body, "--body")
          : undefined;
      const query = toQuery(opts.query);
      const bundle = await clientFor(command, !opts.dryRun);
      bundle.client.buildUrl(path, query);
      if (opts.dryRun) return asResult("api", requestPreview(method, path, body, undefined, query), { meta: metaFor(bundle) });
      return asResult("api", (await bundle.client.request(method, path, { query, body })).data, {
        meta: metaFor(bundle)
      });
    })
  );
}

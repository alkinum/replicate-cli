import { Command } from "commander";
import { assertConfirm } from "../lib/errors.js";
import { asResult } from "../lib/output.js";
import { readJsonFile, toQuery } from "../lib/parse.js";
import { action, clientFor, collect, metaFor, requestPreview } from "./shared.js";

export function registerRawApi(root: Command): void {
  root.command("api").description("raw Replicate API request").argument("<method>", "HTTP method").argument("<path>", "API path or URL").option("--query <key=value>", "query parameter; repeatable", collect, []).option("--body-json <path>", "JSON request body file").option("--body <json>", "inline JSON body").option("--dry-run", "preview request").option("--confirm", "confirm non-GET request").action(
    action("api", async (command, methodRaw: string, path: string) => {
      const method = methodRaw.toUpperCase();
      const opts = command.opts();
      if (!["GET", "HEAD"].includes(method)) {
        assertConfirm(opts.confirm, `Raw ${method} request`, opts.dryRun);
      }
      const bundle = await clientFor(command, !opts.dryRun);
      const body = opts.bodyJson
        ? await readJsonFile(opts.bodyJson)
        : opts.body
          ? JSON.parse(opts.body)
          : undefined;
      const query = toQuery(opts.query);
      if (opts.dryRun) return asResult("api", requestPreview(method, path, body), { meta: metaFor(bundle) });
      return asResult("api", (await bundle.client.request(method, path, { query, body })).data, {
        meta: metaFor(bundle)
      });
    })
  );
}

import { Command } from "commander";
import { assertConfirm, CliError } from "../lib/errors.js";
import { asResult, throwIfMissing } from "../lib/output.js";
import { parseModelRef, parseOwnerName } from "../lib/parse.js";
import { simplifyOpenApiSchema } from "../lib/schema.js";
import { action, bodyFromOptions, clientFor, metaFor, requestPreview } from "./shared.js";

export function registerModels(root: Command): void {
  const models = root.command("models").description("model commands");
  models.command("list").description("list public models").option("--limit <number>", "limit returned results").option("--cursor <url>", "next URL from prior response").option("--sort-by <field>", "sort field").option("--sort-direction <direction>", "sort direction").action(
    action("models", async (command) => {
      const bundle = await clientFor(command);
      const opts = command.opts();
      const data = (await bundle.client.request("GET", opts.cursor ?? "/models", {
        query: opts.cursor
          ? undefined
          : {
              sort_by: opts.sortBy,
              sort_direction: opts.sortDirection
            }
      })).data as Record<string, any>;
      if (opts.limit && Array.isArray(data.results)) data.results = data.results.slice(0, Number(opts.limit));
      return asResult("models", data, { meta: metaFor(bundle) });
    })
  );
  models.command("query").argument("<query>", "model search query").description("search public models with the models query endpoint").option("--limit <number>", "limit returned results").action(
    action("models", async (command, query: string) => {
      const bundle = await clientFor(command);
      const data = (await bundle.client.request("QUERY", "/models", {
        rawBody: query,
        headers: { "Content-Type": "text/plain" }
      })).data as Record<string, any>;
      if (command.opts().limit && Array.isArray(data.results)) {
        data.results = data.results.slice(0, Number(command.opts().limit));
      }
      return asResult("models", data, { meta: metaFor(bundle) });
    })
  );
  models.command("get").argument("<owner/name>", "model ref").description("get a model").action(
    action("model", async (command, value: string) => {
      const bundle = await clientFor(command);
      const ref = parseOwnerName(value, "model");
      return asResult("model", (await bundle.client.request("GET", `/models/${ref.owner}/${ref.name}`)).data, {
        meta: metaFor(bundle)
      });
    })
  );
  models.command("readme").argument("<owner/name>", "model ref").description("get model README").action(
    action("model-readme", async (command, value: string) => {
      const bundle = await clientFor(command);
      const ref = parseOwnerName(value, "model");
      return asResult("model-readme", (await bundle.client.request("GET", `/models/${ref.owner}/${ref.name}/readme`)).data, {
        meta: metaFor(bundle)
      });
    })
  );
  models.command("examples").argument("<owner/name>", "model ref").description("list model examples").action(
    action("model-examples", async (command, value: string) => {
      const bundle = await clientFor(command);
      const ref = parseOwnerName(value, "model");
      return asResult("model-examples", (await bundle.client.request("GET", `/models/${ref.owner}/${ref.name}/examples`)).data, {
        meta: metaFor(bundle)
      });
    })
  );
  models.command("create").argument("<owner/name>", "model ref").description("create a model").option("--visibility <value>", "public or private").option("--hardware <sku>", "hardware sku").option("--description <text>", "description").option("--cover-image-url <url>", "cover image URL").option("--github-url <url>", "GitHub URL").option("--license-url <url>", "license URL").option("--paper-url <url>", "paper URL").option("--body-json <path>", "raw body JSON").option("--dry-run", "preview request").option("--confirm", "confirm creation").action(
    action("model", async (command, value: string) => modelWrite(command, "POST", value, "Create model"))
  );
  models.command("update").argument("<owner/name>", "model ref").description("update model metadata").option("--description <text>", "description").option("--github-url <url>", "GitHub URL").option("--license-url <url>", "license URL").option("--paper-url <url>", "paper URL").option("--readme <text>", "README text").option("--weights-url <url>", "weights URL").option("--body-json <path>", "raw body JSON").option("--dry-run", "preview request").option("--confirm", "confirm update").action(
    action("model", async (command, value: string) => modelWrite(command, "PATCH", value, "Update model"))
  );
  models.command("delete").argument("<owner/name>", "model ref").description("delete a model").option("--dry-run", "preview deletion").option("--confirm", "confirm deletion").action(
    action("model", async (command, value: string) => {
      const opts = command.opts();
      assertConfirm(opts.confirm, "Delete model", opts.dryRun);
      const bundle = await clientFor(command, !opts.dryRun);
      const ref = parseOwnerName(value, "model");
      const path = `/models/${ref.owner}/${ref.name}`;
      if (opts.dryRun) return asResult("model", requestPreview("DELETE", path), { meta: metaFor(bundle) });
      return asResult("model", (await bundle.client.request("DELETE", path)).data, { meta: metaFor(bundle) });
    })
  );

  registerVersions(root);
  registerSchema(root);
}

function registerVersions(root: Command): void {
  const versions = root.command("versions").description("model version commands");
  versions.command("list").argument("<owner/name>", "model ref").description("list model versions").action(
    action("versions", async (command, value: string) => {
      const bundle = await clientFor(command);
      const ref = parseOwnerName(value, "model");
      return asResult("versions", (await bundle.client.request("GET", `/models/${ref.owner}/${ref.name}/versions`)).data, {
        meta: metaFor(bundle)
      });
    })
  );
  versions.command("get").argument("<owner/name:version>", "model version ref").description("get a model version").action(
    action("version", async (command, value: string) => {
      const bundle = await clientFor(command);
      const ref = parseModelRef(value);
      throwIfMissing(ref.version, "version");
      return asResult("version", (await bundle.client.request("GET", `/models/${ref.owner}/${ref.name}/versions/${ref.version}`)).data, {
        meta: metaFor(bundle)
      });
    })
  );
  versions.command("delete").argument("<owner/name:version>", "model version ref").description("delete a model version").option("--dry-run", "preview deletion").option("--confirm", "confirm deletion").action(
    action("version", async (command, value: string) => {
      const opts = command.opts();
      assertConfirm(opts.confirm, "Delete model version", opts.dryRun);
      const bundle = await clientFor(command, !opts.dryRun);
      const ref = parseModelRef(value);
      throwIfMissing(ref.version, "version");
      const path = `/models/${ref.owner}/${ref.name}/versions/${ref.version}`;
      if (opts.dryRun) return asResult("version", requestPreview("DELETE", path), { meta: metaFor(bundle) });
      return asResult("version", (await bundle.client.request("DELETE", path)).data, { meta: metaFor(bundle) });
    })
  );
}

function registerSchema(root: Command): void {
  root.command("schema").argument("<owner/name>", "model ref").description("show simplified model input schema").option("--version <id>", "version id").option("--raw", "emit raw OpenAPI schema").action(
    action("schema", async (command, value: string) => {
      const bundle = await clientFor(command);
      const ref = parseOwnerName(value, "model");
      const data = command.opts().version
        ? ((await bundle.client.request("GET", `/models/${ref.owner}/${ref.name}/versions/${command.opts().version}`)).data as Record<string, any>)
        : ((await bundle.client.request("GET", `/models/${ref.owner}/${ref.name}`)).data as Record<string, any>);
      const openapi = command.opts().version ? data.openapi_schema : data.latest_version?.openapi_schema;
      if (!openapi) {
        throw new CliError("schema_missing", "Model schema is not available.", { details: data });
      }
      return asResult("schema", command.opts().raw ? openapi : simplifyOpenApiSchema(openapi), {
        meta: { ...metaFor(bundle), model: value, version: command.opts().version ?? data.latest_version?.id }
      });
    })
  );
}

async function modelWrite(command: Command, method: "POST" | "PATCH", value: string, actionName: string): Promise<unknown> {
  const opts = command.opts();
  assertConfirm(opts.confirm, actionName, opts.dryRun);
  const bundle = await clientFor(command, !opts.dryRun);
  const ref = parseOwnerName(value, "model");
  const body = await bodyFromOptions(
    opts,
    method === "POST"
      ? {
          owner: ref.owner,
          name: ref.name,
          visibility: opts.visibility,
          hardware: opts.hardware,
          description: opts.description,
          cover_image_url: opts.coverImageUrl,
          github_url: opts.githubUrl,
          license_url: opts.licenseUrl,
          paper_url: opts.paperUrl
        }
      : {
          description: opts.description,
          github_url: opts.githubUrl,
          license_url: opts.licenseUrl,
          paper_url: opts.paperUrl,
          readme: opts.readme,
          weights_url: opts.weightsUrl
        }
  );
  const path = method === "POST" ? "/models" : `/models/${ref.owner}/${ref.name}`;
  if (opts.dryRun) return asResult("model", requestPreview(method, path, body), { meta: metaFor(bundle) });
  return asResult("model", (await bundle.client.request(method, path, { body })).data, { meta: metaFor(bundle) });
}

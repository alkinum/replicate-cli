import { Command } from "commander";
import { assertConfirm } from "../lib/errors.js";
import { asResult } from "../lib/output.js";
import { parseOwnerName } from "../lib/parse.js";
import { action, bodyFromOptions, clientFor, metaFor, requestPreview } from "./shared.js";

export function registerDeployments(root: Command): void {
  const deployments = root.command("deployments").description("deployment commands");
  deployments.command("list").description("list deployments").action(
    action("deployments", async (command) => {
      const bundle = await clientFor(command);
      return asResult("deployments", (await bundle.client.request("GET", "/deployments")).data, {
        meta: metaFor(bundle)
      });
    })
  );
  deployments.command("get").argument("<owner/name>", "deployment ref").description("get a deployment").action(
    action("deployment", async (command, refValue: string) => {
      const bundle = await clientFor(command);
      const ref = parseOwnerName(refValue, "deployment");
      return asResult("deployment", (await bundle.client.request("GET", `/deployments/${ref.owner}/${ref.name}`)).data, {
        meta: metaFor(bundle)
      });
    })
  );
  deployments.command("create").description("create a deployment").argument("<owner/name>", "deployment ref").option("--model <owner/name>", "model ref").option("--version <id>", "version id").option("--hardware <sku>", "hardware sku").option("--min-instances <n>", "minimum instances").option("--max-instances <n>", "maximum instances").option("--body-json <path>", "raw body JSON").option("--dry-run", "preview request").option("--confirm", "confirm creation").action(
    action("deployment", async (command, refValue: string) => deploymentWrite(command, "POST", refValue, "Create deployment"))
  );
  deployments.command("update").description("update a deployment").argument("<owner/name>", "deployment ref").option("--version <id>", "version id").option("--hardware <sku>", "hardware sku").option("--min-instances <n>", "minimum instances").option("--max-instances <n>", "maximum instances").option("--body-json <path>", "raw body JSON").option("--dry-run", "preview request").option("--confirm", "confirm update").action(
    action("deployment", async (command, refValue: string) => deploymentWrite(command, "PATCH", refValue, "Update deployment"))
  );
  deployments.command("delete").argument("<owner/name>", "deployment ref").description("delete a deployment").option("--dry-run", "preview deletion").option("--confirm", "confirm deletion").action(
    action("deployment", async (command, refValue: string) => {
      const opts = command.opts();
      assertConfirm(opts.confirm, "Delete deployment", opts.dryRun);
      const bundle = await clientFor(command, !opts.dryRun);
      const ref = parseOwnerName(refValue, "deployment");
      const path = `/deployments/${ref.owner}/${ref.name}`;
      if (opts.dryRun) return asResult("deployment", requestPreview("DELETE", path), { meta: metaFor(bundle) });
      return asResult("deployment", (await bundle.client.request("DELETE", path)).data, { meta: metaFor(bundle) });
    })
  );
}

async function deploymentWrite(command: Command, method: "POST" | "PATCH", refValue: string, actionName: string): Promise<unknown> {
  const opts = command.opts();
  assertConfirm(opts.confirm, actionName, opts.dryRun);
  const bundle = await clientFor(command, !opts.dryRun);
  const ref = parseOwnerName(refValue, "deployment");
  const scaling = {
    hardware: opts.hardware,
    min_instances: opts.minInstances === undefined ? undefined : Number(opts.minInstances),
    max_instances: opts.maxInstances === undefined ? undefined : Number(opts.maxInstances)
  };
  const body = await bodyFromOptions(
    opts,
    method === "POST"
      ? {
          name: ref.name,
          model: opts.model,
          version: opts.version,
          ...scaling
        }
      : {
          version: opts.version,
          ...scaling
        }
  );
  const path = method === "POST" ? "/deployments" : `/deployments/${ref.owner}/${ref.name}`;
  if (opts.dryRun) return asResult("deployment", requestPreview(method, path, body), { meta: metaFor(bundle) });
  return asResult("deployment", (await bundle.client.request(method, path, { body })).data, { meta: metaFor(bundle) });
}

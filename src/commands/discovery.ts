import { Command } from "commander";
import { asResult } from "../lib/output.js";
import { action, clientFor, metaFor } from "./shared.js";

export function registerDiscovery(root: Command): void {
  root
    .command("search")
    .description("search public models, collections, and docs")
    .argument("<query>", "search query")
    .option("--limit <number>", "maximum model results, 1-50", "20")
    .action(
      action("search", async (command, query: string) => {
        const bundle = await clientFor(command);
        const response = await bundle.client.request("GET", "/search", {
          query: { query, limit: Number(command.opts().limit) }
        });
        return asResult("search", response.data, { meta: { ...metaFor(bundle), beta: true } });
      })
    );

  const collections = root.command("collections").description("model collection commands");
  collections
    .command("list")
    .description("list model collections")
    .option("--limit <number>", "limit returned results")
    .action(
      action("collections", async (command) => {
        const bundle = await clientFor(command);
        const data = (await bundle.client.request("GET", "/collections")).data as Record<string, any>;
        if (command.opts().limit && Array.isArray(data.results)) {
          data.results = data.results.slice(0, Number(command.opts().limit));
        }
        return asResult("collections", data, { meta: metaFor(bundle) });
      })
    );
  collections
    .command("get")
    .argument("<slug>", "collection slug")
    .description("get a model collection")
    .action(
      action("collection", async (command, slug: string) => {
        const bundle = await clientFor(command);
        return asResult("collection", (await bundle.client.request("GET", `/collections/${slug}`)).data, {
          meta: metaFor(bundle)
        });
      })
    );
}

export function registerHardware(root: Command): void {
  root.command("hardware").description("hardware commands").command("list").description("list available hardware").action(
    action("hardware", async (command) => {
      const bundle = await clientFor(command);
      return asResult("hardware", (await bundle.client.request("GET", "/hardware")).data, { meta: metaFor(bundle) });
    })
  );
}

export function registerWebhooks(root: Command): void {
  root.command("webhooks").description("webhook commands").command("secret").description("get default webhook signing secret").action(
    action("webhook-secret", async (command) => {
      const bundle = await clientFor(command);
      return asResult("webhook-secret", (await bundle.client.request("GET", "/webhooks/default/secret")).data, {
        meta: metaFor(bundle)
      });
    })
  );
}

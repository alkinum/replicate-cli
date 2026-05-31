import { Command } from "commander";
import { assertConfirm } from "../lib/errors.js";
import { downloadArtifacts } from "../lib/files.js";
import { asResult, throwIfMissing } from "../lib/output.js";
import { parseModelRef } from "../lib/parse.js";
import { waitForResource } from "../lib/predictions.js";
import { action, addInputOptions, addWriteSafety, buildInput, clientFor, metaFor, requestPaginated, requestPreview } from "./shared.js";

export function registerTrainings(root: Command): void {
  const trainings = root.command("trainings").description("training commands");
  const create = addInputOptions(addWriteSafety(trainings.command("create").description("create a training")));
  create
    .argument("<model-version>", "owner/model:version")
    .requiredOption("--destination <owner/model>", "destination model")
    .option("--webhook <url>", "webhook URL")
    .option("--webhook-events <events>", "comma-separated webhook event filter")
    .option("--async", "return immediately after creating training")
    .action(
      action("training", async (command, modelVersion: string) => {
        const opts = command.opts();
        assertConfirm(opts.confirm, "Create training", opts.dryRun);
        const bundle = await clientFor(command, !opts.dryRun);
        const ref = parseModelRef(modelVersion);
        throwIfMissing(ref.version, "model-version version");
        const input = await buildInput(opts, bundle.client, opts.dryRun);
        const body = {
          input,
          destination: opts.destination,
          webhook: opts.webhook,
          webhook_events_filter: opts.webhookEvents?.split(",").map((item: string) => item.trim())
        };
        const path = `/models/${ref.owner}/${ref.name}/versions/${ref.version}/trainings`;
        if (opts.dryRun) return asResult("training", requestPreview("POST", path, body), { meta: metaFor(bundle) });
        return asResult("training", (await bundle.client.request("POST", path, { body })).data, {
          meta: metaFor(bundle)
        });
      })
    );
  trainings.command("list").description("list trainings").option("--limit <number>", "limit returned results").action(
    action("trainings", async (command) => {
      const bundle = await clientFor(command);
      const data = await requestPaginated(bundle.client, "/trainings", { limit: command.opts().limit });
      return asResult("trainings", data, { meta: metaFor(bundle) });
    })
  );
  trainings.command("get").argument("<id>", "training id").description("get a training").action(
    action("training", async (command, id: string) => {
      const bundle = await clientFor(command);
      return asResult("training", (await bundle.client.request("GET", `/trainings/${id}`)).data, {
        meta: metaFor(bundle)
      });
    })
  );
  trainings.command("wait").argument("<id>", "training id").description("wait for a training").option("--poll-interval <duration>", "poll interval", "5s").option("--timeout <duration>", "wait timeout", "2h").option("-o, --output <dir>", "download training output files to directory").action(
    action("training", async (command, id: string) => {
      const bundle = await clientFor(command);
      const data = await waitForResource({
        client: bundle.client,
        path: `/trainings/${id}`,
        pollInterval: command.opts().pollInterval,
        timeout: command.opts().timeout,
        type: "training"
      });
      const artifacts = command.opts().output
        ? await downloadArtifacts({
            output: data.output,
            predictionId: String(data.id ?? id),
            outputDir: command.opts().output,
            token: bundle.auth.token,
            timeoutMs: bundle.timeoutMs,
            manifest: {
              input: data.input,
              model: data.model,
              version: data.version,
              type: "training"
            }
          })
        : undefined;
      return asResult("training", data, { artifacts, meta: metaFor(bundle) });
    })
  );
  trainings.command("cancel").argument("<id>", "training id").description("cancel a training").option("--dry-run", "preview cancellation").option("--confirm", "confirm cancellation").action(
    action("training", async (command, id: string) => {
      const opts = command.opts();
      assertConfirm(opts.confirm, "Cancel training", opts.dryRun);
      const bundle = await clientFor(command, !opts.dryRun);
      const path = `/trainings/${id}/cancel`;
      if (opts.dryRun) return asResult("training", requestPreview("POST", path), { meta: metaFor(bundle) });
      return asResult("training", (await bundle.client.request("POST", path)).data, { meta: metaFor(bundle) });
    })
  );
}

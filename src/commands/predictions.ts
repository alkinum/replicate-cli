import { Command } from "commander";
import { downloadArtifacts } from "../lib/files.js";
import { asResult } from "../lib/output.js";
import { waitForResource } from "../lib/predictions.js";
import {
  action,
  addInputOptions,
  buildInput,
  clientFor,
  createPrediction,
  maybeDownloadPredictionOutput,
  metaFor,
  requestPaginated,
  validatePredictionInput
} from "./shared.js";
import { assertConfirm, CliError } from "../lib/errors.js";

export function registerPredictions(root: Command): void {
  const run = addInputOptions(root.command("run").description("run a Replicate model or deployment"));
  run
    .argument("[model]", "model ref owner/name or owner/name:version")
    .option("--version <version>", "explicit version id or owner/model:version")
    .option("--deployment <owner/name>", "deployment ref")
    .option("--sync", "wait for output using Prefer: wait", true)
    .option("--async", "return immediately after creating prediction")
    .option("--wait <seconds>", "sync wait seconds", "60")
    .option("--deadline <duration>", "Cancel-After duration")
    .option("--webhook <url>", "webhook URL")
    .option("--webhook-events <events>", "comma-separated webhook event filter")
    .option("-o, --output <dir>", "download output files to directory")
    .option("--validate-schema", "fetch model schema and validate inputs before creating prediction")
    .option("--dry-run", "preview request without creating prediction")
    .action(
      action("prediction", async (command, model?: string) => {
        const opts = command.opts();
        const initialBundle = await clientFor(command, !opts.dryRun);
        const input = await buildInput(opts, initialBundle.client, opts.dryRun);
        await validatePredictionInput(command, {
          model,
          version: opts.version,
          deployment: opts.deployment,
          input,
          validateSchema: opts.validateSchema
        });
        const created = await createPrediction(command, {
          model,
          version: opts.version,
          deployment: opts.deployment,
          input,
          sync: !opts.async,
          wait: opts.wait,
          deadline: opts.deadline,
          webhook: opts.webhook,
          webhookEvents: opts.webhookEvents,
          dryRun: opts.dryRun
        });
        const withArtifacts = await maybeDownloadPredictionOutput(created.data, {
          output: opts.output,
          bundle: created.bundle
        });
        return asResult("prediction", withArtifacts.data, {
          artifacts: withArtifacts.artifacts,
          meta: metaFor(created.bundle)
        });
      })
    );

  const predictions = root.command("predictions").description("prediction commands");
  const create = addInputOptions(predictions.command("create").description("create a prediction"));
  create
    .option("--model <owner/name>", "official model ref")
    .option("--version <version>", "version id or owner/model:version")
    .option("--deployment <owner/name>", "deployment ref")
    .option("--sync", "wait for output using Prefer: wait")
    .option("--wait <seconds>", "sync wait seconds", "60")
    .option("--deadline <duration>", "Cancel-After duration")
    .option("--webhook <url>", "webhook URL")
    .option("--webhook-events <events>", "comma-separated webhook event filter")
    .option("-o, --output <dir>", "download output files to directory")
    .option("--validate-schema", "fetch model schema and validate inputs before creating prediction")
    .option("--dry-run", "preview request without creating prediction")
    .action(
      action("prediction", async (command) => {
        const opts = command.opts();
        const initialBundle = await clientFor(command, !opts.dryRun);
        const input = await buildInput(opts, initialBundle.client, opts.dryRun);
        await validatePredictionInput(command, {
          model: opts.model,
          version: opts.version,
          deployment: opts.deployment,
          input,
          validateSchema: opts.validateSchema
        });
        const created = await createPrediction(command, {
          model: opts.model,
          version: opts.version,
          deployment: opts.deployment,
          input,
          sync: opts.sync,
          wait: opts.wait,
          deadline: opts.deadline,
          webhook: opts.webhook,
          webhookEvents: opts.webhookEvents,
          dryRun: opts.dryRun
        });
        const withArtifacts = await maybeDownloadPredictionOutput(created.data, {
          output: opts.output,
          bundle: created.bundle
        });
        return asResult("prediction", withArtifacts.data, {
          artifacts: withArtifacts.artifacts,
          meta: metaFor(created.bundle)
        });
      })
    );

  predictions.command("get").argument("<id>", "prediction id").description("get a prediction").action(
    action("prediction", async (command, id: string) => {
      const bundle = await clientFor(command);
      return asResult("prediction", (await bundle.client.request("GET", `/predictions/${id}`)).data, {
        meta: metaFor(bundle)
      });
    })
  );

  predictions.command("list").description("list predictions").option("--limit <number>", "limit returned results").option("--source <source>", "filter source, currently web").option("--created-after <iso>", "created after ISO date-time").option("--created-before <iso>", "created before ISO date-time").action(
    action("predictions", async (command) => {
      const bundle = await clientFor(command);
      const opts = command.opts();
      const data = await requestPaginated(bundle.client, "/predictions", {
        limit: opts.limit,
        query: {
          source: opts.source,
          created_after: opts.createdAfter,
          created_before: opts.createdBefore
        }
      });
      return asResult("predictions", data, { meta: metaFor(bundle) });
    })
  );

  predictions.command("wait").argument("<id>", "prediction id").description("wait until a prediction reaches a terminal status").option("--poll-interval <duration>", "poll interval", "2s").option("--timeout <duration>", "wait timeout").option("-o, --output <dir>", "download output files to directory").action(
    action("prediction", async (command, id: string) => {
      const bundle = await clientFor(command);
      const data = await waitForResource({
        client: bundle.client,
        path: `/predictions/${id}`,
        pollInterval: command.opts().pollInterval,
        timeout: command.opts().timeout,
        type: "prediction"
      });
      const withArtifacts = await maybeDownloadPredictionOutput(data, {
        output: command.opts().output,
        bundle
      });
      return asResult("prediction", withArtifacts.data, {
        artifacts: withArtifacts.artifacts,
        meta: metaFor(bundle)
      });
    })
  );

  predictions.command("cancel").argument("<id>", "prediction id").description("cancel a running prediction").option("--dry-run", "preview cancellation").option("--confirm", "confirm cancellation").action(
    action("prediction", async (command, id: string) => {
      const opts = command.opts();
      assertConfirm(opts.confirm, "Cancel prediction", opts.dryRun);
      const bundle = await clientFor(command, !opts.dryRun);
      const path = `/predictions/${id}/cancel`;
      if (opts.dryRun) return asResult("prediction", { method: "POST", path }, { meta: metaFor(bundle) });
      return asResult("prediction", (await bundle.client.request("POST", path)).data, { meta: metaFor(bundle) });
    })
  );
}

export function registerOutputs(root: Command): void {
  const outputs = root.command("outputs").description("prediction output commands");
  outputs.command("download").argument("<prediction-id>", "prediction id").description("download output files for a prediction").requiredOption("-o, --output <dir>", "output directory").action(
    action("artifacts", async (command, id: string) => {
      const bundle = await clientFor(command);
      const prediction = (await bundle.client.request("GET", `/predictions/${id}`)).data as Record<string, any>;
      if (prediction.data_removed || prediction.output === undefined || prediction.output === null) {
        throw new CliError(
          "prediction_output_unavailable",
          "Prediction output is not available. Replicate may have removed the output data; download outputs soon after completion.",
          { exitCode: 4, details: prediction }
        );
      }
      const artifacts = await downloadArtifacts({
        output: prediction.output,
        predictionId: String(prediction.id ?? id),
        outputDir: command.opts().output,
        token: bundle.auth.token,
        timeoutMs: bundle.timeoutMs,
        manifest: { model: prediction.model, version: prediction.version, type: "prediction" }
      });
      return asResult("artifacts", { prediction, artifacts }, { artifacts, meta: metaFor(bundle) });
    })
  );

  outputs.command("print").argument("<prediction-id>", "prediction id").description("print raw output for a prediction").action(
    action("output", async (command, id: string) => {
      const bundle = await clientFor(command);
      const prediction = (await bundle.client.request("GET", `/predictions/${id}`)).data as Record<string, any>;
      return asResult("output", prediction.output, { meta: metaFor(bundle) });
    })
  );
}

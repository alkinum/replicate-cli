import { Command } from "commander";
import { fileInputValue, normalizeFileMode } from "../lib/files.js";
import { asResult } from "../lib/output.js";
import { absolutePath } from "../lib/parse.js";
import {
  action,
  addInputOptions,
  buildInput,
  clientFor,
  createPrediction,
  maybeDownloadPredictionOutput,
  metaFor
} from "./shared.js";

export function registerShortcuts(root: Command): void {
  const image = root.command("image").description("image generation shortcuts");
  const imageGenerate = addInputOptions(image.command("generate").description("generate an image"));
  imageGenerate.argument("[prompt]", "prompt").requiredOption("--model <owner/name>", "model ref").option("-o, --output <dir>", "output directory").option("--async", "return immediately").option("--wait <seconds>", "sync wait seconds", "60").option("--dry-run", "preview request").action(
    action("prediction", async (command, prompt?: string) => {
      const opts = command.opts();
      const initialBundle = await clientFor(command, !opts.dryRun);
      const input = await buildInput(opts, initialBundle.client, opts.dryRun);
      if (prompt) input.prompt = prompt;
      const created = await createPrediction(command, {
        model: opts.model,
        input,
        sync: !opts.async,
        wait: opts.wait,
        dryRun: opts.dryRun
      });
      const withArtifacts = await maybeDownloadPredictionOutput(created.data, { output: opts.output, bundle: created.bundle });
      return asResult("prediction", withArtifacts.data, { artifacts: withArtifacts.artifacts, meta: metaFor(created.bundle) });
    })
  );
  const imageEdit = addInputOptions(image.command("edit").description("edit an image"));
  imageEdit.requiredOption("--model <owner/name>", "model ref").requiredOption("--image <path>", "input image").option("--prompt <text>", "edit prompt").option("-o, --output <dir>", "output directory").option("--async", "return immediately").option("--dry-run", "preview request").action(
    action("prediction", async (command) => {
      const opts = command.opts();
      const initialBundle = await clientFor(command, !opts.dryRun);
      const input = await buildInput(opts, initialBundle.client, opts.dryRun);
      const fileMode = normalizeFileMode(opts.fileMode);
      input.image = opts.dryRun
        ? { file: absolutePath(opts.image), mode: fileMode }
        : await fileInputValue(initialBundle.client, opts.image, fileMode);
      if (opts.prompt) input.prompt = opts.prompt;
      const created = await createPrediction(command, {
        model: opts.model,
        input,
        sync: !opts.async,
        wait: opts.wait,
        dryRun: opts.dryRun
      });
      const withArtifacts = await maybeDownloadPredictionOutput(created.data, { output: opts.output, bundle: created.bundle });
      return asResult("prediction", withArtifacts.data, { artifacts: withArtifacts.artifacts, meta: metaFor(created.bundle) });
    })
  );

  for (const noun of ["video", "audio"] as const) {
    const group = root.command(noun).description(`${noun} generation shortcuts`);
    const command = addInputOptions(group.command("generate").description(`generate ${noun}`));
    command.argument("[prompt]", "prompt").requiredOption("--model <owner/name>", "model ref").option("-o, --output <dir>", "output directory").option("--async", "return immediately").option("--wait <seconds>", "sync wait seconds", noun === "video" ? "10" : "60").option("--dry-run", "preview request").action(
      action("prediction", async (cmd, prompt?: string) => {
        const opts = cmd.opts();
        const initialBundle = await clientFor(cmd, !opts.dryRun);
        const input = await buildInput(opts, initialBundle.client, opts.dryRun);
        if (prompt) input.prompt = prompt;
        const created = await createPrediction(cmd, {
          model: opts.model,
          input,
          sync: !opts.async,
          wait: opts.wait,
          dryRun: opts.dryRun
        });
        const withArtifacts = await maybeDownloadPredictionOutput(created.data, { output: opts.output, bundle: created.bundle });
        return asResult("prediction", withArtifacts.data, { artifacts: withArtifacts.artifacts, meta: metaFor(created.bundle) });
      })
    );
  }
}

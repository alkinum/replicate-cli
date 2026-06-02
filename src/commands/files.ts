import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { CliError, assertConfirm } from "../lib/errors.js";
import { uploadFile } from "../lib/files.js";
import { asResult } from "../lib/output.js";
import { readJsonFile } from "../lib/parse.js";
import { action, clientFor, metaFor, requestPaginated } from "./shared.js";

export function registerFiles(root: Command): void {
  const files = root.command("files").description("Replicate file commands");
  files.command("list").description("list files").option("--limit <number>", "limit returned results").action(
    action("files", async (command) => {
      const bundle = await clientFor(command);
      const data = await requestPaginated(bundle.client, "/files", { limit: command.opts().limit });
      return asResult("files", data, { meta: metaFor(bundle) });
    })
  );
  files.command("upload").argument("<path>", "file path").description("upload a file").option("--metadata-json <path>", "metadata JSON").action(
    action("file", async (command, path: string) => {
      const bundle = await clientFor(command);
      const metadata = command.opts().metadataJson
        ? ((await readJsonFile(command.opts().metadataJson)) as Record<string, unknown>)
        : undefined;
      return asResult("file", await uploadFile(bundle.client, path, { metadata }), { meta: metaFor(bundle) });
    })
  );
  files.command("get").argument("<id>", "file id").description("get a file").action(
    action("file", async (command, id: string) => {
      const bundle = await clientFor(command);
      return asResult("file", (await bundle.client.request("GET", `/files/${id}`)).data, { meta: metaFor(bundle) });
    })
  );
  files.command("download").argument("<signed-url>", "signed file download URL").description("download a file").requiredOption("-o, --output <path>", "output path").action(
    action("file", async (command, idOrUrl: string) => {
      if (!/^https?:\/\//.test(idOrUrl)) {
        throw new CliError(
          "file_download_url_required",
          "File downloads require a signed Replicate file download URL, not a bare file ID."
        );
      }
      const bundle = await clientFor(command, false);
      const url = idOrUrl;
      const response = await fetch(url, {
        headers: bundle.auth.token ? { Authorization: `Bearer ${bundle.auth.token}` } : undefined,
        signal: AbortSignal.timeout(bundle.timeoutMs ?? 120_000)
      });
      if (!response.ok) {
        throw new CliError("file_download_failed", `Failed to download file: HTTP ${response.status}`, {
          status: response.status,
          exitCode: 5
        });
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const outputPath = resolve(command.opts().output);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, bytes);
      return asResult(
        "file",
        {
          path: outputPath,
          bytes: bytes.byteLength,
          contentType: response.headers.get("content-type")
        },
        { meta: metaFor(bundle) }
      );
    })
  );
  files.command("delete").argument("<id>", "file id").description("delete a file").option("--dry-run", "preview deletion").option("--confirm", "confirm deletion").action(
    action("file", async (command, id: string) => {
      const opts = command.opts();
      assertConfirm(opts.confirm, "Delete file", opts.dryRun);
      const bundle = await clientFor(command, !opts.dryRun);
      const path = `/files/${id}`;
      if (opts.dryRun) return asResult("file", { method: "DELETE", path }, { meta: metaFor(bundle) });
      return asResult("file", (await bundle.client.request("DELETE", path)).data, { meta: metaFor(bundle) });
    })
  );
}

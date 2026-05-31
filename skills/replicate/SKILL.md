---
name: replicate
description: Use the local replicate command to work with Replicate: verify auth, search models, inspect schemas, run predictions, poll async jobs, download generated artifacts, manage files/deployments/trainings, and use raw API calls safely.
---

# Replicate CLI

Use the local `replicate` command for Replicate model discovery, schema inspection, predictions, polling, and artifact downloads.

## Start

First verify the command and auth state:

```bash
command -v replicate
replicate --json doctor
```

Auth order is `--token`, `REPLICATE_API_TOKEN`, then stored config. Never print full tokens. Stored config lives under the platform config directory: `%APPDATA%\alkinum\replicate` on Windows, `~/Library/Application Support/alkinum/replicate` on macOS, and `$XDG_CONFIG_HOME/alkinum/replicate` or `~/.config/alkinum/replicate` on Linux/Unix.

```bash
replicate auth status --json
replicate auth set --token "$REPLICATE_API_TOKEN"
```

## Discovery

Search and inspect before running a model:

```bash
replicate --json search "text to image" --limit 5
replicate --json models get owner/model
replicate --json versions list owner/model --limit 5
replicate --json schema owner/model
```

Use `schema --raw` only when the simplified schema is insufficient. Prefer a concrete `owner/model` and save the model/version identifiers you choose.

## Generate

Always dry-run a new model or expensive input before spending credits:

```bash
replicate --json run owner/model --input prompt="a clean product render" --validate-schema --dry-run
replicate --json run owner/model --input prompt="a clean product render" --output ./out
```

For long jobs, submit async, save the prediction ID, then wait/download:

```bash
replicate --json run owner/model --input-json input.json --async
replicate --json predictions wait <prediction-id> --output ./out
```

Use `--output <dir>` when the model may return files. The CLI downloads generated URLs and writes a `manifest.json`.

Shortcut commands are thin wrappers around `run`; use them when the model input shape is obvious:

```bash
replicate --json image generate --model owner/model "a cinematic product photo" --output ./out
replicate --json video generate --model owner/model "a wide establishing shot" --async
```

## Files

For local file inputs, use `--input-file key=path`; the CLI chooses data URL or upload automatically. Do not inline large binary data manually.

```bash
replicate --json run owner/model --input prompt="edit this" --input-file image=./input.png --output ./out
```

Generated files are downloaded with:

```bash
replicate --json outputs download <prediction-id> --output ./out
```

## Writes

Do not create trainings, update/delete deployments, delete models/versions/files, cancel jobs, or run raw non-GET API requests unless the user explicitly asked. Use `--dry-run` first and `--confirm` for live writes.

```bash
replicate --json deployments create owner/name --model owner/model --version <version-id> --hardware <sku> --dry-run
replicate --json api GET /account
replicate --json api POST /predictions --body-json request.json --dry-run
```

If a command fails under `--json`, read `error.code`, `error.message`, `status`, and `retryAfterSeconds`; do not scrape human text.

# @alkinum/replicate-cli

AI-first Replicate CLI for model discovery, schema inspection, predictions, artifact downloads, and resource management.

This project is implemented in TypeScript and follows a `create-typescript-cli`-style structure with `tsup`, `commander`, strict TypeScript, and normal npm bin entries.

## Install

```bash
pnpm install
pnpm build
pnpm link --global
```

The package exposes:

```bash
replicate --help
```

## Auth

Auth resolution order:

1. `--token <token>`
2. `REPLICATE_API_TOKEN`
3. Stored config profile

```bash
replicate auth set --token "$REPLICATE_API_TOKEN"
replicate --json doctor
replicate auth status --json
```

Tokens are redacted in output.

Default config path:

- Windows: `%APPDATA%\alkinum\replicate\config.json`
- macOS: `~/Library/Application Support/alkinum/replicate/config.json`
- Linux/Unix: `$XDG_CONFIG_HOME/alkinum/replicate/config.json`, or `~/.config/alkinum/replicate/config.json`

The CLI creates the config directory recursively when it reads or writes local config.

## JSON Policy

Every command supports `--json` and returns a stable envelope:

```json
{
  "ok": true,
  "type": "prediction",
  "data": {},
  "artifacts": [],
  "meta": {
    "cliVersion": "0.1.0",
    "authSource": "env"
  }
}
```

Errors are machine-readable:

```json
{
  "ok": false,
  "error": {
    "code": "replicate_rate_limited",
    "message": "Request was rate limited",
    "status": 429
  }
}
```

## Common Agent Flow

```bash
replicate --json doctor
replicate --json search "text to image" --limit 5
replicate --json schema black-forest-labs/flux-schnell
replicate --json run black-forest-labs/flux-schnell --input prompt="a product photo" --validate-schema --output ./out
```

Async flow:

```bash
replicate --json run black-forest-labs/flux-schnell --input prompt="a poster" --async
replicate --json predictions wait <prediction-id> --output ./out
```

## Commands

Discovery:

```bash
replicate --json search "image editing" --limit 10
replicate --json collections list
replicate --json models list --limit 20
replicate --json models query "text to image" --limit 10
replicate --json models get owner/model
replicate --json models examples owner/model --limit 10
replicate --json versions list owner/model --limit 20
replicate --json schema owner/model
```

Predictions and outputs:

```bash
replicate --json predictions create --model owner/model --input-json input.json --async
replicate --json predictions create --model owner/model --input-json input.json --validate-schema --dry-run
replicate --json predictions get <id>
replicate --json predictions wait <id> --output ./out
replicate --json predictions cancel <id> --confirm
replicate --json outputs download <id> --output ./out
```

Files:

```bash
replicate --json files upload ./input.png
replicate --json files list
replicate --json files get <file-id>
replicate --json files download '<signed-file-download-url>' --output ./download.bin
replicate --json files delete <file-id> --confirm
```

Training and deployments:

```bash
replicate --json trainings create owner/model:version --destination owner/new-model --input-json train.json --dry-run
replicate --json trainings wait <training-id> --output ./out
replicate --json deployments list --limit 20
replicate --json deployments create owner/name --model owner/model --version <version-id> --hardware <sku> --dry-run
```

Management:

```bash
replicate --json hardware list
replicate --json webhooks secret
replicate --json models create owner/model --visibility private --dry-run
replicate --json versions delete owner/model:version --dry-run
replicate --json versions delete owner/model:version --confirm
```

Raw escape hatch:

```bash
replicate --json api GET /account
replicate --json api POST /predictions --body-json request.json --dry-run
```

Raw non-GET requests require `--confirm` unless `--dry-run` is used.

## Shortcut Commands

Shortcuts are thin wrappers around `run`:

```bash
replicate --json image generate --model owner/model "a cinematic product photo" --output ./out
replicate --json image edit --model owner/model --image ./input.png --prompt "make it neon" --output ./out
replicate --json video generate --model owner/model "a wide establishing shot" --async
replicate --json audio generate --model owner/model --input-json input.json --output ./out
```

## Companion Skill

The bundled Codex skill lives at:

```text
skills/replicate/SKILL.md
```

Print or install it:

```bash
replicate skill print
replicate skill install --target ~/.codex/skills/replicate
```

## Development

```bash
pnpm dev -- --help
pnpm check
pnpm typecheck
pnpm test
pnpm build
pnpm release:dry-run
pnpm publish:public
```

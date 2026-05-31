# @alkinum/replicate-cli 需求文档

更新日期：2026-05-31

## 1. 背景

`@alkinum/replicate-cli` 是一个 TypeScript 编写的 Replicate CLI。它面向 AI Agent 和自动化脚本优先设计，让模型发现、schema 查询、图片/视频/音频等素材生成、异步轮询、结果下载这些动作可以被稳定组合。

项目从 `create-typescript-cli` 模板起步，并在实现时把依赖升级到当前 npm `latest` 版本。包名为 `@alkinum/replicate-cli`，可执行入口固定为：

- `replicate`：唯一 CLI 命令名。

只发布 `replicate` 命令名，不发布 `replicate-cli` 或 `r8` 别名；如本机已有同名命令，需要由安装步骤显式处理冲突。

## 2. 设计目标

- AI-first：所有核心命令必须支持稳定 JSON 输出，错误也必须可机器解析。
- 低摩擦认证：支持环境变量、用户配置文件、一次性 token 参数。
- 可发现：能搜索模型、集合、文档，查看模型详情、版本、输入输出 schema。
- 可生成：支持 Replicate 上官方模型、版本模型、部署模型的预测创建。
- 可等待：支持同步等待和异步提交，异步返回预测 ID，后续可查询、等待、取消、下载。
- 可落盘：生成结果可以保存到指定目录，生成可追踪的 manifest。
- 可完整管理：覆盖 Replicate HTTP API 中的模型、版本、部署、文件、预测、训练、硬件、webhook secret 等主要资源。
- 可扩展：保留原始 API escape hatch，覆盖 CLI 尚未封装的新端点。
- 可配套：仓库内提供 companion skill，让未来 Agent 能按安全顺序调用这个 CLI。

## 3. 非目标

- 不做 Web UI，不提供长期任务队列服务。
- 不把图片、视频等二进制内容直接写到 stdout。
- 不绕过 Replicate 的安全策略、计费、速率限制或数据保留规则。
- 不让高风险写操作隐式执行。删除、部署更新、模型更新、训练创建等操作必须提供 `--dry-run` 和 `--confirm` 保护。

## 4. 资料来源

- Replicate HTTP API: https://replicate.com/docs/reference/http
- Replicate OpenAPI schema: https://api.replicate.com/openapi.json
- Create prediction guide: https://replicate.com/docs/topics/predictions/create-a-prediction
- Prediction input files: https://replicate.com/docs/topics/predictions/input-files
- Prediction output files: https://replicate.com/docs/topics/predictions/output-files
- npm latest checked on 2026-05-31: `create-typescript-cli@1.0.0`, `replicate@1.4.0`

## 5. 用户与使用场景

- AI Agent：先搜索模型，再读取 schema，自动构造输入，提交生成，下载产物，返回本地路径。
- 开发者：用命令行快速测试 Replicate 模型、保存输出、调试错误日志。
- CI/自动化：从 JSON 输入文件发起生成，异步返回 ID，后续 job 轮询并收集产物。
- 内容工作流：根据 prompt 批量生成图片、视频、音频，按预测 ID 建目录归档。

## 6. 命令契约

### 6.1 全局选项

所有命令支持：

- `--json`：输出稳定 JSON envelope。
- `--token <token>`：一次性 token 覆盖，仅当前命令使用。
- `--profile <name>`：读取指定配置 profile。
- `--config <path>`：指定配置文件路径。
- `--base-url <url>`：默认 `https://api.replicate.com/v1`，便于测试。
- `--timeout <ms>`：HTTP 请求超时。
- `--verbose`：人类可读模式下显示更多诊断；JSON 模式下进入 `meta.debug`。

认证解析优先级：

1. 显式 `--token`，仅用于一次性调用。
2. `REPLICATE_API_TOKEN` 环境变量。
3. 配置文件中的 profile token。

CLI 不得打印完整 token。`doctor --json` 只能报告 token 是否存在、来源类型和脱敏尾号。

### 6.2 JSON envelope

`--json` 模式下成功输出：

```json
{
  "ok": true,
  "type": "prediction",
  "data": {},
  "artifacts": [],
  "meta": {
    "requestId": "optional",
    "authSource": "env",
    "apiVersion": "v1"
  }
}
```

`--json` 模式下失败输出：

```json
{
  "ok": false,
  "error": {
    "code": "replicate_rate_limited",
    "message": "Request was rate limited",
    "status": 429,
    "retryAfterSeconds": 1
  },
  "meta": {
    "authSource": "env"
  }
}
```

退出码：

- `0` 成功。
- `1` CLI 参数、schema 校验或本地文件错误。
- `2` 认证缺失或无效。
- `3` Replicate API 返回错误。
- `4` 预测失败或被取消。
- `5` 网络超时或可重试错误耗尽。

### 6.3 认证与诊断

```bash
replicate auth set --token "$REPLICATE_API_TOKEN"
replicate auth status
replicate auth clear
replicate doctor --json
```

配置文件默认位置：

- Windows：`%APPDATA%\alkinum\replicate\config.json`；若无 `APPDATA`，依次回退到 `%LOCALAPPDATA%` 和 `%USERPROFILE%\AppData\Roaming`。
- macOS：`~/Library/Application Support/alkinum/replicate/config.json`。
- Linux/Unix：优先 `$XDG_CONFIG_HOME/alkinum/replicate/config.json`，若无 `XDG_CONFIG_HOME`，使用 `~/.config/alkinum/replicate/config.json`。

读取或写入本地配置前必须递归创建配置目录。写入配置文件后必须尽量设置权限为 `0600`。配置结构需要支持多个 profile。

### 6.4 发现模型与 schema

```bash
replicate search "text to image" --limit 10 --json
replicate collections list --limit 20 --json
replicate collections get image-generation --json
replicate models list --limit 50 --cursor <url-or-token> --json
replicate models get black-forest-labs/flux-schnell --json
replicate versions list black-forest-labs/flux-schnell --json
replicate schema black-forest-labs/flux-schnell --json
replicate schema black-forest-labs/flux-schnell --version <version-id> --raw
```

需求：

- `search` 使用 Replicate `/search` 端点，接受 `query` 和 `limit`。该 API 当前标注为 beta，输出需要在 `meta.beta = true` 中标明。
- `schema` 默认读取模型 `latest_version.openapi_schema`；若用户指定版本，则调用对应 version 端点。
- `schema` 默认输出 Agent 友好的简化字段：字段名、类型、必填、默认值、枚举、范围、描述、文件字段提示。
- `schema --raw` 输出 Replicate 原始 OpenAPI schema。
- 如果模型没有 `latest_version` 或 schema 缺失，返回结构化错误和下一步建议。

### 6.5 创建预测与生成产物

高层命令：

```bash
replicate run black-forest-labs/flux-schnell --input prompt="a cinematic product photo" --output ./out
replicate run black-forest-labs/flux-schnell --input-json input.json --sync --wait 60 --output ./out
replicate run black-forest-labs/flux-schnell --input prompt="..." --async --json
replicate run --version owner/model:<version-id> --input-json input.json --output ./out
replicate run --deployment owner/deployment-name --input-json input.json --async --json
```

低层预测命令：

```bash
replicate predictions create --version owner/model:<version-id> --input-json input.json --json
replicate predictions get <prediction-id> --json
replicate predictions wait <prediction-id> --poll-interval 2s --timeout 10m --json
replicate predictions cancel <prediction-id> --json
replicate predictions list --limit 20 --json
```

需求：

- `run` 默认同步等待，`--wait` 默认 60 秒，使用 Replicate `Prefer: wait=n` header。若超时但预测仍在运行，命令不能假装失败，必须返回预测 ID、状态和后续查询命令。
- `--async` 不等待模型完成，只提交预测并返回 ID、status、`urls.web`、`urls.get`。
- `--deadline <duration>` 映射到 `Cancel-After` header，支持 `30s`、`5m`、`2h` 等格式。
- `--webhook <url>` 和 `--webhook-events <events>` 透传到 Replicate 预测请求。
- `--input key=value` 支持多次出现，并对 JSON 字面量做类型解析：数字、布尔、数组、对象、null。
- `--input-json <path>` 读取完整 input 对象。
- `--set key=value` 作为 `--input` 的别名，方便 Agent 拼接。
- `--dry-run` 只做本地参数解析、schema 校验和请求预览，不创建预测。
- 对官方模型且未指定版本时，可以走 `/models/{owner}/{name}/predictions`。
- 对非官方模型或显式版本，走 `/predictions` 并提交 version。
- 对 deployment，走 `/deployments/{owner}/{name}/predictions`。

### 6.6 文件输入

```bash
replicate files upload ./input.png --json
replicate files list --limit 20 --json
replicate files get <file-id> --json
replicate files download <file-id> --output ./downloads/input.png
replicate run owner/model --input-file image=./input.png --output ./out
```

需求：

- `--input-file key=path` 自动转换本地文件为 Replicate 可接受输入。
- 默认策略 `auto`：小文件使用 data URL，大文件走 Replicate `/files` multipart 上传后使用 HTTP URL。
- 用户可指定 `--file-mode data-url|upload|url`。
- 上传文件时支持 `--metadata-json`，用于给 Agent 写入任务 ID、来源等可追踪信息。
- 所有文件路径必须展开为绝对路径写入 JSON 输出。

### 6.7 输出下载与落盘

```bash
replicate outputs download <prediction-id> --output ./out --json
replicate outputs print <prediction-id> --json
replicate predictions wait <prediction-id> --output ./out --json
```

需求：

- 预测成功后，如果 `--output <dir>` 存在，CLI 自动下载 output 中的 HTTPS 文件。
- 输出可能是 string、array、object 或嵌套结构。CLI 必须递归发现 URL。
- 对 `replicate.delivery` 或 API 文件下载 URL 请求时带上认证 header。
- 保存文件名默认：`<prediction-id>-<path-index>.<ext>`，例如 `abc123-output-0.webp`。
- 同目录生成 `manifest.json`，记录 prediction、model、version、input 摘要、原始 output、已下载 artifact 列表、时间戳、命令版本。
- 如果 output 数据已被 Replicate 移除，返回明确错误，并提示 API prediction 的输入、输出和日志默认会在一段时间后移除，用户应尽早下载。

### 6.8 原始 API escape hatch

```bash
replicate api GET /models --query cursor=<cursor> --json
replicate api POST /predictions --body-json request.json --json
```

需求：

- 支持 `GET`、`HEAD`、`POST`、`PATCH`、`DELETE`。
- 默认对非 GET/HEAD 请求要求 `--confirm`，除非 `--dry-run`。
- `--json` 仍使用 envelope，但 `data` 保留 API 原始响应。
- 不允许在错误输出或 debug 日志中泄露 token。

### 6.9 完整资源管理命令

完整 CLI 需要覆盖 Replicate OpenAPI 中的主要资源。高层素材生成命令仍是核心，但管理命令也必须一次性实现。

```bash
replicate hardware list --json

replicate trainings create owner/model:<version-id> --input-json train-input.json --destination owner/new-model --async --json
replicate trainings list --limit 20 --json
replicate trainings get <training-id> --json
replicate trainings wait <training-id> --poll-interval 5s --timeout 2h --json
replicate trainings cancel <training-id> --confirm --json

replicate deployments list --json
replicate deployments get owner/deployment-name --json
replicate deployments create owner/deployment-name --model owner/model --version <version-id> --hardware <sku> --dry-run --json
replicate deployments update owner/deployment-name --min-instances 0 --max-instances 4 --confirm --json
replicate deployments delete owner/deployment-name --confirm --json

replicate models create owner/model-name --visibility private --hardware <sku> --dry-run --json
replicate models update owner/model-name --description "..." --confirm --json
replicate models delete owner/model-name --confirm --json
replicate versions delete owner/model-name:<version-id> --confirm --json

replicate webhooks secret --json
```

需求：

- 所有 destructive 命令必须要求 `--confirm`，并在缺失时返回结构化错误。
- 所有 create/update/delete 命令必须支持 `--dry-run`。
- training 与 prediction 一样支持 `get`、`wait`、`cancel`、输出保存和错误归一化。
- deployments 支持 list/get/create/update/delete，也支持通过 deployment 创建 prediction。
- models 支持 list/search/get/create/update/delete/readme/examples/versions。
- hardware 和 webhook secret 支持只读命令。
- 每个命令都要有 JSON fixture 测试和 help snapshot。

### 6.10 常用素材快捷命令

完整 CLI 还需要提供 Agent 友好的薄包装命令。它们不能替代通用 `run`，只负责把常见工作流变短。

```bash
replicate image generate --model owner/model --prompt "..." --output ./out --json
replicate image edit --model owner/model --image ./input.png --prompt "..." --output ./out --json
replicate video generate --model owner/model --prompt "..." --async --json
replicate audio generate --model owner/model --input-json input.json --output ./out --json
```

需求：

- 快捷命令内部仍调用同一套 schema、prediction、download 逻辑。
- `--model` 不指定时不强行内置默认模型，除非后续产品决策明确给出默认推荐。
- `--dry-run` 显示等价的 `run` 请求，方便 Agent 理解和调试。

### 6.11 Companion Skill

仓库应提供：

```text
skills/replicate/SKILL.md
```

skill 目标：

- 告诉未来 Agent 先运行 `replicate doctor --json`。
- 说明认证优先级与 token 禁止打印规则。
- 给出搜索模型、读取 schema、生成、等待、下载的安全顺序。
- 明确异步任务要保存 prediction ID。
- 明确非 GET 原始 API、删除文件、取消任务等需要用户确认。
- 提供 3 个可直接复制的命令例子。

配套命令：

- `replicate skill print` 输出 skill 文本。
- `replicate skill install --target ~/.codex/skills/replicate` 复制到本机 Codex skills。

## 7. 非功能需求

- Node.js 目标：`>=22.12.0`，因为计划使用 `commander@15` 和现代 Web API。
- TypeScript：严格模式，ESM 包，产物由 `tsup` 输出。
- 网络：所有请求必须有超时、重试策略和可读错误。
- 速率限制：识别 429，解析 retry 信息，JSON 中返回 `retryAfterSeconds`。
- 分页：list/search 命令支持 `--limit`，不得无界拉取。
- 安全：永不记录完整 token；本地 token 配置文件尽量 `0600`。
- 可测试：HTTP client、命令参数解析、schema 简化、输出 URL 发现、下载命名都需要单元测试。
- 可安装：`package.json` 必须配置 `bin`，本地开发支持 `pnpm link --global` 或等效命令。

## 8. 验收标准

- `replicate --help` 可运行。
- `replicate doctor --json` 在无 token、有 env token、有 config token 三种状态下输出正确来源。
- `replicate search "image generation" --limit 3 --json` 返回稳定 envelope。
- `replicate schema <model> --json` 能输出简化 schema。
- `replicate run <official-model> --input-json input.json --async --json` 返回 prediction ID。
- `replicate predictions get <id> --json` 能查询状态。
- `replicate predictions wait <id> --output ./out --json` 成功时下载文件并生成 manifest。
- `replicate api GET /account --json` 可以作为 raw escape hatch。
- `replicate trainings create/get/wait/cancel --json` 命令存在，并有 mocked integration test。
- `replicate deployments list/get/create/update/delete --json` 命令存在，写操作有 `--dry-run` 与 `--confirm` 测试。
- `replicate models create/update/delete` 与 `replicate versions delete` 命令存在，删除操作缺少 `--confirm` 时必须失败。
- `replicate image generate --dry-run --json` 能输出等价 prediction 请求。
- companion skill 存在，并包含安全调用顺序和示例。

## 9. 已确认决策

- 一次性实现完整 CLI，不按 MVP 缩减范围。
- 只发布 `replicate` 命令名，不发布 `replicate-cli` 或 `r8` 别名。
- `run` 默认同步等待，默认 `--wait 60`；`predictions create` 默认异步。
- v1 范围包含训练、部署、模型/版本管理、硬件、webhook secret、文件、预测、搜索、schema、原始 API。
- 提供 `image/video/audio` 等常用素材快捷命令，但它们只是通用 `run` 的薄包装。

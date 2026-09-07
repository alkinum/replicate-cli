# @alkinum/replicate-cli 开发路线文档

更新日期：2026-05-31

## 1. 当前仓库状态

仓库目录当前为空，计划从 `create-typescript-cli@1.0.0` 初始化 TypeScript CLI 项目。开发机器已可用：

- Node.js `v24.11.1`
- pnpm `12.3.4`
- npm `11.6.4`

本机未发现 `replicate` 命令冲突。CLI 命令名固定为 `replicate`。

## 2. 技术选型

### 2.1 Runtime

使用 TypeScript/Node.js。原因：

- 用户明确要求 TypeScript。
- Replicate 有官方 JavaScript SDK。
- Node 现代 Web API 适合处理 fetch、FormData、Blob、File、stream 和文件下载。

### 2.2 初始依赖版本

实现时以 npm `latest` tag 为准，2026-05-31 查询到的版本如下：

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| `create-typescript-cli` | `1.0.0` | 项目模板 |
| `replicate` | `1.4.0` | 官方 JS SDK，优先用于预测与常规 API |
| `commander` | `15.0.0` | CLI 参数解析 |
| `zod` | `4.4.3` | 配置、参数、JSON envelope 校验 |
| `conf` | `15.1.0` | 用户配置 profile 存储，或参考其路径策略 |
| `@inquirer/prompts` | `8.5.1` | 可选交互输入 token |
| `tsup` | `8.5.1` | 构建 ESM CLI |
| `tsx` | `4.22.3` | 本地开发运行 |
| `typescript` | `6.0.3` | 类型检查 |
| `@types/node` | `25.9.1` | Node 类型 |
| `vitest` | `4.1.7` | 单元测试 |
| `eslint` | `10.4.1` | 静态检查 |
| `prettier` | `3.8.3` | 格式化 |

注意：`replicate` npm 包有 `2.0.0-alpha.*`，但 npm `latest` 是 `1.4.0`。除非明确决定采用 alpha，否则使用稳定 latest。

## 3. 里程碑

### M0. API 盘点与项目初始化

目标：建立可构建、可运行、可测试的 CLI 骨架。

任务：

- 用 `create-typescript-cli@latest` 初始化项目。
- 更新 `package.json`：包名 `@alkinum/replicate-cli`，`type: module`，bin 映射 `replicate`。
- 配置 `tsup`、`vitest`、`eslint`、`prettier`、`tsconfig` strict。
- 引入基础目录：
  - `src/cli.ts`
  - `src/commands/*`
  - `src/lib/api-client.ts`
  - `src/lib/auth.ts`
  - `src/lib/config.ts`
  - `src/lib/json-output.ts`
  - `src/lib/files.ts`
  - `src/lib/schema.ts`
  - `src/lib/predictions.ts`
  - `src/lib/errors.ts`
  - `test/*`

验收：

- `pnpm build` 通过。
- `pnpm test` 有空测试或基础测试通过。
- `pnpm start -- --help` 显示命令列表。

### M1. JSON 输出、错误模型与 doctor

目标：先把 Agent 可依赖的输出契约打牢。

任务：

- 实现 `printJsonSuccess`、`printJsonError`。
- 统一 error code：`auth_missing`、`api_error`、`rate_limited`、`prediction_failed`、`file_error`、`schema_error`。
- 实现 token 解析：`--token`、`REPLICATE_API_TOKEN`、config profile。
- 实现跨平台配置目录：Windows 使用 `%APPDATA%`，macOS 使用 `~/Library/Application Support`，Linux/Unix 使用 `XDG_CONFIG_HOME` 或 `~/.config`，读取/写入前递归创建目录。
- 实现 `auth set/status/clear`。
- 实现 `doctor --json`：检查版本、config、token 来源、API base URL、可选 `/account`。
- 所有错误路径测试不得泄露完整 token。

验收：

- 无 token 时 `replicate doctor --json` 返回 `ok: false` 或 `auth.available: false`，不崩溃。
- env token 优先于 config，flag token 可一次性覆盖。
- 快照测试覆盖 JSON envelope。

### M2. Replicate HTTP client

目标：封装可测试、可重试、可扩展的 API 层。

任务：

- 实现 `ReplicateHttpClient`，基于 native `fetch`。
- 默认 base URL 为 `https://api.replicate.com/v1`。
- 统一注入 Authorization header，兼容需要 Bearer/Token 的端点差异。
- 实现 request timeout、JSON 解析、非 JSON 响应处理。
- 处理 401、403、404、422、429、5xx。
- 增加 raw `api` 命令，先支持 GET/HEAD，POST/PATCH/DELETE 要 `--confirm`。
- 可选：对 SDK 能力做 thin wrapper，但不要让 SDK 限制端点覆盖。

验收：

- 单元测试用 mocked fetch 覆盖成功、API 错误、429、timeout。
- `replicate api GET /account --json` 在有 token 时可用。

### M3. 模型发现与 schema

目标：让 Agent 能找到模型并理解输入参数。

任务：

- 实现 `search`：`GET /search?query=&limit=`。
- 实现 `collections list/get`。
- 实现 `models list/get`。
- 实现 `versions list/get`。
- 实现 `schema <owner/name>`：
  - 默认从 model `latest_version.openapi_schema` 读取。
  - `--version` 时读取指定 version。
  - 输出简化 schema。
  - `--raw` 输出原始 schema。
- 支持分页 `--limit`，并在 JSON `meta.next` 返回下一页信息。

验收：

- `replicate search "nano banana" --limit 3 --json` 输出 models/collections/pages。
- `replicate schema owner/name --json` 输出字段数组。
- schema 简化器有 fixture 测试，覆盖 string、number、boolean、enum、array、file、required/default。

### M4. 预测创建、同步等待、异步查询

目标：打通核心生成闭环。

任务：

- 实现 `run` 高层命令。
- 实现 `predictions create/get/list/wait/cancel`。
- 输入解析：
  - `--input key=value`
  - `--set key=value`
  - `--input-json path`
  - `--input-file key=path`
- 路由选择：
  - official model 无版本：`POST /models/{owner}/{name}/predictions`
  - explicit version：`POST /predictions`
  - deployment：`POST /deployments/{owner}/{name}/predictions`
- 支持 `--sync`、`--async`、`--wait 1..60`。
- 支持 `--deadline` 到 `Cancel-After` header。
- `wait` 用 `GET /predictions/{id}` 轮询，终态为 `succeeded`、`failed`、`canceled`。

验收：

- `--dry-run --json` 输出将要发送的 request，不创建 prediction。
- `--async --json` 返回 prediction ID。
- `wait` 对 succeeded 返回 output，对 failed/canceled 返回退出码 4。
- 轮询有超时，超时时输出 prediction ID 和最后状态。

### M5. 文件输入与输出下载

目标：让素材工作流能落地到本地文件。

任务：

- 实现 data URL 编码器，小文件本地输入直接内嵌。
- 实现 `/files` multipart upload，返回 file resource。
- 实现 `files list/upload/get/download/delete`。
- `--input-file key=path` 支持 `--file-mode auto|data-url|upload|url`。
- 实现 output URL 递归发现：
  - string URL
  - array 嵌套
  - object 嵌套
- 实现 artifact 下载：
  - 自动推断扩展名。
  - 文件名稳定。
  - 写入 `manifest.json`。
  - 绝对路径返回到 JSON `artifacts`。
- 下载失败时保留 manifest 中的原始 URL 和错误。

验收：

- URL 发现函数 fixture 测试覆盖多层 output。
- 下载命名测试稳定。
- `replicate predictions wait <id> --output ./out --json` 可生成 manifest。

### M6. Agent 体验打磨

目标：让 CLI 真正适合未来 Agent 使用。

任务：

- 所有人类模式输出保持简洁，JSON 模式无 spinner、无 ANSI。
- 增加 `--quiet`。
- 增加 `--save-request`、`--save-response`，用于调试但要脱敏。
- 增加 `examples/`：
  - text-to-image async
  - image-to-image with local input file
  - poll and download
- 增加 README 的 command contract、JSON policy、auth policy。
- 增加 shell completion 可选项。

验收：

- 从 `/tmp` 运行 linked CLI，不依赖当前 repo 相对路径。
- README 中每个主要命令都有 JSON 示例。

### M7. 完整资源管理命令

目标：一次性覆盖 Replicate HTTP API 的主要资源，而不只完成素材生成闭环。

任务：

- 实现 `hardware list`。
- 实现 `trainings create/list/get/wait/cancel`。
- 实现 `deployments list/get/create/update/delete`。
- 实现 `models create/update/delete/readme/examples`。
- 实现 `versions delete`。
- 实现 `webhooks secret`。
- 所有 create/update/delete/cancel 命令都支持 `--dry-run`；destructive 命令必须要求 `--confirm`。
- 所有命令支持 `--json` envelope、统一错误码、token 脱敏。
- 训练 wait 复用 prediction wait 的轮询内核，但终态、错误消息和 manifest type 使用 training。

验收：

- 每个资源命令都有 help snapshot。
- create/update/delete 的 `--dry-run` 不发起写请求。
- 删除、取消、部署更新、模型更新在缺少 `--confirm` 时返回结构化错误。
- mocked integration tests 覆盖 training lifecycle 和 deployment create/update/delete。

### M8. 常用素材快捷命令

目标：提供 Agent 和人类都更容易使用的素材生成入口。

任务：

- 实现 `image generate`，映射到通用 `run`。
- 实现 `image edit`，支持 `--image` 到 `--input-file` 的转换。
- 实现 `video generate`，支持长任务默认推荐 `--async`。
- 实现 `audio generate`，支持 JSON input 与 output 下载。
- 所有快捷命令支持 `--dry-run`，输出等价 prediction request。
- README 和 skill 中说明快捷命令只是薄包装，复杂模型仍应使用 `schema` + `run`。

验收：

- `replicate image generate --dry-run --json` 输出完整 request preview。
- `replicate image edit --image ./x.png --dry-run --json` 输出文件输入映射。
- 快捷命令复用 `run` 的测试 fixture，不产生平行实现。

### M9. Companion Skill

目标：把 CLI 的安全调用顺序固化给 Codex/Agent。

任务：

- 新增 `skills/replicate/SKILL.md`。
- 内容按使用顺序写：
  1. 检查命令是否存在。
  2. `replicate doctor --json`。
  3. 搜索模型。
  4. 读取 schema。
  5. `--dry-run` 校验。
  6. `run --async` 或 `run --sync`。
  7. `predictions wait`。
  8. `outputs download`。
  9. 何时需要用户确认。
- 实现 `replicate skill print`。
- 实现 `replicate skill install --target ~/.codex/skills/replicate`。

验收：

- skill 文件存在。
- skill 中至少包含 3 条可复制命令。
- skill 明确禁止打印 token，明确 raw non-GET 需要确认。

### M10. 发布准备

目标：可稳定发布到 npm。

任务：

- 完善 README、CHANGELOG、LICENSE。
- 配置 `files` 白名单，包含 `dist`、README、LICENSE、skills。
- 配置 `prepublishOnly`：`pnpm lint && pnpm test && pnpm build`。
- 本地 smoke test：
  - `pnpm install`
  - `pnpm build`
  - `pnpm link --global`
  - 在 `/tmp` 执行 `replicate --help`
  - 在 `/tmp` 执行 `replicate doctor --json`
- 若发布需要，配置 npm provenance。

验收：

- `npm pack --dry-run` 只包含必要文件。
- 全部测试通过。
- linked CLI 可在任意目录运行。

## 4. 测试策略

- 单元测试：
  - auth source resolution
  - config read/write and token redaction
  - JSON envelope
  - API error mapping
  - input parser
  - schema simplifier
  - output URL discovery
  - artifact filename generator
- 集成测试：
  - mocked fetch for `/search`、`/models`、`/predictions`
  - file upload multipart request shape
  - wait polling status transitions
- 可选 live smoke：
  - 只读 `/account`
  - 只读 `/search`
  - 只读 `/hardware`
  - 只读 `/models`
  - 真正创建 prediction/training/deployment 必须显式用户确认或 CI secret opt-in。

## 5. 风险与缓解

- Replicate `/search` 当前为 beta：在输出 `meta.beta = true`，并保留 `models list/search` fallback。
- 模型 schema 差异大：简化器必须容忍缺失字段、`$ref`、`allOf`、`oneOf`。
- 输出数据会过期：CLI 在 `--output` 场景中成功后立即下载，并在 manifest 写入时间。
- 大文件输入不适合 data URL：`--input-file` 默认 auto，大文件走 `/files` 上传。
- 生成命令会产生费用：`--dry-run` 可预览；文档中提醒用户异步任务已创建即可能计费。
- Token 泄露：错误、debug、manifest 均不得写入完整 token。
- 完整 CLI 范围较大：先实现共享 API client、JSON envelope、confirm/dry-run 中间件，再并行填资源命令，避免每个命令重复造轮子。

## 6. 一次性完整实现范围

本项目不按 MVP 缩减范围，第一轮开发即实现完整 CLI。推荐按以下顺序落地，以保证每一步都能被测试：

1. 项目初始化与构建。
2. `auth`、`doctor`、JSON envelope。
3. `search`、`models get`、`schema`。
4. `run --async`、`predictions get/wait`。
5. `--output` 下载与 manifest。
6. `files` 上传、下载、删除。
7. `trainings` create/list/get/wait/cancel。
8. `deployments` list/get/create/update/delete。
9. `models` create/update/delete/readme/examples 与 `versions delete`。
10. `hardware list`、`webhooks secret`。
11. `image/video/audio` 快捷命令。
12. companion skill 完整版。
13. README、测试、npm 发布准备。

每个阶段都必须保持 `pnpm test` 和 `pnpm build` 通过；完整范围完成后再进入发布。

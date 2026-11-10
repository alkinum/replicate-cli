import { details } from "./terminal.js";

type RecordValue = Record<string, any>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function text(value: unknown): string {
  if (value === undefined || value === null) return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}

// Control characters in remote data must not execute terminal escape sequences.
function cell(value: unknown, width: number): string {
  const valueText = text(value)
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ");
  return valueText.length > width
    ? `${valueText.slice(0, Math.max(0, width - 1))}…`
    : valueText;
}

function table(
  title: string,
  headings: string[],
  rows: unknown[][],
  next?: unknown,
): string {
  if (rows.length === 0) return `${title}\n  No results found.`;
  const available = Math.max(40, process.stdout.columns ?? 100);
  const widths = headings.map((heading, index) =>
    Math.max(
      heading.length,
      ...rows.map((row) => Math.min(60, text(row[index]).length)),
    ),
  );
  if (
    widths.reduce((sum, width) => sum + width + 2, 2) > available ||
    rows.some((row) => text(row[0]).length > widths[0]!)
  ) {
    return [
      title,
      ...rows.map(
        (row, index) =>
          `\n${details(
            `${index + 1}. ${cell(row[0], Number.MAX_SAFE_INTEGER)}`,
            headings
              .slice(1)
              .map((heading, column) => [heading, row[column + 1]]),
          )}`,
      ),
      "",
      `${rows.length} result${rows.length === 1 ? "" : "s"}.${next ? " More results are available; increase --limit to fetch more." : ""}`,
    ].join("\n");
  }
  const line = (values: unknown[]) =>
    `  ${values
      .map((value, index) => cell(value, widths[index]!).padEnd(widths[index]!))
      .join("  ")
      .trimEnd()}`;
  return [
    title,
    line(headings),
    ...rows.map(line),
    "",
    `${rows.length} result${rows.length === 1 ? "" : "s"}.${next ? " More results are available; increase --limit to fetch more." : ""}`,
  ].join("\n");
}

function modelName(value: RecordValue): unknown {
  return value.owner && value.name
    ? `${value.owner}/${value.name}`
    : (value.name ?? value.id ?? value.slug);
}

function artifactsTable(artifacts: unknown[]): string {
  return table(
    "Downloaded files",
    ["PATH", "BYTES", "TYPE"],
    artifacts.map((value) => {
      const artifact = record(value);
      return [artifact.path, artifact.bytes, artifact.contentType];
    }),
  );
}

export function formatCommandResult(
  type: string,
  result: unknown,
  context: {
    operation: string;
    output?: string;
    target?: string;
    raw?: boolean;
    dryRun?: boolean;
  },
): string {
  const wrapper = record(result);
  const wrapped =
    "data" in wrapper && ("type" in wrapper || "artifacts" in wrapper);
  const data = wrapped ? wrapper.data : result;
  const value = record(data);
  const artifacts = Array.isArray(wrapper.artifacts) ? wrapper.artifacts : [];
  if (context.dryRun && value.method && value.path) {
    return [
      details(
        "Request preview",
        [
          ["Method", value.method],
          ["Path", value.path],
        ],
        "Dry run — no API write was sent.",
      ),
      ...["query", "headers", "body"]
        .filter((key) => value[key] !== undefined)
        .map(
          (key) =>
            `\n${key[0]!.toUpperCase()}${key.slice(1)}\n${JSON.stringify(value[key], null, 2)}`,
        ),
    ].join("\n");
  }
  if (type === "api" || (type === "schema" && context.raw))
    return typeof data === "string"
      ? data
      : (JSON.stringify(data, null, 2) ?? "No response body.");
  if (type === "output")
    return typeof data === "string"
      ? data
      : (JSON.stringify(data, null, 2) ?? "No output available.");
  if (type === "model-readme")
    return typeof data === "string"
      ? data
      : text(value.content ?? value.readme ?? "No README available.");
  if (data === null || data === undefined) {
    const noun =
      (
        {
          model: "Model",
          version: "Version",
          deployment: "Deployment",
          file: "File",
        } as Record<string, string>
      )[type] ?? "Request";
    return details(
      context.operation === "delete" ? `${noun} deleted` : `${noun} completed`,
      [["Target", context.target]],
    );
  }
  if (type === "schema" && Array.isArray(data)) {
    return (
      table(
        "Model inputs",
        ["FIELD", "TYPE", "REQUIRED", "DEFAULT / OPTIONS"],
        data.map((field) => [
          field.name,
          field.file ? `${field.type ?? "string"} (file)` : field.type,
          field.required ? "yes" : "no",
          field.enum ?? field.default,
        ]),
      ) +
      data
        .filter((field) => field.description)
        .map((field) => `\n\n${field.name}\n  ${text(field.description)}`)
        .join("")
    );
  }
  const list = Array.isArray(data)
    ? data
    : Array.isArray(value.results)
      ? value.results
      : undefined;
  if (list) {
    const items = list.map(record);
    if (type === "hardware")
      return table(
        "Available hardware",
        ["SKU", "NAME"],
        items.map((item) => [item.sku, item.name]),
      );
    if (["models", "search"].includes(type))
      return table(
        "Models",
        ["MODEL", "RUNS", "DESCRIPTION"],
        items.map((item) => [
          modelName(item),
          item.run_count,
          item.description ?? item.metadata?.generated_description,
        ]),
        value.next,
      );
    if (type === "collections")
      return table(
        "Collections",
        ["SLUG", "NAME", "DESCRIPTION"],
        items.map((item) => [item.slug, item.name, item.description]),
        value.next,
      );
    if (["predictions", "trainings", "model-examples"].includes(type))
      return table(
        type === "trainings" ? "Trainings" : "Predictions",
        ["ID", "STATUS", "MODEL", "CREATED"],
        items.map((item) => [
          item.id,
          item.status,
          item.model,
          item.created_at,
        ]),
        value.next,
      );
    if (type === "versions")
      return table(
        "Model versions",
        ["ID", "CREATED", "COG"],
        items.map((item) => [item.id, item.created_at, item.cog_version]),
        value.next,
      );
    if (type === "deployments")
      return table(
        "Deployments",
        ["DEPLOYMENT", "MODEL", "HARDWARE", "INSTANCES"],
        items.map((item) => [
          modelName(item),
          item.current_release?.model,
          item.current_release?.configuration?.hardware,
          `${item.current_release?.configuration?.min_instances ?? "—"}–${item.current_release?.configuration?.max_instances ?? "—"}`,
        ]),
        value.next,
      );
    if (type === "files")
      return table(
        "Files",
        ["ID", "NAME", "BYTES", "EXPIRES"],
        items.map((item) => [
          item.id,
          item.name ?? item.filename,
          item.size ?? item.bytes,
          item.expires_at,
        ]),
        value.next,
      );
  }
  if (
    type === "search" ||
    (type === "models" && (value.models || value.collections || value.docs))
  ) {
    return (
      ["models", "collections", "docs"]
        .filter((key) => Array.isArray(value[key]))
        .map((key) =>
          table(
            key === "docs"
              ? "Documentation"
              : key === "models"
                ? "Models"
                : "Collections",
            ["NAME", "DESCRIPTION / URL"],
            value[key].map((entry: unknown) => {
              const item = record(entry);
              return [
                modelName(item) ?? item.title,
                item.description ?? item.url,
              ];
            }),
          ),
        )
        .join("\n\n") || "Search\n  No results found."
    );
  }
  if (type === "prediction" || type === "training") {
    const noun = type === "training" ? "Training" : "Prediction";
    const pending = ["starting", "processing", "queued"].includes(value.status);
    const hint =
      pending && value.id
        ? `Continue with \`replicate ${type === "training" ? "trainings" : "predictions"} wait ${value.id}\`.${context.output ? " Add --output <dir> to download the result when it finishes." : ""}`
        : undefined;
    const summary = details(
      noun,
      [
        ["ID", value.id],
        ["Status", value.status],
        ["Model", value.model],
        ["Version", value.version],
        ["Created", value.created_at],
        ["Completed", value.completed_at],
        [
          "Predict time",
          value.metrics?.predict_time === undefined
            ? undefined
            : `${value.metrics.predict_time}s`,
        ],
        ["Error", value.error],
        [
          "Data",
          value.data_removed ? "Input and output have been removed" : undefined,
        ],
      ],
      hint,
    );
    return [
      summary,
      ...(value.output !== undefined && value.output !== null
        ? [`\nOutput\n${text(value.output)}`]
        : []),
      ...(artifacts.length ? [`\n${artifactsTable(artifacts)}`] : []),
    ].join("\n");
  }
  if (type === "artifacts")
    return artifactsTable(
      artifacts.length ? artifacts : (value.artifacts ?? []),
    );
  if (type === "model")
    return details(
      "Model",
      [
        ["Model", modelName(value)],
        ["Description", value.description],
        ["Visibility", value.visibility],
        ["Runs", value.run_count],
        ["URL", value.url],
        ["Latest version", value.latest_version?.id],
      ],
      "Inspect inputs with `replicate schema <owner/model>`.",
    );
  if (type === "version")
    return details(
      "Model version",
      [
        ["ID", value.id],
        ["Created", value.created_at],
        ["Cog", value.cog_version],
      ],
      "Use `replicate schema <owner/model> --version <id>` to inspect this version's inputs.",
    );
  if (type === "deployment") {
    const release = record(value.current_release);
    const configuration = record(release.configuration);
    return details("Deployment", [
      ["Deployment", modelName(value)],
      ["Model", release.model],
      ["Version", release.version],
      ["Release", release.number],
      ["Hardware", configuration.hardware],
      ["Minimum instances", configuration.min_instances],
      ["Maximum instances", configuration.max_instances],
    ]);
  }
  if (type === "collection")
    return [
      details("Collection", [
        ["Name", value.name],
        ["Slug", value.slug],
        ["Description", value.description],
      ]),
      ...(Array.isArray(value.models)
        ? [formatCommandResult("models", value.models, context)]
        : []),
    ].join("\n\n");
  if (type === "file")
    return details(value.path ? "File downloaded" : "File", [
      ["ID", value.id],
      ["Name", value.name ?? value.filename],
      ["Path", value.path],
      ["Bytes", value.bytes ?? value.size],
      ["Content type", value.contentType ?? value.content_type],
      ["Download URL", value.urls?.get],
      ["Expires", value.expires_at],
    ]);
  if (type === "webhook-secret")
    return details("Webhook signing secret", [["Key", value.key]]);
  if (type === "skill" && value.installed)
    return details("Companion skill installed", [["Path", value.path]]);
  return typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

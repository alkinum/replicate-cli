import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCommandResult } from "../src/lib/human.js";
import { asResult, runWithOutput } from "../src/lib/output.js";

afterEach(() => vi.restoreAllMocks());

describe("human output", () => {
  it("renders empty lists and tells users when more results are available", () => {
    expect(
      formatCommandResult("models", asResult("models", { results: [] }), {
        operation: "list",
      }),
    ).toContain("No results found");
    const output = formatCommandResult(
      "models",
      asResult("models", {
        results: [{ owner: "owner", name: "model", run_count: 1 }],
        next: "/models?cursor=next",
      }),
      { operation: "list" },
    );
    expect(output).toContain("owner/model");
    expect(output).toContain("increase --limit");
  });

  it("keeps full identifiers and file paths available on narrow terminals", () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns",
    );
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 40,
    });
    try {
      const id = "a".repeat(64);
      const path =
        "/a/very/long/download/directory/prediction-result-with-a-long-name.png";
      const versions = formatCommandResult(
        "versions",
        [{ id, created_at: "2026-11-11T00:00:00Z" }],
        { operation: "list" },
      );
      const artifacts = formatCommandResult(
        "artifacts",
        asResult("artifacts", {}, { artifacts: [{ path, bytes: 1024 }] }),
        { operation: "download" },
      );
      expect(versions).toContain(id);
      expect(artifacts).toContain(path);
    } finally {
      if (descriptor)
        Object.defineProperty(process.stdout, "columns", descriptor);
      else Reflect.deleteProperty(process.stdout, "columns");
    }
  });

  it("does not mistake a raw API response for a dry run", () => {
    const data = { method: "POST", path: "/models", id: "created" };
    const result = formatCommandResult("api", asResult("api", data), {
      operation: "api",
    });
    expect(JSON.parse(result)).toEqual(data);
    expect(result).not.toContain("Dry run");
  });

  it("redacts credentials and prevents terminal controls in human data", async () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await runWithOutput(
      {
        type: "model",
        human: (value) =>
          formatCommandResult("model", value, { operation: "get" }),
      },
      async () =>
        asResult("model", {
          owner: "owner",
          name: "model",
          description: "\u001b[31mInjected r8_abcdefghijklmnopqrstuvwxyz",
        }),
    );
    const output = write.mock.calls.map(([value]) => String(value)).join("");
    expect(output).toContain("r8_a...wxyz");
    expect(output).not.toContain("r8_abcdefghijklmnopqrstuvwxyz");
    expect(output).not.toContain("\u001b[31m");
  });

  it("keeps the JSON envelope independent of terminal formatting", async () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const human = vi.fn(() => "formatted");
    await runWithOutput({ json: true, type: "models", human }, async () =>
      asResult(
        "models",
        { results: [{ owner: "owner", name: "model" }] },
        { meta: { authSource: "env" } },
      ),
    );
    expect(human).not.toHaveBeenCalled();
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toMatchObject({
      ok: true,
      type: "models",
      data: { results: [{ owner: "owner", name: "model" }] },
      meta: { authSource: "env" },
    });
  });

  it("neutralizes terminal controls in API error messages", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const oldCode = process.exitCode;
    try {
      await runWithOutput({ type: "api" }, async () => {
        throw new Error("\u001b[31mBad response");
      });
      expect(
        stderr.mock.calls.map(([value]) => String(value)).join(""),
      ).not.toContain("\u001b");
    } finally {
      process.exitCode = oldCode;
    }
  });
});

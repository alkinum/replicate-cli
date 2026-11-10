import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeInput, parseDurationMs, parseKeyValues, parseLimit, parseModelRef, parseWaitSeconds, toQuery } from "../src/lib/parse.js";

describe("parse utilities", () => {
  it.each(["owner/model:", "owner/model:v1:v2", "owner/..", "owner/model?other=true"])("rejects malformed model references: %s", value => {
    expect(() => parseModelRef(value)).toThrow();
  });

  it.each([NaN, Infinity, -1, 2 ** 53, "999999999999999999999h"])("rejects invalid or overflowing durations: %s", value => {
    expect(() => parseDurationMs(value)).toThrow();
  });

  it("preserves query strings literally, including leading zeros and equals signs", () => {
    expect(toQuery(["cursor=00123", "filter={\"x\":1}", "signature=a=b=c"])).toEqual({ cursor: "00123", filter: '{"x":1}', signature: "a=b=c" });
  });
  it.each(["__proto__.polluted", "constructor.prototype.polluted", "nested.__proto__.polluted"])(
    "rejects unsafe input path %s without modifying prototypes",
    (key) => {
      expect(() => parseKeyValues([`${key}=true`])).toThrow("Unsafe input key");
      expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    }
  );

  it("preserves nested JSON and input siblings when applying --set overrides", async () => {
    const dir = await mkdtemp(join(tmpdir(), "replicate-input-"));
    const inputJson = join(dir, "input.json");
    try {
      await writeFile(inputJson, JSON.stringify({ settings: { seed: 1, size: 512 }, prompt: "hello" }));
      await expect(mergeInput({ inputJson, input: ["settings.steps=4"], set: ["settings.seed=2"] })).resolves.toEqual({
        settings: { seed: 2, size: 512, steps: 4 }, prompt: "hello"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("parses key/value inputs with JSON literals", () => {
    expect(parseKeyValues(["prompt=hello", "steps=4", "fast=true", "nested.value={\"x\":1}"])).toEqual({
      prompt: "hello",
      steps: 4,
      fast: true,
      nested: { value: { x: 1 } }
    });
  });

  it("parses model refs", () => {
    expect(parseModelRef("owner/model:abc")).toEqual({
      owner: "owner",
      name: "model",
      version: "abc"
    });
  });

  it("parses durations", () => {
    expect(parseDurationMs("1h30m5s")).toBe(5_405_000);
    expect(parseDurationMs("250ms")).toBe(250);
    expect(() => parseDurationMs("1sfoo")).toThrow("Invalid duration: 1sfoo");
  });

  it("validates limit values", () => {
    expect(parseLimit("12", { max: 50 })).toBe(12);
    expect(() => parseLimit("0")).toThrow("--limit must be an integer at least 1.");
    expect(() => parseLimit("51", { max: 50 })).toThrow("--limit must be an integer from 1 to 50.");
    expect(() => parseLimit("abc")).toThrow("--limit must be an integer at least 1.");
  });

  it("validates Replicate sync wait range", () => {
    expect(parseWaitSeconds("60")).toBe(60);
    expect(() => parseWaitSeconds("0")).toThrow("--wait must be an integer from 1 to 60.");
    expect(() => parseWaitSeconds("61")).toThrow("--wait must be an integer from 1 to 60.");
  });
});

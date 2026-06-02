import { describe, expect, it } from "vitest";
import { parseDurationMs, parseKeyValues, parseLimit, parseModelRef, parseWaitSeconds } from "../src/lib/parse.js";

describe("parse utilities", () => {
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

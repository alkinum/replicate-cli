import { describe, expect, it } from "vitest";
import { parseDurationMs, parseKeyValues, parseModelRef } from "../src/lib/parse.js";

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
  });
});

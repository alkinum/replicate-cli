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
  });

  it("validates limit values", () => {
    expect(parseLimit("12", { max: 50 })).toBe(12);
    expect(() => parseLimit("0")).toThrow("--limit must be an integer at least 1.");
    expect(() => parseLimit("51", { max: 50 })).toThrow("--limit must be an integer from 1 to 50.");
    expect(() => parseLimit("abc")).toThrow("--limit must be an integer at least 1.");
  });

  it("allows wait values above 60 seconds", () => {
    expect(parseWaitSeconds("120")).toBe(120);
    expect(() => parseWaitSeconds("0")).toThrow("--wait must be an integer at least 1.");
  });
});

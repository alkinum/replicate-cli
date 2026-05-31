import { describe, expect, it } from "vitest";
import { isTerminalStatus } from "../src/lib/predictions.js";

describe("prediction utilities", () => {
  it("treats aborted resources as terminal", () => {
    expect(isTerminalStatus("aborted")).toBe(true);
  });
});

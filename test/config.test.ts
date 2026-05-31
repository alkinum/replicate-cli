import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultConfigDirectory,
  defaultConfigPath,
  readConfig,
  writeConfig
} from "../src/lib/config.js";

describe("config paths", () => {
  it("uses APPDATA on Windows", () => {
    expect(
      defaultConfigPath({
        env: { APPDATA: "C:\\Users\\Ada\\AppData\\Roaming" },
        homeDir: "C:\\Users\\Ada",
        platform: "win32"
      })
    ).toBe("C:\\Users\\Ada\\AppData\\Roaming\\alkinum\\replicate\\config.json");
  });

  it("uses Application Support on macOS", () => {
    expect(
      defaultConfigDirectory({
        env: {},
        homeDir: "/Users/ada",
        platform: "darwin"
      })
    ).toBe("/Users/ada/Library/Application Support/alkinum/replicate");
  });

  it("uses XDG_CONFIG_HOME on Linux and Unix", () => {
    expect(
      defaultConfigPath({
        env: { XDG_CONFIG_HOME: "/tmp/config" },
        homeDir: "/home/ada",
        platform: "linux"
      })
    ).toBe("/tmp/config/alkinum/replicate/config.json");
  });

  it("creates the config directory before reading a missing config", async () => {
    const root = await mkdtemp(join(tmpdir(), "replicate-config-"));
    const configPath = join(root, "missing", "config.json");
    try {
      await expect(readConfig(configPath)).resolves.toEqual({
        defaultProfile: "default",
        profiles: {}
      });
      expect((await stat(join(root, "missing"))).isDirectory()).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("creates the config directory before writing", async () => {
    const root = await mkdtemp(join(tmpdir(), "replicate-config-"));
    const configPath = join(root, "nested", "config.json");
    try {
      await writeConfig({ defaultProfile: "default", profiles: {} }, configPath);
      expect((await stat(join(root, "nested"))).isDirectory()).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

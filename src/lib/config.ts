import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, posix, resolve, win32 } from "node:path";
import { z } from "zod";

const ProfileSchema = z.object({
  token: z.string().optional()
});

const ConfigSchema = z.object({
  defaultProfile: z.string().default("default"),
  profiles: z.record(z.string(), ProfileSchema).default({})
});

export type ReplicateCliConfig = z.infer<typeof ConfigSchema>;

export interface ConfigPathOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
}

export function defaultConfigDirectory(options: ConfigPathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const path = platform === "win32" ? win32 : posix;

  if (platform === "win32") {
    const base = firstNonEmpty(env.APPDATA, env.LOCALAPPDATA) ?? path.join(home, "AppData", "Roaming");
    return path.join(base, "alkinum", "replicate");
  }

  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "alkinum", "replicate");
  }

  const xdgConfigHome = firstNonEmpty(env.XDG_CONFIG_HOME);
  const base = xdgConfigHome ?? path.join(home, ".config");
  return path.join(base, "alkinum", "replicate");
}

export function defaultConfigPath(options: ConfigPathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const path = platform === "win32" ? win32 : posix;
  return path.join(defaultConfigDirectory(options), "config.json");
}

export function resolveConfigPath(path?: string): string {
  return resolve(path ?? defaultConfigPath());
}

export async function readConfig(path?: string): Promise<ReplicateCliConfig> {
  const configPath = resolveConfigPath(path);
  await ensureConfigDirectory(configPath);
  try {
    const raw = await readFile(configPath, "utf8");
    return ConfigSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { defaultProfile: "default", profiles: {} };
    }
    throw error;
  }
}

export async function writeConfig(
  config: ReplicateCliConfig,
  path?: string
): Promise<string> {
  const configPath = resolveConfigPath(path);
  await ensureConfigDirectory(configPath);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await chmod(configPath, 0o600).catch(() => undefined);
  return configPath;
}

export async function deleteConfig(path?: string): Promise<void> {
  await rm(resolveConfigPath(path), { force: true });
}

export function profileName(config: ReplicateCliConfig, explicit?: string): string {
  return explicit ?? config.defaultProfile ?? "default";
}

async function ensureConfigDirectory(configPath: string): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim() !== "");
}

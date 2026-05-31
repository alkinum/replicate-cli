import { deleteConfig, profileName, readConfig, writeConfig } from "./config.js";
import { CliError, redactSecret } from "./errors.js";

export type AuthSource = "flag" | "env" | "config" | "missing";

export interface AuthResolution {
  token?: string;
  source: AuthSource;
  profile?: string;
  redacted?: string;
}

export interface AuthOptions {
  token?: string;
  config?: string;
  profile?: string;
}

export async function resolveAuth(options: AuthOptions = {}): Promise<AuthResolution> {
  if (options.token) {
    return {
      token: options.token,
      source: "flag",
      redacted: redactSecret(options.token)
    };
  }

  if (process.env.REPLICATE_API_TOKEN) {
    return {
      token: process.env.REPLICATE_API_TOKEN,
      source: "env",
      redacted: redactSecret(process.env.REPLICATE_API_TOKEN)
    };
  }

  const config = await readConfig(options.config);
  const name = profileName(config, options.profile);
  const token = config.profiles[name]?.token;
  if (token) {
    return {
      token,
      source: "config",
      profile: name,
      redacted: redactSecret(token)
    };
  }

  return { source: "missing", profile: name };
}

export async function requireAuth(options: AuthOptions = {}): Promise<AuthResolution> {
  const auth = await resolveAuth(options);
  if (!auth.token) {
    throw new CliError(
      "auth_missing",
      "Replicate API token is missing. Set REPLICATE_API_TOKEN or run `replicate auth set --token <token>`.",
      { exitCode: 2 }
    );
  }
  return auth;
}

export async function setAuthToken(
  token: string,
  options: AuthOptions = {}
): Promise<{ profile: string; configPath: string; token: string }> {
  const config = await readConfig(options.config);
  const name = options.profile ?? config.defaultProfile ?? "default";
  config.defaultProfile = name;
  config.profiles[name] = { token };
  const configPath = await writeConfig(config, options.config);
  return { profile: name, configPath, token: redactSecret(token) };
}

export async function clearAuthToken(options: AuthOptions = {}): Promise<{ cleared: true }> {
  if (options.profile) {
    const config = await readConfig(options.config);
    delete config.profiles[options.profile];
    if (config.defaultProfile === options.profile) config.defaultProfile = "default";
    await writeConfig(config, options.config);
    return { cleared: true };
  }

  await deleteConfig(options.config);
  return { cleared: true };
}

import {
  deleteConfig,
  profileName,
  readConfig,
  writeConfig,
} from "./config.js";
import { ReplicateHttpClient } from "./api-client.js";
import { CliError, redactSecret } from "./errors.js";
import { z } from "zod";

const AccountSchema = z
  .object({
    type: z.enum(["user", "organization"]),
    username: z.string().min(1),
    name: z.string().nullish(),
  })
  .passthrough();

export type Account = z.infer<typeof AccountSchema>;

export async function verifyAuthToken(
  token: string,
  options: { baseUrl?: string; timeoutMs?: number } = {},
): Promise<Account> {
  const client = new ReplicateHttpClient({ ...options, token });
  try {
    const response = await client.request("GET", "/account", { maxRetries: 0 });
    const account = AccountSchema.safeParse(response.data);
    if (!account.success) {
      throw new CliError(
        "invalid_account_response",
        "The API returned an unexpected account response; token validity could not be confirmed.",
        { status: response.status },
      );
    }
    return account.data;
  } catch (error) {
    if (
      error instanceof CliError &&
      (error.status === 401 || error.status === 403)
    ) {
      throw new CliError(
        "replicate_auth_failed",
        "Replicate rejected this API token. Check that it is correct and has not been revoked, then run `replicate auth set`.",
        {
          exitCode: 2,
          status: error.status,
        },
      );
    }
    if (error instanceof TypeError) {
      throw new CliError(
        "network_error",
        "Could not connect to the API to verify this token. Check your connection and --base-url, then try again.",
        { exitCode: 5, cause: error },
      );
    }
    throw error;
  }
}

export function normalizeAuthToken(token: string): string {
  const normalized = token.trim();
  if (!normalized || /\s/.test(normalized)) {
    throw new CliError(
      "invalid_token",
      "Provide a non-empty API token without spaces or line breaks.",
      { exitCode: 2 },
    );
  }
  return normalized;
}

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

export async function resolveAuth(
  options: AuthOptions = {},
): Promise<AuthResolution> {
  if (options.profile !== undefined) profileName({ defaultProfile: "default", profiles: {} }, options.profile);
  if (options.token !== undefined) {
    const token = normalizeAuthToken(options.token);
    return {
      token,
      source: "flag",
      redacted: redactSecret(token),
    };
  }

  if (process.env.REPLICATE_API_TOKEN) {
    const token = normalizeAuthToken(process.env.REPLICATE_API_TOKEN);
    return {
      token,
      source: "env",
      redacted: redactSecret(token),
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
      redacted: redactSecret(token),
    };
  }

  return { source: "missing", profile: name };
}

export async function requireAuth(
  options: AuthOptions = {},
): Promise<AuthResolution> {
  const auth = await resolveAuth(options);
  if (!auth.token) {
    throw new CliError(
      "auth_missing",
      "Replicate API token is missing. Set REPLICATE_API_TOKEN or run `replicate auth set --token <token>`.",
      { exitCode: 2 },
    );
  }
  return auth;
}

export async function setAuthToken(
  token: string,
  options: AuthOptions = {},
): Promise<{ profile: string; configPath: string; token: string }> {
  token = normalizeAuthToken(token);
  const config = await readConfig(options.config);
  const name = profileName(config, options.profile);
  config.defaultProfile = name;
  config.profiles[name] = { token };
  const configPath = await writeConfig(config, options.config);
  return { profile: name, configPath, token: redactSecret(token) };
}

export async function clearAuthToken(
  options: AuthOptions = {},
): Promise<{ cleared: true }> {
  if (options.profile !== undefined) {
    profileName({ defaultProfile: "default", profiles: {} }, options.profile);
    const config = await readConfig(options.config);
    delete config.profiles[options.profile];
    if (config.defaultProfile === options.profile)
      config.defaultProfile = "default";
    await writeConfig(config, options.config);
    return { cleared: true };
  }

  await deleteConfig(options.config);
  return { cleared: true };
}

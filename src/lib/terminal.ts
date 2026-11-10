// Keep human output compact and readable in terminals, pipes, and NO_COLOR mode.
export function details(
  title: string,
  rows: Array<[label: string, value: unknown]>,
  hint?: string,
): string {
  const visible = rows.filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  const width = Math.max(0, ...visible.map(([label]) => label.length));
  const color =
    process.stdout.isTTY &&
    process.env.NO_COLOR === undefined &&
    process.env.TERM !== "dumb";
  const heading = color ? `\u001b[1m${title}\u001b[22m` : title;
  const lines = visible.map(
    ([label, value]) => `  ${label.padEnd(width)}  ${String(value)}`,
  );
  return [heading, ...lines, ...(hint ? ["", hint] : [])].join("\n");
}

export function authSourceLabel(source: string): string {
  return (
    (
      {
        flag: "--token",
        env: "REPLICATE_API_TOKEN",
        config: "Saved config",
        missing: "None",
      } as Record<string, string>
    )[source] ?? source
  );
}

export function accountLabel(account?: {
  username: string;
  name?: string | null;
}): string | undefined {
  if (!account) return undefined;
  return account.name
    ? `${account.name} (@${account.username})`
    : `@${account.username}`;
}

export function terminalSafe(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\p{Cc}/gu, character => character === "\n" || character === "\t" ? character : "");
  if (Array.isArray(value)) return value.map(terminalSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [terminalSafe(key), terminalSafe(child)]));
  return value;
}

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extractSceneMetadata } from "./png-metadata";

export type ContextFormat = "token" | "markdown" | "json" | "codex";

export const contextFormats = ["token", "markdown", "json", "codex"] as const satisfies readonly ContextFormat[];

export type QuickdrawResult = {
  path: string;
  mime: "image/png";
  width: number;
  height: number;
  clipboard: boolean;
  sha256: string;
  token: string;
  markdown: string;
  inspect: string;
};

export type QuickdrawContext = {
  kind: "quickdraw.context.v1";
  artifact: {
    path: string;
    mime: "image/png";
    width: number;
    height: number;
    sha256: string;
  };
  scene?: unknown;
  token: string;
  markdown: string;
  inspect: string;
};

type QuickdrawResultBase = Omit<QuickdrawResult, "sha256" | "token" | "markdown" | "inspect">;

export function completeQuickdrawResult(result: QuickdrawResultBase): QuickdrawResult {
  const token = `@${result.path}`;
  return {
    ...result,
    sha256: createHash("sha256").update(readFileSync(result.path)).digest("hex"),
    token,
    markdown: `![quickdraw output](${result.path})`,
    inspect: `quickdraw inspect ${shellQuote(result.path)} --json`
  };
}

export function buildQuickdrawContext(result: QuickdrawResult): QuickdrawContext {
  const scene = readScene(result.path);
  return {
    kind: "quickdraw.context.v1",
    artifact: {
      path: result.path,
      mime: result.mime,
      width: result.width,
      height: result.height,
      sha256: result.sha256
    },
    ...(scene === null ? {} : { scene }),
    token: result.token,
    markdown: result.markdown,
    inspect: result.inspect
  };
}

export function formatQuickdrawContext(result: QuickdrawResult, format: ContextFormat): string {
  if (format === "token") return result.token;
  if (format === "markdown" || format === "codex") return result.markdown;
  return JSON.stringify(buildQuickdrawContext(result), null, 2);
}

function readScene(path: string): unknown | null {
  try {
    return extractSceneMetadata(readFileSync(path));
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { copyImageToClipboard } from "./clipboard";
import { embedSceneMetadata } from "./png-metadata";
import { normalizeScene, type SceneSpec } from "./spec";

export type CliMode =
  | { kind: "blank"; scene?: SceneSpec }
  | { kind: "edit"; path: string; scene?: SceneSpec };

export type QuickdrawResult = {
  path: string;
  mime: "image/png";
  width: number;
  height: number;
  clipboard: boolean;
};

type ServerOptions = {
  open?: boolean;
};

type SourcePayload =
  | { kind: "blank"; scene?: SceneSpec }
  | { kind: "image"; name: string; dataUrl: string; scene?: SceneSpec };

const imageMimeByExt: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

function sourceForMode(mode: CliMode): SourcePayload {
  if (mode.kind === "blank") return { kind: "blank", scene: mode.scene };
  const bytes = readFileSync(mode.path);
  const mime = imageMimeByExt[extname(mode.path).toLowerCase()] ?? "application/octet-stream";
  return {
    kind: "image",
    name: mode.path,
    dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
    scene: mode.scene
  };
}

function openBrowser(url: string) {
  const command = process.platform === "darwin" ? ["open", url] : ["xdg-open", url];
  Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
}

function pngBufferFromDataUrl(dataUrl: string): Buffer {
  const marker = "base64,";
  const index = dataUrl.indexOf(marker);
  if (!dataUrl.startsWith("data:image/png;") || index === -1) {
    throw new Error("expected PNG data URL");
  }
  return Buffer.from(dataUrl.slice(index + marker.length), "base64");
}

export async function startQuickdrawServer(mode: CliMode, options: ServerOptions = {}) {
  mkdirSync("/tmp", { recursive: true });
  const source = sourceForMode(mode);
  const token = randomBytes(12).toString("hex");
  const outPath = join("/tmp", `quickdraw-${token.slice(0, 8)}.png`);

  let resolveResult!: (result: QuickdrawResult) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<QuickdrawResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const vite: ViteDevServer = await createViteServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    appType: "spa",
    server: {
      host: "127.0.0.1",
      port: 0
    },
    plugins: [
      {
        name: "quickdraw-api",
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const url = new URL(req.url ?? "/", "http://127.0.0.1");
            if (url.pathname === "/api/source") {
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify(source));
              return;
            }

            if (url.pathname === "/api/done" && req.method === "POST") {
              const chunks: Buffer[] = [];
              for await (const chunk of req) chunks.push(Buffer.from(chunk));
              const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
                dataUrl?: string;
                width?: number;
                height?: number;
                scene?: unknown;
              };
              if (!body.dataUrl || typeof body.width !== "number" || typeof body.height !== "number") {
                res.statusCode = 400;
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ error: "invalid payload" }));
                return;
              }
              const png = pngBufferFromDataUrl(body.dataUrl);
              const finalPng = body.scene ? embedSceneMetadata(png, normalizeScene(body.scene)) : png;
              writeFileSync(outPath, finalPng);
              let clipboard = false;
              try {
                clipboard = copyImageToClipboard(outPath);
              } catch {
                clipboard = false;
              }
              resolveResult({
                path: outPath,
                mime: "image/png",
                width: body.width,
                height: body.height,
                clipboard
              });
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ ok: true }));
              return;
            }

            if (url.pathname === "/api/cancel" && req.method === "POST") {
              rejectResult(new Error("cancelled"));
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ ok: true }));
              return;
            }

            next();
          });
        }
      }
    ]
  });
  await vite.listen();
  const origin = vite.resolvedUrls?.local[0]?.replace(/\/$/, "");
  if (!origin) throw new Error("failed to start quickdraw server");
  const url = `${origin}/?token=${token}`;
  if (options.open !== false) openBrowser(url);

  return {
    url,
    result,
    stop() {
      void vite.close();
    }
  };
}

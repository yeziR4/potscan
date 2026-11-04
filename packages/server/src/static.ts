import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

/** First path segments the web app routes; must match parseRoute in packages/web/src/router.tsx. */
const APP_ROUTES = new Set(["", "explorer", "status", "blocks", "contracts", "block", "extrinsic", "tx", "account", "address"]);

/**
 * Serves the built web app. App routes get index.html so a reload keeps working; any other path gets
 * the same page with a 404 status, so crawlers and link checkers see a missing page as missing.
 */
export function createStatic(root: string) {
  const index = join(root, "index.html");
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!existsSync(index)) return false;
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    const path = normalize(join(root, pathname));
    const isFile = path.startsWith(root + sep) && existsSync(path) && statSync(path).isFile();

    if (isFile) return send(res, path, 200);
    // A missing asset is never the app.
    if (extname(pathname)) return notFound(res);
    return send(res, index, APP_ROUTES.has(pathname.split("/")[1] ?? "") ? 200 : 404);
  };
}

function send(res: ServerResponse, file: string, status: number): true {
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(status, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(file).pipe(res);
  return true;
}

function notFound(res: ServerResponse): true {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  return true;
}

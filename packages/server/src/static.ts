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

/** Serves the built web app; unknown paths get index.html so client-side routes survive a reload. */
export function createStatic(root: string) {
  const index = join(root, "index.html");
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!existsSync(index)) return false;
    const path = normalize(join(root, decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname)));
    const inside = path.startsWith(root + sep);
    const file = inside && existsSync(path) && statSync(path).isFile() ? path : index;
    const immutable = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
    createReadStream(file).pipe(res);
    return true;
  };
}

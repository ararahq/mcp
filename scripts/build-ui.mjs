import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const PANELS = ["campaign", "broadcast", "status", "conversation"];
const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "build", "ui");

const page = (title, css, js) => `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>${css}</style>
</head>
<body>
<div id="app"><div class="panel"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div></div>
<script>${js}</script>
</body>
</html>
`;

await mkdir(OUT_DIR, { recursive: true });
for (const panel of PANELS) {
  const result = await build({
    entryPoints: [path.join(ROOT, "src", "ui", "app", `${panel}.ts`)],
    bundle: true,
    write: false,
    outdir: OUT_DIR,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    legalComments: "none",
    logLevel: "error",
  });
  const js = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
  const css = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
  const html = page(`Arara · ${panel}`, css, js.replace(/<\/script>/g, "<\\/script>"));
  await writeFile(path.join(OUT_DIR, `${panel}.html`), html, "utf8");
  process.stdout.write(`ui/${panel}.html ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB\n`);
}

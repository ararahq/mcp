import { readFile } from "node:fs/promises";
import path from "node:path";
import type { UiPanel } from "./resources.js";

const FALLBACK_HTML = "<!doctype html><p>Panel not built. Run npm run build.</p>";

/** Node loader: panels live next to this module in build/ui after `npm run build`. */
export const loadPanelFromDisk =
  (dir = import.meta.dirname) =>
  async (panel: UiPanel): Promise<string> =>
    readFile(path.join(dir, `${panel}.html`), "utf8").catch(() => FALLBACK_HTML);

// OpenSlate desktop — Electrobun main (Bun) process.
//
// This is a stub. Electrobun is not yet a dependency (to keep `bun install` light),
// so the import below won't resolve until you run `bun add -d electrobun`. See
// README.md for the full setup. The pattern itself is per Electrobun's docs.
import { BrowserWindow } from "electrobun/bun";

// Load the bundled web build by default. To develop against the live Vite dev
// server instead, set OPENSLATE_URL, e.g. OPENSLATE_URL=http://localhost:5173
const url = process.env.OPENSLATE_URL ?? "views://mainview/index.html";

new BrowserWindow({
  title: "OpenSlate",
  url,
});

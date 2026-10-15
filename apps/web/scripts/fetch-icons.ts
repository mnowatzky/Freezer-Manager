// Downloads a Material Symbols Rounded variable-font subset containing only the icons
// listed in src/theme/icon-names.txt (one per line). Run after adding an icon:
//   pnpm --filter @freezer/web fetch-icons
import { readFileSync, writeFileSync } from "node:fs";

const names = readFileSync(new URL("../src/theme/icon-names.txt", import.meta.url), "utf8")
  .split(/\s+/)
  .filter(Boolean)
  .sort();
const url =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" +
  `&icon_names=${names.join(",")}&display=block`;
// A modern UA makes Google Fonts return a single variable woff2 instead of static instances.
const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const css = await (await fetch(url, { headers: { "User-Agent": ua } })).text();
const fontUrl = /url\((https:[^)]+)\)/.exec(css)?.[1];
if (!fontUrl || !css.includes("font-weight: 100 700")) throw new Error(`Unexpected response:\n${css}`);
const font = Buffer.from(await (await fetch(fontUrl)).arrayBuffer());
writeFileSync(new URL("../public/fonts/material-symbols-rounded.woff2", import.meta.url), font);
console.log(`Wrote ${names.length} icons (${(font.length / 1024).toFixed(1)} KiB)`);

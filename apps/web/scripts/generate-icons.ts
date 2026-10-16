// Generates the PWA icon set from the adaptive-icon artwork in assets/ (108×108 canvas with
// the logo inside Android's safe zone). Run: pnpm --filter @freezer/web generate-icons
//
// - pwa-*.png            purpose "any": round icon (for shortcuts/desktop, where nothing masks it)
// - maskable-*.png       purpose "maskable": full-bleed, Android applies the launcher shape
// - monochrome-*.png     purpose "monochrome": silhouette for Android themed icons
// - apple-touch-icon.png iOS (rounds the corners itself)
// - favicon-*.png
import sharp from "sharp";

const asset = (name: string) => new URL(`../assets/${name}`, import.meta.url).pathname;
const out = (name: string) => new URL(`../public/${name}`, import.meta.url).pathname;

// The cooler box (66×~46 units, half-diagonal ≈ 41) nearly fills the safe zone, so any round
// mask would clip its corners. `scale` zooms the artwork: <1 shrinks it onto a padded canvas.
const BRAND = "#35A9B5";

async function render(svg: string, size: number, scale: number, background?: string) {
  const inner = Math.round(size * scale);
  const img = await sharp(asset(svg), { density: 72 * (inner / 108) * 2 }).resize(inner, inner).png().toBuffer();
  if (scale >= 1) {
    const offset = Math.round((inner - size) / 2);
    return sharp(img).extract({ left: offset, top: offset, width: size, height: size }).png().toBuffer();
  }
  const pad = Math.round((size - inner) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: img, left: pad, top: pad }])
    .png()
    .toBuffer();
}

const circle = (size: number) =>
  Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`);

// Round "any" icon: box corners stay well inside the circle.
async function round(size: number, file: string) {
  const img = await render("icon.svg", size, 108 / 100);
  await sharp(img).composite([{ input: circle(size), blend: "dest-in" }]).png().toFile(out(file));
}

// Maskable/monochrome: shrink so the box fits Android's visible circle (radius 36 of 108).
const SAFE = 0.74;

for (const size of [64, 192, 512]) await round(size, `pwa-${size}x${size}.png`);
await round(48, "favicon-48x48.png");
await sharp(await render("icon.svg", 512, SAFE, BRAND)).toFile(out("maskable-icon-512x512.png"));
await sharp(await render("icon-monochrome.svg", 512, SAFE)).toFile(out("monochrome-icon-512x512.png"));
await sharp(await render("icon.svg", 180, 1.2)).toFile(out("apple-touch-icon-180x180.png"));
console.log("Icons written to public/");

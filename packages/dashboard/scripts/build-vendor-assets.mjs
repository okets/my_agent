import { mkdir, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, "..");

const copies = [
  {
    from: "node_modules/alpinejs/dist/cdn.min.js",
    to: "public/vendor/alpinejs/cdn.min.js",
  },
  {
    from: "node_modules/@alpinejs/collapse/dist/cdn.min.js",
    to: "public/vendor/alpinejs/collapse.min.js",
  },
  {
    from: "node_modules/marked/lib/marked.umd.js",
    to: "public/vendor/marked/marked.umd.js",
  },
  {
    from: "node_modules/dompurify/dist/purify.min.js",
    to: "public/vendor/dompurify/purify.min.js",
  },
  {
    from: "node_modules/fullcalendar/index.global.min.js",
    to: "public/vendor/fullcalendar/index.global.min.js",
  },
  {
    from: "node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2",
    to: "public/fonts/inter-latin-400-normal.woff2",
  },
  {
    from: "node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2",
    to: "public/fonts/inter-latin-500-normal.woff2",
  },
  {
    from: "node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2",
    to: "public/fonts/inter-latin-600-normal.woff2",
  },
  {
    from: "node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2",
    to: "public/fonts/inter-latin-700-normal.woff2",
  },
  {
    from: "node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff2",
    to: "public/fonts/space-grotesk-latin-500-normal.woff2",
  },
  {
    from: "node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2",
    to: "public/fonts/space-grotesk-latin-700-normal.woff2",
  },
];

for (const asset of copies) {
  const fromPath = join(rootDir, asset.from);
  const toPath = join(rootDir, asset.to);
  await mkdir(dirname(toPath), { recursive: true });
  await copyFile(fromPath, toPath);
}

console.log(`Copied ${copies.length} vendor assets.`);

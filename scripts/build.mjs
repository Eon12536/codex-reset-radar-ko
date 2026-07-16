import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const icons = path.join(root, "assets", "icons");
fs.mkdirSync(dist, { recursive: true });
fs.mkdirSync(icons, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  await sharp(path.join(root, "assets", "icon.svg"))
    .resize(size, size)
    .png()
    .toFile(path.join(icons, `icon${size}.png`));
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const zipPath = path.join(dist, `codex-reset-radar-v${packageJson.version}.zip`);
await new Promise((resolve, reject) => {
  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 9 } });
  output.on("close", resolve);
  archive.on("error", reject);
  archive.pipe(output);
  for (const entry of ["manifest.json", "src", "assets", "LICENSE", "PRIVACY.md", "THIRD_PARTY_NOTICES.md"]) {
    const full = path.join(root, entry);
    if (!fs.existsSync(full)) continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) archive.directory(full, entry);
    else archive.file(full, { name: entry });
  }
  archive.finalize();
});
console.log(`Built ${path.relative(root, zipPath)}`);

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
  await sharp(path.join(root, "scripts", "brand-source.png"))
    .resize(size, size)
    .png()
    .toFile(path.join(icons, `icon${size}.png`));
}

// Notifications use embedded PNG bytes, so worker-relative file paths and
// resource fetching cannot break the icon after an extension update.
const notificationIcon = fs.readFileSync(path.join(icons, "icon128.png")).toString("base64");
fs.writeFileSync(path.join(root, "src/core/notification-icon.js"),
  `// Generated from assets/icons/icon128.png by scripts/build.mjs.\n` +
  `globalThis.RadarNotificationIcon = ${JSON.stringify("data:image/png;base64," + notificationIcon)};\n`);

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const zipPath = path.join(dist, `codex-reset-radar-ko-v${packageJson.version}.zip`);
await new Promise((resolve, reject) => {
  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 9 } });
  output.on("close", resolve);
  archive.on("error", reject);
  archive.pipe(output);
  for (const entry of ["manifest.json", "_locales", "src", "assets", "LICENSE", "PRIVACY.md", "THIRD_PARTY_NOTICES.md", "README.ko.md"]) {
    const full = path.join(root, entry);
    if (!fs.existsSync(full)) continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) archive.directory(full, entry);
    else archive.file(full, { name: entry });
  }
  archive.finalize();
});
console.log(`Built ${path.relative(root, zipPath)}`);

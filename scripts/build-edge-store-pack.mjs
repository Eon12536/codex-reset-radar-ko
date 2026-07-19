import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const sourceDir = path.join(root, "dist", `store-v${version}`);
const outputDir = path.join(root, "dist", `edge-v${version}`);

const files = [
  [`../codex-reset-radar-v${version}.zip`, `codex-reset-radar-edge-v${version}.zip`],
  ["codex-reset-radar-icon-128.png", "codex-reset-radar-icon-128.png"],
  ["global-01-radar-quota-1280x800.png", "global-01-radar-quota-1280x800.png"],
  ["global-02-privacy-1280x800.png", "global-02-privacy-1280x800.png"],
  ["global-03-eight-languages-1280x800.png", "global-03-eight-languages-1280x800.png"],
  ["global-small-tile-440x280.png", "global-small-tile-440x280.png"]
];

fs.mkdirSync(outputDir, { recursive: true });
for (const [source, destination] of files) {
  const sourcePath = path.resolve(sourceDir, source);
  if (!fs.existsSync(sourcePath)) throw new Error(`Missing Edge store asset: ${sourcePath}`);
  fs.copyFileSync(sourcePath, path.join(outputDir, destination));
}

fs.copyFileSync(
  path.join(root, "docs", "EDGE_STORE_SUBMISSION.zh-CN.md"),
  path.join(outputDir, "EDGE_STORE_SUBMISSION.zh-CN.md")
);

console.log(`Built ${path.relative(root, outputDir)}`);

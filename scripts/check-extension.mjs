import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const errors = [];

function exists(relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) errors.push(`Missing: ${relativePath}`);
}

if (manifest.manifest_version !== 3) errors.push("manifest_version must be 3");
for (const pathValue of [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {})
]) {
  if (pathValue) exists(pathValue);
}
for (const script of manifest.content_scripts || []) {
  for (const pathValue of [...(script.js || []), ...(script.css || [])]) exists(pathValue);
}
for (const group of manifest.web_accessible_resources || []) {
  for (const pathValue of group.resources || []) exists(pathValue);
}

const sourceFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (entry.name.endsWith(".js")) sourceFiles.push(fullPath);
  }
}
walk(path.join(root, "src"));

for (const file of sourceFiles) {
  const source = fs.readFileSync(file, "utf8");
  if (/\beval\s*\(|new Function\s*\(/.test(source)) errors.push(`Remote-code-like construct in ${path.relative(root, file)}`);
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    errors.push(`Syntax error in ${path.relative(root, file)}: ${String(error.stderr || error.message).trim()}`);
  }
}

const popupHtml = fs.readFileSync(path.join(root, "src/popup/popup.html"), "utf8");
const optionsHtml = fs.readFileSync(path.join(root, "src/options/options.html"), "utf8");
const backgroundSource = fs.readFileSync(path.join(root, "src/background.js"), "utf8");
const contentSource = fs.readFileSync(path.join(root, "src/content.js"), "utf8");

if ((popupHtml.match(/class="quota-row"/g) || []).length !== 2) errors.push("Popup must contain exactly two quota rows");
for (const id of ["signalHeadline", "viewEvidence", "creditsCount", "advicePanel", "refreshButton"]) {
  if (!popupHtml.includes(`id="${id}"`)) errors.push(`Popup is missing #${id}`);
}
if ((optionsHtml.match(/class="nav-item/g) || []).length !== 4) errors.push("Options page must contain four navigation items");
for (const id of [
  "monitorSignals", "monitorAccount", "confidenceThresholdHigh", "timezoneModeSystem",
  "timezoneModeManual", "notifyOfficialReset", "notifyCreditExpiry", "notifyAdvice", "clearData"
]) {
  if (!optionsHtml.includes(`id="${id}"`)) errors.push(`Options page is missing #${id}`);
}
for (const required of [
  "chrome.notifications.onButtonClicked",
  "查看证据",
  "稍后提醒",
  "chrome.runtime.openOptionsPage"
]) {
  if (!backgroundSource.includes(required)) errors.push(`Notification action missing: ${required}`);
}
if (/method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i.test(backgroundSource + contentSource)) {
  errors.push("Account integration must remain read-only");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Extension check passed: ${sourceFiles.length} JavaScript files and manifest paths verified.`);

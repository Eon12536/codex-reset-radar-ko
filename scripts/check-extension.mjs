import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const errors = [];

function exists(relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) errors.push(`Missing: ${relativePath}`);
}

if (manifest.manifest_version !== 3) errors.push("manifest_version must be 3");
if (manifest.default_locale !== "ko") errors.push("default_locale must be ko");
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

const manifestLocales = ["en", "zh_CN", "ja", "ko", "fr", "it", "es", "ar"];
for (const locale of manifestLocales) exists(`_locales/${locale}/messages.json`);
for (const locale of manifestLocales) {
  const messagesPath = path.join(root, "_locales", locale, "messages.json");
  if (!fs.existsSync(messagesPath)) continue;
  try {
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
    if (!messages.extensionName?.message || !messages.extensionDescription?.message) {
      errors.push(`Locale ${locale} must define extensionName and extensionDescription`);
    }
  } catch (error) {
    errors.push(`Invalid locale JSON for ${locale}: ${error.message}`);
  }
}

const translationSandbox = { globalThis: {} };
try {
  vm.runInNewContext(fs.readFileSync(path.join(root, "src/core/translations.js"), "utf8"), translationSandbox);
  const catalogs = translationSandbox.globalThis.RadarTranslations;
  const referenceKeys = Object.keys(catalogs.zh_CN || {});
  for (const locale of manifestLocales.filter((value) => !["en", "zh_CN"].includes(value))) {
    const catalog = catalogs[locale];
    if (!catalog) {
      errors.push(`Missing runtime translation catalog: ${locale}`);
      continue;
    }
    const missing = referenceKeys.filter((key) => !(key in catalog));
    if (missing.length) errors.push(`Runtime locale ${locale} is missing: ${missing.join(", ")}`);
    for (const key of referenceKeys) {
      const expected = [...String(catalogs.zh_CN[key]).matchAll(/\{\d+\}/g)].map((match) => match[0]).sort().join(",");
      const actual = [...String(catalog[key] || "").matchAll(/\{\d+\}/g)].map((match) => match[0]).sort().join(",");
      if (expected !== actual) errors.push(`Runtime locale ${locale} has invalid placeholders for ${key}`);
    }
  }
} catch (error) {
  errors.push(`Runtime translations are invalid: ${error.message}`);
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
exists("src/core/theme.js");
exists("src/shared/theme.css");
const backgroundSource = fs.readFileSync(path.join(root, "src/background.js"), "utf8");
const contentSource = "";
if (manifest.content_scripts?.length) errors.push("Unconditional page injection is not permitted; Chat counter must be opt-in");
if (JSON.stringify(manifest.optional_permissions) !== JSON.stringify(["scripting"]) ||
    JSON.stringify(manifest.optional_host_permissions) !== JSON.stringify(["https://x.com/*"])) errors.push("Optional access must stay limited to scripting and X");
exists("src/chat-counter.js");
exists("src/core/chat-counter.js");
exists("src/core/direct-x.js");
exists("src/x-reader.js");
if (manifest.web_accessible_resources?.length) errors.push("Hardened build must not expose extension resources to pages");
if (manifest.permissions.includes("tabs")) errors.push("Broad tabs permission is not needed");
if (fs.existsSync(path.join(root, "src/content.js"))) errors.push("Legacy content script must not be packaged");
if (!manifest.content_security_policy?.extension_pages.includes("connect-src 'self' data: https://chatgpt.com")) errors.push("Network CSP must allow bundled inline notification images and explicit API origins");
exists("src/core/notification-icon.js");
exists("src/options/notification-test.js");

if ((popupHtml.match(/class="quota-row"/g) || []).length !== 2) errors.push("Popup must contain exactly two quota rows");
for (const id of ["newsList", "newsEmpty", "newsCount", "chatCountValue", "enableChatCounter", "creditsCount", "advicePanel", "refreshButton"]) {
  if (!popupHtml.includes(`id="${id}"`)) errors.push(`Popup is missing #${id}`);
}
if ((optionsHtml.match(/class="nav-item/g) || []).length !== 4) errors.push("Options page must contain four navigation items");
for (const theme of ["light", "dark", "system"]) {
  if (!optionsHtml.includes(`type="radio" name="theme" value="${theme}"`)) errors.push(`Options page is missing the ${theme} theme choice`);
}
for (const id of [
  "monitorSignals", "monitorAccount", "confidenceThresholdHigh", "timezoneModeSystem",
  "timezoneModeManual", "notifyOfficialReset", "notifyCreditExpiry", "notifyAdvice", "clearData", "theme"
]) {
  if (!optionsHtml.includes(`id="${id}"`)) errors.push(`Options page is missing #${id}`);
}
for (const required of [
  "chrome.notifications.onButtonClicked",
  "viewEvidence",
  "remindLater",
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

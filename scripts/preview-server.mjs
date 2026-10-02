import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const port = Number(process.env.PORT || 4173);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
  let relative;
  try { relative = decodeURIComponent(url.pathname).replace(/^\/+/, ""); }
  catch { response.writeHead(400); response.end("Bad path"); return; }
  const filePath = path.resolve(root, relative || "src/welcome/welcome.html");
  const inside = path.relative(root, filePath);
  const allowed = /^(src|assets)[/\\]/.test(inside)
    || ["browser-preview-mock.js", "chat-meter-preview.html", "popup-size-check.html", "theme-picker-preview.html", "country-picker-preview.html", "notification-image-check.html", "notification-image-check.js", "notification-image-worker.js"].some(name => inside === path.join("scripts", name));
  if (!allowed || inside.startsWith("..") || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const workerCsp = inside === path.join("scripts", "notification-image-worker.js")
    ? { "content-security-policy": JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")).content_security_policy.extension_pages } : {};
  response.writeHead(200, {
    "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream",
    "cache-control": "no-store",
    ...workerCsp
  });
  if (path.extname(filePath) === ".html") {
    const html = fs.readFileSync(filePath, "utf8")
      .replace("<head>", '<head><meta name="darkreader-lock"><script src="/scripts/browser-preview-mock.js"></script>')
      .replace("<body>", '<body><aside style="position:fixed;right:12px;bottom:8px;font:12px sans-serif;color:#999;z-index:9999">미리보기 · 예시 데이터 · 실제 알림 없음</aside>');
    response.end(html);
    return;
  }
  fs.createReadStream(filePath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Preview server: http://127.0.0.1:${port}`);
});

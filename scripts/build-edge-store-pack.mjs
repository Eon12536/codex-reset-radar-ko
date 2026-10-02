import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
if (manifest.version !== version) throw new Error("Package and manifest versions must match before preparing a release.");
const outputDir = path.join(root, "dist", `codex-reset-radar-ko-edge-preparation-v${version}`);

const files = [
  [`dist/codex-reset-radar-ko-v${version}.zip`, `codex-reset-radar-ko-v${version}.zip`],
  ["assets/icons/icon128.png", "codex-reset-radar-ko-icon-128.png"],
  ["PRIVACY.md", "PRIVACY.md"],
  ["README.ko.md", "README.ko.md"]
];

// Fail before writing a partial pack when verify/build has not produced the
// current version. Store images and submission metadata require separate work.
for (const [source] of files) {
  const sourcePath = path.join(root, source);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile())
    throw new Error(`Missing release input: ${source}. Run npm run verify first.`);
}
fs.mkdirSync(outputDir, { recursive: true });
for (const [source, destination] of files) {
  fs.copyFileSync(path.join(root, source), path.join(outputDir, destination));
}

fs.writeFileSync(path.join(outputDir, "README.md"), `# Codex Reset Radar KO ${version} · Edge 게시 준비 자료

이 폴더는 현재 한국어 파생판의 게시 준비 자료입니다. Edge Add-ons 제출 완료 또는 스토어 심사 통과를 의미하지 않습니다.

## 포함 파일

- codex-reset-radar-ko-v${version}.zip: 현재 버전의 확장프로그램 패키지
- codex-reset-radar-ko-icon-128.png: 현재 아이콘
- README.ko.md: 설치·사용 안내
- PRIVACY.md: 현재 개인정보 처리 설명

## 제출 전에 추가로 준비할 항목

- 현재 버전 화면을 사용한 홍보 이미지·스크린샷과 스토어 설명
- 이 파생판의 공개 프로젝트·지원 페이지 및 개인정보 처리방침 URL
- 이미지·명칭 사용에 필요한 권리 확인과 스토어에서 요구하는 게시자 정보
- Microsoft Edge의 실제 설치·권한·알림 동작 확인 및 제출 시점의 스토어 요구사항 점검

원저자의 지원 URL이나 오래된 홍보 이미지는 이 준비 자료에 포함하지 않습니다. 외부 스토어 업로드는 자동으로 수행하지 않습니다.
`, "utf8");

console.log(`Prepared Edge submission inputs (additional store materials required): ${path.relative(root, outputDir)}`);

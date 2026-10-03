# Codex Reset Radar · 리셋 레이더

OpenAI · Tibo · VB의 리셋 소식, Codex 잔여량과 Banked reset 리셋권을 확인하는 Chrome/Edge 확장프로그램입니다. **OpenAI 공식 제품이 아닌 커뮤니티 파생판**입니다.

## 설치와 업데이트

1. [최신 배포](https://github.com/Eon12536/codex-reset-radar-ko/releases/latest)에서 `CodexReset-Radar-KO-0.2.63.zip`을 내려받아 압축을 풉니다.
2. `chrome://extensions/` 또는 `edge://extensions/`에서 개발자 모드를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누르고 `manifest.json`이 있는 폴더를 선택합니다.
4. 확장을 고정하고 필요한 조회 기능을 직접 켭니다. 계정 조회와 선택형 화면 접근은 동의 후에만 작동합니다.

업데이트는 기존 설치 폴더에 최신 파일을 덮어쓴 다음 확장 관리에서 **새로고침**하세요. 같은 확장을 삭제하지 않고 업데이트하면 로컬 설정·읽음·집계 기록을 유지합니다. ChatGPT 탭도 새로고침하세요. ZIP 설치는 자동 업데이트되지 않습니다.

## 주요 기능

- Codex 5시간·주간 잔여량, 리셋 시각, 리셋권 보유·만료 상태
- X 공지가 없어도 계정의 Banked reset 증가를 별도로 감지
- 주간 `%` 배지와 미확인 `!`: 리셋권 영역에서 확인하거나 24시간이 지나면 해제
- 리셋 소식 우선 표시, 일정이 있는 행사 묶기와 종료까지 고정
- 출시 후보, 작성자 사진, 원문 링크, 긴 글 말줄임
- 8개국·7개 언어, 대표 지역 시간대 자동 변환, 라이트·다크 테마
- 일반 Chat 모델별 기록과 추정 잔여량
- Free·Go·Plus부터 Pro·Business·Enterprise·Edu까지 전체 요금제 표시, 현재 계정의 요금제 선택 상태 표시
- 알림 대기열, 전송 재시도, Chrome 재시작·절전 복귀 후 확인

## 사용 전 알아두기

**X 계정 없이도 기본 공개 피드와 계정 사용량 조회를 사용할 수 있습니다.** 하지만 피드가 오래되거나 중단되면 최신 글을 얻지 못합니다. 최신 원글·답글 확인에는 설정의 **X 직접 확인**과 브라우저 접근 허용이 필요하며 X에서 로그인을 요구할 수 있습니다. 제공처와 X 화면의 접근 제한 때문에 모든 글의 탐지를 보장하지는 않습니다. 이미지·영상 속 발언은 분석하지 않습니다.

**Chat 숫자는 서버가 보증한 잔여량이 아닌, 확인한 기록에 기반한 추정치**입니다. 삭제·임시 대화, 조회 범위, 요금제와 초기화 시점 차이가 영향을 줍니다. 현재 정량 한도가 확인되지 않은 Pro $200·$500에는 임의 퍼센트를 만들지 않습니다. Pro $200은 목록에 하나만 표시하며, 과거 9/27 기준의 저장된 선택도 현재 항목으로 연결합니다. 사용 기록은 보존하고 과거 한도로 현재 잔여량을 계산하지 않습니다.

Windows 알림은 Chrome 실행, 확장 알림 설정, Windows 알림 허용과 방해 금지 설정의 영향을 받습니다. Chrome의 알림 접수가 실제 Windows 표시·소리를 보장하지는 않습니다.

정기 확인은 로컬 규칙과 읽기 전용 HTTP 요청을 사용합니다. **AI API나 Codex 추론 토큰을 사용하지 않습니다.**

## 새 모델과 한도 변경

계정에서 조회하는 Codex 잔여량·리셋 시각·리셋권 상태는 조회 때 갱신됩니다. Chat 모델 분류와 요금제별 수치 기준은 확장에 포함된 표를 사용하므로, 새 모델·정책 변경 시 확인과 새 버전 배포가 필요합니다. 모델 출시 소식 탐지는 이 표를 자동 수정하지 않습니다.

Chat 메시지 한도와 Work/Codex 사용량, API 토큰 한도는 서로 다른 기준입니다. [OpenAI 공식 안내](https://help.openai.com/en/articles/20001354-gpt-56-and-gpt-6-pro-in-chatgpt)를 확인하며, 공개되지 않았거나 계정별로 다른 수치를 임의로 적용하지 않습니다. 현재 GitHub ZIP 설치는 새 파일을 덮어쓰고 확장을 새로고침하는 수동 업데이트 방식입니다.

## 피드백

- [오류 신고](https://github.com/Eon12536/codex-reset-radar-ko/issues/new?template=bug_report.yml)
- [기능 제안](https://github.com/Eon12536/codex-reset-radar-ko/issues/new?template=feature_request.yml)

버전·브라우저·재현 순서와 공개 원문 링크를 알려주세요. 스크린샷의 개인 정보는 가리고 토큰·쿠키·계정 ID·대화 본문·원본 API 응답은 올리지 마세요.

[자세한 한국어 설명서](README.ko.md) · [개인정보 처리](PRIVACY.md) · [기여 방법](CONTRIBUTING.md) · [제3자 고지](THIRD_PARTY_NOTICES.md)

## 개발 및 검증

Node.js 20.11 이상에서 실행합니다.

```sh
npm ci
npm run verify
```

`verify`는 패키징·확장 구문/권한 검사·회귀 테스트를 실행합니다. 결과 ZIP은 `dist/`에 생성됩니다. 의존성 설치 스크립트는 `.npmrc`에서 기본 차단하고 공식 npm 레지스트리를 사용합니다.

화면 확인: `node scripts/preview-server.mjs` 실행 후 `http://127.0.0.1:4173/src/popup/popup.html`. 이 화면은 **예시 데이터**이며 실제 계정·Windows 알림 검증을 대신하지 않습니다.

## 출처 및 라이선스

[whmc76/codex-reset-radar](https://github.com/whmc76/codex-reset-radar) v0.2.2 기반 파생판이며 원본과 기존 기여자의 MIT 고지를 유지합니다. [LICENSE](LICENSE)와 [제3자 자산 고지](THIRD_PARTY_NOTICES.md)를 확인하세요.

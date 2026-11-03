# Codex Reset Radar · 리셋 레이더

Version 0.2.144 recognizes concise public banked-reset announcements and numbered Tibo day-series posts.

Version 0.2.126 prevents another reader tab from opening after a browser restart when an unmarked tab could be the previous reader. Ambiguous tabs are not closed automatically; collection resumes after the ambiguity is resolved.

Version 0.2.125 recognizes the October 28 completion with its verified quoted reset-timing context, while retaining strict negation and unrelated-post safeguards.

Version 0.2.124 preserves verified reply and quote evidence across incomplete or failed rechecks, retries unresolved completions sooner, restores missing retry alarms, and processes saved public posts after partial collection failures. Edited posts still invalidate stale relationships. No new permissions or external services are required.

Version 0.2.123 recognizes additional publicly verified reset completion language, including processed resets and bounded quoted follow-ups. The reader rechecks late-loading quote cards, and relative two-hour promises use verified or explicitly inferred reset context without inventing an execution time. Historical retention and daily alert limits remain unchanged.

Public news is grouped into one card per detection day, with summaries, explicit deadlines and every retained source link. Windows public-news alerts are limited to one accepted toast per selected-country calendar day; later findings update the popup silently. Account recovery, Banked credit and expiry alerts remain separate. Verified timing replies support bounded release asides; literal PST and publication-based relative dates are preserved. A ready on-device model no longer needs a popup setup shortcut.

The default check interval is 15 minutes. Official public news, reset-only filtering, reset candidates, startup/wake recovery and credit expiry alerts are enabled; quiet hours are off. Community reports and history-based estimates default off. On upgrade, these two community sources are switched off once and the old 30-minute interval becomes 15 minutes; custom 60/120-minute intervals and later saved choices survive. Account/Chat access stays opt-in.

OpenAI · Tibo · VB의 리셋 소식, Codex 잔여량과 Banked reset 리셋권을 확인하는 Chrome/Edge 확장프로그램입니다. **OpenAI 공식 제품이 아닌 커뮤니티 파생판**입니다.

## 설치와 업데이트

1. [최신 배포](https://github.com/Eon12536/codex-reset-radar-ko/releases/latest)에서 배포된 ZIP을 내려받아 압축을 풉니다. 이 소스의 패키지 이름은 `CodexReset-Radar-KO-0.2.144.zip`이며 공개 배포 버전과 다를 수 있습니다.
2. `chrome://extensions/` 또는 `edge://extensions/`에서 개발자 모드를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누르고 `manifest.json`이 있는 폴더를 선택합니다.
4. 확장을 고정합니다. X 직접 확인은 항상 켜짐이며, 설정의 **X 접근 허용·확인**에서 처음 한 번 접근을 허용합니다. 개인 계정 조회는 별도로 켜고 연결합니다.

업데이트는 기존 설치 폴더에 최신 파일을 덮어쓴 다음 확장 관리에서 **새로고침**하세요. 같은 확장을 삭제하지 않고 업데이트하면 로컬 설정·읽음·집계 기록을 유지합니다. ChatGPT 탭도 새로고침하세요. ZIP 설치는 자동 업데이트되지 않습니다.

## 주요 기능

- 일부 계정의 리셋 반영 문제 조사·보완 및 인용된 수정 완료 안내 알림 (0.2.64)

- Codex 5시간·주간 잔여량, 리셋 시각, 리셋권 보유·만료 상태
- X 공지가 없어도 계정의 Banked reset 증가를 별도로 감지
- 주간 `%` 배지와 미확인 `!`: 리셋권 영역에서 확인하거나 24시간이 지나면 해제
- 리셋 관련 글만 기본 표시·알림, 검증된 답글 문맥·설문·완료 연결 지원
- 작성자 사진, 게시 날짜·시각, 원문 링크, 긴 글 말줄임
- 일반 출시·행사 후보는 설정에서 리셋 전용 필터를 끈 경우에만 표시
- 8개국·7개 언어, 대표 지역 시간대 자동 변환, 라이트·다크 테마
- 일반 Chat 모델별 기록과 추정 잔여량
- Free·Go·Plus부터 Pro·Business·Enterprise·Edu까지 전체 요금제 표시, 현재 계정의 요금제 선택 상태 표시
- 알림 대기열, 전송 재시도, Chrome 재시작·절전 복귀 후 확인

## 사용 전 알아두기

**X 계정 없이도 기본 공개 피드와 계정 사용량 조회를 사용할 수 있습니다.** 하지만 피드가 오래되거나 중단되면 최신 글을 얻지 못합니다. X 직접 확인은 항상 켜짐이며 공개 소식 감시 중 정기·시작·절전 복귀 확인에 포함됩니다. 처음 한 번 설정의 **X 접근 허용·확인**에서 브라우저 접근을 허용해야 하며 X에서 로그인을 요구할 수 있습니다. 제공처와 X 화면의 접근 제한 때문에 모든 글의 탐지를 보장하지는 않습니다. 이미지·영상 속 발언은 분석하지 않습니다.

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

0.2.97 decouples inference retries from X collection. Retrying cached public posts never changes collection timestamps or creates X tabs. Inference is bounded at 45 seconds per post / 90 seconds per pass; repeat failures back off for 1–30 minutes without becoming negative classifications. The UI exposes the failing phase and error details; model availability is distinct from successful classification.

0.2.97 removes the artificial six/eight-post AI batch cap and three-conversation cap. Work drains within the existing 90-second AI / 270-second X limits. Deterministic alerts precede AI startup, and new positive AI results are delivered at checkpoints. Remaining work is scheduled from its earliest retry time with a 30-second minimum. Processing and failure recovery can still leave pending items; they are never labelled completed.

0.2.98 fixes a reproduced race found in Claude review: a second AI-only retry could swallow a pending fresh-post request while the mutation lock was released. Fresh requests now wait through AI-only jobs and still perform collection.

# Changelog

## 0.2.61 · 전체 재검수

- 잘못된 숫자 응답을 0으로 바꿔 잔여량·지급을 오인하지 않습니다.
- 대화 목록 일부가 실패해도 정상 목록의 기록 집계를 계속합니다.
- Banked 리셋권 소진 이후 다음 지급을 놓치던 비교 오류를 수정했습니다.
- 리셋권 상태가 이미 열린 경우에도 배너로 새 소식을 확인하거나 실패한 읽음 저장을 재시도할 수 있습니다.
- 알림 OFF·계정 변경·만료·소진·사용량 회복 시 오래된 계정 안내를 취소하고, 조회 실패 때는 대기합니다.
- 알려진 작성자의 짧은 global reset 일정 예고를 리셋으로 분류하고, 행사 시작·종료에 같은 시간대가 반복되어도 해석합니다.

Chrome 확장 관리에서 기존 설치를 새로고침해야 적용됩니다. 공개 피드/X 접근 제한과 Windows의 실제 토스트·소리 전달은 자동 테스트만으로 보장할 수 없습니다.

All notable changes to this project will be documented here.

## 0.2.2 - 2026-07-19

- Add complete runtime localization for English, Simplified Chinese, Japanese,
  Korean, French, Italian, Spanish, and Arabic.
- Localize the manifest, popup, settings, welcome page, advice engine, relative
  time formatting, and native notifications from one shared message catalog.
- Add right-to-left layout behavior for Arabic and automated locale-key,
  placeholder, direction, and language-selection checks.

## 0.2.1 - 2026-07-19

- Add weighted Codex lead, OpenAI Status, community reset-history, and GitHub community sources.
- Treat recent, repeated million-user reset milestones as a valid medium-confidence community forecast.
- Make ChatGPT login an optional enhancement; signed-out users retain the public radar, forecast, and signal notifications.

## 0.2.0 - 2026-07-19

- Add a time-zone-aware 72-hour reset forecast in six-hour slots.
- Keep actionable public signals active through their predicted event window.
- Label reset detection as public-signal analysis and document forecast limits.
- Expand deterministic tests for retention, expiry, probability, and time-zone alignment.

## 0.1.0 - 2026-07-16

- Initial Chrome/Edge Manifest V3 extension.
- Public Codex reset-signal monitoring with deduplication.
- Local Codex usage and banked reset-credit display.
- Rule-based reset-credit advice.
- Native browser notifications and quiet hours.
- System or manual IANA time-zone conversion.
- MIT license and GitHub community files.

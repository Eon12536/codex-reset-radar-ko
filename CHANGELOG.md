# Changelog

## 0.2.156 · 현재 ChatGPT 구독 화면 지원

- 변경된 /settings/billing 경로와 현재 구독 카드를 확인합니다. 과거 결제 내역·광고는 요금제 근거에서 제외합니다.
- Pro 100 현재 구독이 오래된 로그인·잔여량 응답의 Plus 값으로 덮어써지지 않도록 보완합니다.
- 이전 판별기의 확인 기록을 재검사하고 자동 조회는 수동 선택을 유지합니다. 확인 탭은 종료 후 정리합니다.
- 실제 ChatGPT 결제 화면에서 현재 Pro 100 카드 판별 확인. 전체 테스트 1,127개 통과.


## 0.2.155 · 요금제 확인·알림·탐지 신뢰성

- 팝업 갱신·자동 선택에서도 계정 요금제를 재확인하고 만료된 상충 정보는 미확인으로 표시합니다.
- 알림 접수 이후 기록 저장 실패의 중복 발송과 세션 소실 후 확인 탭 복구를 보완했습니다.
- 신모델 출시, Banked 리셋권 문맥, Telegram 인용 원문 연결과 조회 시간 배분을 보완했습니다.
- 기존 설정과 저장된 기록을 유지합니다. 전체 회귀 테스트 1,121개 통과.


## 0.2.64 · 리셋 후속 안내 탐지

- 일부 계정의 리셋 반영 문제 조사·보완 안내를 공식 공지 알림에 포함합니다.
- 인용문의 작성자·게시 시각·본문이 별도로 수집된 원문과 정확히 일치할 때 수정 완료 안내를 연결합니다.
- 팝업에 후속 안내로 표시하고, 추가 지급·예정 시각·사용량 초기화로 오인하지 않습니다.
- 기존 중복 방지·게시 시각 제한·알림 OFF·배지 읽음 기준을 유지합니다.

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

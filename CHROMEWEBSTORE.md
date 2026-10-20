# Chrome Web Store Listing — Codex 리셋 레이더 · 한국어

> Last Updated: 2026-10-20 · Version: 0.2.92 · Draft, Chrome Web Store 미제출
> GoogleChrome/modern-web-guidance의 chromewebstore-template.md 형식에 따라 작성. 실제 설정은 manifest.json, 데이터 처리 상세는 PRIVACY.md 기준.

## Store Listing

**Extension Name**: Codex 리셋 레이더 · 한국어

**Short Description**: OpenAI·Tibo·VB의 리셋 소식과 Codex 잔여량·리셋권을 확인하고 브라우저 알림을 받으세요.

**Detailed Description**

Codex 사용량과 리셋 소식을 한곳에서 확인하는 커뮤니티 확장프로그램입니다. OpenAI 공식 제품이 아닙니다.

OpenAI·Tibo·VB의 공개 리셋 예고와 완료 소식을 표시합니다. 일정이 확인된 행사는 종료까지 배너에 표시합니다. 계정을 연결하면 Codex 5시간·주간 잔여량, Banked reset 리셋권과 만료 시각을 확인하고 지급·만료 안내를 받을 수 있습니다. 선택한 국가에 맞춘 시간 표시와 밝은 테마·어두운 테마를 제공합니다. 일반 Chat 사용 기록과 잔여량 추정도 별도로 켤 수 있습니다.

확장을 고정한 뒤 설정에서 X 접근을 허용하세요. 공개 피드는 X 계정 없이도 조회할 수 있지만 X 직접 확인은 로그인이 필요할 수 있습니다. 개인 잔여량 조회와 Chat 기록 집계는 별도로 켜고 연결합니다. 알림을 받으려면 브라우저와 운영체제의 알림 허용이 필요합니다. PC나 브라우저가 꺼진 동안 실행되지 않으며 다음 실행 때 새 소식을 확인합니다.

설정과 표시용 기록은 기기에 보관합니다. Chat 계정 기록 동기화를 별도로 켜면 대화 내용이 포함될 수 있는 응답을 수신하지만 본문과 제목은 저장하거나 외부 분석 서버로 전송하지 않습니다. 공개 소식의 접근 제한과 요금제 차이 때문에 모든 글의 탐지나 추정 잔여량의 정확도를 보장하지 않습니다.

문의와 오류 신고: https://github.com/Eon12536/codex-reset-radar-ko/issues

**Category**: Productivity

**Single Purpose**: Codex 이용자가 사용 가능량·리셋권과 관련 공개 리셋 소식을 확인하고 필요한 알림을 받도록 돕습니다.

**Primary Language**: Korean (ko); 8개국·7개 언어 지원

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|---|---|---|---|
| Store Icon | 128×128 PNG | 패키지 아이콘 있음; 제출 전 제3자 자산 권리 재확인 필요 | assets/icons/icon128.png |
| Screenshot 1 | 1280×800 또는 640×400 | 최신 버전·규격으로 다시 캡처 필요 | docs/screenshots/popup.png (기존 자료) |
| Screenshot 2 | 1280×800 또는 640×400 | 최신 버전·규격으로 다시 캡처 필요 | docs/screenshots/settings.png (기존 자료) |
| Small Promo Tile | 440×280 | 제출용 확정 전 | scripts/store-global-tile.html (기존 원본) |
| Marquee Promo Tile | 1400×560 | 미준비 | — |

### Screenshot Notes

잔여량·리셋 소식·리셋권 알림을 보여주되 실제 계정 정보는 노출하지 않습니다. 예시 수치는 예시로 표시합니다. 기존 Edge용 자료를 Chrome 제출 완료 자료로 간주하지 않습니다.

## Permissions Justification

| Permission | Type | Justification |
|---|---|---|
| alarms | permissions | 정기 조회, 시작·절전 복귀 보충 확인, 알림 재시도, 리셋권 만료 확인 및 자체 생성 확인 탭 정리 예약 |
| notifications | permissions | 사용자가 켠 리셋 소식·지급·만료 알림과 수집 중단 안내를 운영체제로 전달 |
| storage | permissions | 설정, 표시용 스냅샷, 계정별 로컬 집계, 알림 중복 방지·대기 기록 및 확인 탭 복구 정보 보관 |
| https://chatgpt.com/* | host_permissions | 사용자가 연결한 계정의 사용량·리셋권 조회 및 별도로 동의한 Chat 집계·기록 동기화 |
| https://api.dayclaw.com/* | host_permissions | 고정된 Tibo 공개 게시글 피드 조회 |
| https://status.openai.com/* | host_permissions | 공개 장애·복구 상태 조회 |
| https://codex-resets.com/* | host_permissions | 공개 리셋 기록·커뮤니티 참고 자료 조회 |
| https://api.github.com/* | host_permissions | openai/codex 공개 rate-limits 이슈 참고 자료 조회 |
| scripting | optional_permissions | 동의한 X 공개 글·답글, Chat 관측 및 요금제 표시를 격리된 스크립트로 읽기 |
| https://x.com/* | optional_host_permissions | 동의 후 OpenAI·Tibo·VB의 공개 글·답글과 한정된 문맥 확인; 직접 생성한 확인 탭의 소유권 복구 |

선택 권한은 사용자 동작으로만 요청합니다. tabs, cookies, history, debugger 권한은 요청하지 않습니다. 새 버전에서 권한을 추가하지 않습니다. 계정 토큰을 공개 피드로 보내지 않습니다.

## Privacy & Data Use

**Does the extension collect user data?** Yes — 동의한 조회와 로컬 기능 처리에 필요한 데이터를 수신·처리합니다. 개발자 운영 서버로 수집하거나 광고·분석에 이용하지 않습니다.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|---|---|---|---|---|
| Personally identifiable info | 계정 범위 식별값을 메모리에서 읽고 로컬 비교용 해시만 보관 | 필요한 계정 범위는 연결한 ChatGPT 조회에만 사용 | 다른 계정 기록 혼합 방지 | 개발자·광고업체에 공유 안 함 |
| Health info | 의도적 수집 안 함; 선택적 기록 동기화 응답에 포함될 가능성 있음 | 추가 전송 안 함 | 본문 분석·보관 안 함 | 안 함 |
| Financial info | 요금제 종류만 확인; 결제수단·청구 내역 수집 안 함 | 추가 전송 안 함 | 해당 계정의 잔여량 추정 기준 | 안 함 |
| Authentication info | 기존 세션 응답의 토큰을 메모리에서만 처리 | 지정한 ChatGPT 조회 요청에만 사용 | 동의한 계정 조회 인증 | 다른 제공처로 전달 안 함 |
| Personal communications | 별도 동기화 동의 시 대화 본문이 포함된 응답을 수신할 수 있음; 본문·제목 저장 안 함 | 본문 추가 전송 안 함 | 응답 해시·모델·시각으로 사용 횟수 계산 | 안 함 |
| Location | 위치 API 사용 안 함; 국가 선택은 기기에 저장 | 요청 제공처가 일반 접속 IP를 볼 수 있음 | 언어·표시 시간대 | 위치 데이터를 따로 공유 안 함 |
| Web history | 전체 방문 기록 수집 안 함; 허용된 X 공개 URL과 확인 탭 상태만 한정 조회 | 통상적인 페이지 탐색 | 공개 글 수집 및 자체 확인 탭 정리 | 방문 기록 업로드 안 함 |
| User activity | 동의한 Chat 응답 해시·모델·시각, 사용량 요약, 알림·읽음·복구 상태 로컬 저장 | 분석 서버 전송 안 함 | 카운터·알림·오작동 복구 | 안 함 |
| Website content | 공개 게시글·출처·시각·제한된 설문 문구, 계정 표시용 요약 | 별도 분석 전송 안 함 | 리셋 탐지·표시 | 안 함 |

공개 피드에는 인증 정보·쿠키를 보내지 않습니다. X 일반 탭 탐색은 기존 브라우저 X 로그인 상태를 사용할 수 있습니다. 공개 작성자 이미지는 pbs.twimg.com/profile_images/에서 표시할 수 있습니다. 접속 대상은 일반 HTTP 접속 정보를 확인할 수 있습니다. 개발자 분석 서버·AI API·원격 실행 코드는 없습니다.

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**: https://github.com/Eon12536/codex-reset-radar-ko/blob/main/PRIVACY.md

보관 기한, 기능 OFF·로컬 데이터 삭제 동작, 계정 기록 동기화의 수신 범위는 위 정책에 따릅니다.

0.2.82부터 방해 금지는 기본 꺼짐, 후보 알림과 Codex 기준 로컬 집계는 기본 켜짐입니다. 기존 설치의 세 설정도 한 번 전환하며 적용 여부를 로컬에 보관합니다. 이후 사용자 선택은 재시작·데이터 지우기에도 유지합니다. 계정 조회·Chat 연결·기록 동기화 동의를 자동으로 켜지 않습니다.

0.2.87은 Chrome의 이전 문서 완료 상태를 새 주소의 완료로 오판하지 않도록 페이지 이동 확인을 보완하고, 기존 실패 진단을 팝업에 상세 표시합니다. 추가 권한·보관 항목·호스트·전송 대상·AI 호출은 없습니다.

0.2.91은 5시간·주간 회복 알림 제목을 구분하고, 기존 공개 글로 완료 표현과 선행 예고를 연결합니다. 직접 연결이 없는 경우 추정임을 표시하며, 공개 예고와 그 확인된 선행 문맥을 최대 두 단계로 기존 로컬 보고 기록에 보관합니다. 각 글의 게시 시각을 선택 국가 기준으로 표시합니다. 0.2.92는 별도 일정 답글 없이 제목형 리셋 예고와 Done을 연결하며, 기존에 보관된 공개 암시 목록도 문맥으로 참조합니다. 유효했던 공개 관측 기록이 있는 글을 처음 완료 공지로 늦게 판정하면 게시 후 7일 안에서 알림 기회를 한 번 갱신하고, 첫 판정 시각을 기존 관측 기록에 저장합니다. 새 권한·개인정보·호스트·외부 전송·AI 호출은 없습니다.

0.2.90은 최근 7일의 허용된 공개 글을 작성자별 최대 160개, 글 목록·대화 캐시 각각 JSON 1,000,000바이트 이하로 로컬 보관해 대기 문맥과 업데이트 후 판정을 재처리합니다. 초기화·조회 시 만료를 정리하고 감시 끄기·로컬 데이터 지우기로 제거합니다. 단계별 판정 개수와 저장 실패를 표시하며, 실제 글 고정 검증이 실패하면 새 배포 ZIP을 만들지 않습니다. DM·쿠키·새 권한·호스트·전송 대상·AI 호출은 추가하지 않습니다.

0.2.89는 짧은 리셋 제목과 같은 작성자의 확인된 대화 일정 답글을 기존 로컬 규칙으로 연결합니다. 확인된 자기 답글의 알림 감점을 보완합니다. 추가 권한·수집 항목·보관 기간·호스트·전송 대상·AI 호출은 없습니다.

0.2.88은 공개 예고에 있는 EOD의 달력일 종료 기한을 게시일·원문 시간대 기준으로 해석하고 선택한 국가에 맞춰 표시합니다. 기한은 정확한 실행 시각으로 취급하지 않으며, 추가 권한·보관 항목·호스트·전송 대상·AI 호출은 없습니다.

0.2.86은 빈 본문이 완전한 공개 글을 덮지 않게 하고, 기존 로컬 수집 진단에 본문 미로딩 개수와 공개 ID·작성자·게시 시각(최대 20개)을 추가합니다. 다음 수집으로 교체되며 로컬 데이터 지우기로 제거됩니다. 명시적으로 연결된 리셋 완료 인용을 로컬 규칙으로 분류합니다. 추가 권한·호스트·전송 대상·AI 호출은 없습니다.

0.2.85는 기존 수집 시각·오류를 팝업 상단에 표시하고 짧은 리셋 제목·EOD 마감 예고 분류와 같은 X 경로의 표기 차이를 보완합니다. 추가 권한·수집 데이터·전송 대상은 없습니다.

0.2.84는 탐지 후 확장이 만든 X 확인 탭을 닫고 기존 소유권 기록에 탭 변경 보호 여부를 저장합니다. 단순 선택만으로 확인 탭을 영구 보존하지 않습니다. 고정·이동·사용자 페이지 이동·불명확한 소유권의 보호는 유지합니다. 권한·호스트·외부 전송 대상은 추가하지 않습니다.

0.2.83은 기존 로컬 수집 진단의 일부 목록 실패 분류와 경고 교체를 보완합니다. 새로운 데이터 수집 범위·권한·전송 대상을 추가하지 않습니다. 읽은 공개 소식과 알림은 유지합니다.

## Distribution

**Visibility**: 공개 GitHub ZIP 배포. Chrome Web Store는 미제출.

**Regions**: Chrome Web Store 제출 시 확정 필요.

## Developer Info

**Publisher Name**: GitHub 저장소 소유자 Eon12536; Chrome 게시자 계정·표시명은 제출 시 확인 필요.

**Contact Email**: 미등록. 스토어 제출 전에 사용자가 공개할 주소를 지정해야 합니다.

**Support URL**: https://github.com/Eon12536/codex-reset-radar-ko/issues

**Homepage URL**: https://github.com/Eon12536/codex-reset-radar-ko

## Version History

| Version | Date | Changes | Status |
|---|---|---|---|
| 0.2.92 | 2026-10-20 | 제목형 리셋 예고 뒤 Done 연결, 이전 수집 문맥 참조, 회귀 사례 보완 | Draft (Chrome Web Store 미제출) |
| 0.2.91 | 2026-10-19 | 한도별 회복 알림 제목, 짧은 완료 표현과 예고 연결, 게시 시각 표시 | Draft (Chrome Web Store 미제출) |
| 0.2.90 | 2026-10-18 | 공개 글·대화 진행 보관, 우선순위·공정 처리, 업데이트 재판정, 실제 글 배포 검사 | Draft (Chrome Web Store 미제출) |
| 0.2.89 | 2026-10-18 | 짧은 리셋 제목·확인된 자기 답글 일정 연결, 기본 알림 기준 보완 | Draft (Chrome Web Store 미제출) |
| 0.2.88 | 2026-10-15 | EOD 예고의 게시일·원문 시간대 기준 기한 표시, 선택 국가에 맞춘 환산 | Draft (Chrome Web Store 미제출) |
| 0.2.87 | 2026-10-14 | X 페이지 실제 이동 완료 대기, 작성자·목록·단계별 실패 표시 | Draft (Chrome Web Store 미제출) |
| 0.2.86 | 2026-10-14 | X 본문 미로딩·재렌더링 수집 보존, 진단·재시도, 인용 예고의 완료 탐지 | Draft (Chrome Web Store 미제출) |
| 0.2.85 | 2026-10-13 | 사용량 카드 축소·상단 탐지 버튼, 최신 리셋 표현과 X 주소 표기 차이 보완 | Draft (Chrome Web Store 미제출) |
| 0.2.84 | 2026-10-13 | 탐지 후 선택된 X 확인 탭 종료·재시작 복구, 이동 중 사용자 탭 보호 | Draft (Chrome Web Store 미제출) |
| 0.2.83 | 2026-10-13 | 부분 수집 실패를 정상 복구와 구분, 경고 원인 교체와 탭 차단 복구 안내 | Draft (Chrome Web Store 미제출) |
| 0.2.82 | 2026-10-11 | 요청한 세 기본값과 기존 설치의 일회성 설정 전환 | Draft (Chrome Web Store 미제출) |
| 0.2.81 | 2026-10-11 | 업데이트 후 수집 차단 복구, 복구 후 새 글 확인·알림 재개 | Draft (Chrome Web Store 미제출) |

## Review Notes

### Known Issues / Limitations

GitHub ZIP은 수동 덮어쓰기와 확장 새로고침이 필요합니다. X 접근·로그인·화면 변경이나 외부 피드 지연은 수집에 영향을 줄 수 있습니다. 개인 계정 조회는 비공식 읽기 경로의 변경에 영향을 받을 수 있습니다. Chat 잔여량은 관측·동기화한 기록의 추정입니다. Chrome 알림 API 접수는 실제 Windows 배너·소리를 보장하지 않습니다.

이번 환경에서는 Chrome 내부 확장 화면과 서비스 워커에 접근할 수 없습니다. 자동 테스트는 Chrome API 모의 실행이며 실제 재부팅·절전 복귀·Windows 배너 검증으로 표시하지 않습니다. 원격 디버깅을 임의로 활성화하지 않았습니다. 제출 전에 실제 브라우저 검증, 최신 스크린샷, 자산 권리, 게시자 연락처를 확인해야 합니다.

0.2.83의 팝업·설정 일부 수집 실패 문구와 작성자별 실패 내역은 실제 Chrome의 로컬 미리보기에서 예시 데이터로 확인했습니다. 실행 중인 설치본·서비스 워커·Windows 알림 검증을 대신하지 않습니다.

### Rejection History

Chrome Web Store 제출·심사 이력 없음. 기존 Edge 제출 여부는 이 문서에서 확인한 것으로 표시하지 않습니다.

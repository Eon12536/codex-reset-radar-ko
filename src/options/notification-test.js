// This module intentionally has no dependency on the rest of the settings UI.
(() => {
  const BUILD = "0.2.79";
  const button = document.getElementById("testNotification");
  const status = document.getElementById("notificationTestStatus");
  const worker = document.getElementById("notificationWorkerStatus");
  if (!button || !status || !worker) return;

  async function request(type) {
    let timer;
    try {
      return await Promise.race([
        chrome.runtime.sendMessage({ type }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 10000); })
      ]);
    } finally { clearTimeout(timer); }
  }

  function renderWorker(result) {
    if (!result?.ok || result.version !== BUILD) {
      worker.textContent = `화면 v${BUILD} · 실행 코드 확인 불가${result?.version ? ` (v${result.version})` : ""}. chrome://extensions/에서 확장을 새로고침한 뒤 이 설정 탭도 F5로 갱신해 주세요.`;
      return;
    }
    const previous = result.realDelivery;
    const at = previous?.at ? new Intl.DateTimeFormat(globalThis.RadarI18n?.uiLanguage?.() || 'ko-KR', {
      timeZone: globalThis.RadarTime?.countryZone?.().zone, month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(previous.at)).replace(/(오전|오후)\s*0(\d):/g, '$1 $2:') : '';
    const latest = previous ? ` · 실제 알림: ${at} ${previous.status === "accepted" ? "Chrome 접수" : "전송 실패"}` : " · 실제 알림: 전송 기록 없음";
    worker.textContent = `실행 v${result.version} · Chrome 알림 ${result.permission === "granted" ? "허용" : "차단"} · 후보 알림 ${result.hintAlerts ? "켜짐" : "꺼짐"} · 대기 ${result.pending}개${result.quiet ? " · 확장 방해 금지 중" : ""}${latest}`;
    worker.textContent += result.resetHintAlerts ? ' · 리셋 설문·암시 알림 켜짐' : ' · 리셋 설문·암시 알림 꺼짐';
    if (result.resumeReadyAt > Date.now()) worker.textContent += ' · 시작·절전 복귀 후 알림 준비 중 (1분 대기)';
    if (result.publicAlerts) {
      const alerts = result.publicAlerts;
      worker.textContent += ` · 소식 분류: 대기 ${alerts.pending} / 처리 기록 ${alerts.handled} / 기존·기한 지난 글 ${alerts.expired} / 설정 제외 ${alerts.disabled} / 발송 대상 ${alerts.eligible}`;
    }
  }

  async function refreshWorker() {
    try { renderWorker(await request("NOTIFICATION_STATUS")); }
    catch { worker.textContent = `화면 v${BUILD} · 실행 코드 응답 없음. 확장과 이 설정 탭을 새로고침해 주세요.`; }
  }

  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = "테스트 버튼이 동작했습니다. Chrome 응답을 기다리는 중…";
    try {
      const result = await request("TEST_NOTIFICATION");
      if (result?.version !== BUILD) {
        status.textContent = "실행 코드가 최신 버전과 연결되지 않았어요. 확장을 새로고침한 뒤 이 탭도 F5로 갱신해 주세요.";
      } else if (result.ok) {
        status.textContent = "Chrome이 테스트 알림을 접수했어요. 보이지 않으면 Windows 설정 → 시스템 → 알림에서 Chrome 허용·배너·방해 금지를 확인해 주세요. 소리는 Windows 설정을 따릅니다.";
      } else if (result.reason === "image") {
        status.textContent = "내장 아이콘 처리에 실패했어요. 이 문구와 실행 버전을 알려주세요.";
      } else if (result.reason === "denied") {
        status.textContent = "Chrome에서 이 확장의 알림을 차단하고 있어요. 알림 허용 설정을 확인해 주세요.";
      } else {
        status.textContent = "Chrome이 알림 요청을 처리하지 못했어요. 확장을 새로고침한 뒤 다시 확인해 주세요.";
      }
    } catch (error) {
      status.textContent = error?.message === "timeout"
        ? "10초 동안 실행 코드 응답이 없어요. 확장을 새로고침한 뒤 이 설정 탭도 F5로 갱신해 주세요."
        : "확장 연결이 끊겼어요. 이 설정 탭을 닫고 확장 팝업에서 설정을 다시 열어 주세요.";
    } finally {
      button.disabled = false;
      refreshWorker();
    }
  });

  status.textContent = `v${BUILD} 테스트 버튼 준비 완료. 테스트 버튼으로 Windows 알림을 확인하세요.`;
  // The test controls still work when localization is unavailable. On normal
  // pages, wait for saved preferences and refresh dates after country changes.
  Promise.resolve(globalThis.RadarI18n?.ready).then(refreshWorker, refreshWorker);
  globalThis.RadarI18n?.subscribe?.(refreshWorker);
})();

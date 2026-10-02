(() => {
  const checkbox = document.getElementById('syncChatHistory');
  const button = document.getElementById('syncChatHistoryButton');
  const status = document.getElementById('chatHistoryStatus');
  let busy = false, enabled = false;
  async function render() {
    const data = await chrome.storage.local.get(['settings', 'chatAccount', 'chatCounters']);
    const settings = RadarSettings.sanitize(data.settings), view = RadarChatCounter.view(data);
    enabled = settings.syncChatHistory;
    if (checkbox && !busy) { checkbox.checked = enabled; checkbox.disabled = !settings.monitorChat; }
    button.textContent = enabled || checkbox ? '지금 동기화' : '계정 기록 연결';
    button.disabled = busy || Boolean(checkbox && !enabled);
    status.textContent = enabled ? RadarChatHistory.statusText(view.history) +
      (view.history?.checkedAt && view.history.status !== 'running' ? ' · ' + RadarTime.formatTime(view.history.checkedAt, RadarTime.resolveTimeZone(settings)) : '') :
      '다른 기기 사용분은 계정 기록 연결 후 확인';
    if (enabled && !view.connected) status.textContent = 'ChatGPT 로그인·계정 연결 확인 필요';
    status.title = status.textContent;
    if (!checkbox) status.textContent = enabled ? status.textContent.split(' · ')[0] : '다른 기기 기록 미연결';
  }
  async function sync() {
    busy = true; button.disabled = true; status.textContent = '계정 기록 확인 중…';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'SYNC_CHAT_HISTORY' });
      await render();
      if (result?.skipped) status.textContent = '방금 확인했어요. 30초 후 다시 동기화할 수 있습니다.';
      else if (!result?.ok && !enabled) status.textContent = '설정에서 계정 기록 동기화를 켜 주세요.';
    } catch { status.textContent = '동기화를 마치지 못했어요. 확장 새로고침 후 다시 확인해 주세요.'; }
    finally { busy = false; button.disabled = Boolean(checkbox && !enabled); }
  }
  button.addEventListener('click', () => enabled ? sync() : chrome.runtime.openOptionsPage());
  checkbox?.addEventListener('change', async () => {
    const desired = checkbox.checked;
    checkbox.disabled = true; busy = true;
    try {
      const stored = await chrome.storage.local.get('settings');
      const result = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS',
        settings: RadarSettings.sanitize({ ...stored.settings, syncChatHistory: desired }) });
      if (!result?.ok) throw new Error('save');
      enabled = Boolean(result.settings.syncChatHistory);
      busy = false;
      if (enabled) await sync();
      else { await render(); status.textContent = '동기화 꺼짐 · 가져온 기록 삭제됨'; }
    } catch { checkbox.checked = !desired; status.textContent = '설정을 저장하지 못했어요. 다시 시도해 주세요.'; }
    finally { busy = false; checkbox.disabled = false; }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ['settings', 'chatAccount', 'chatCounters'].some(key => key in changes)) render().catch(() => {});
  });
  render().catch(() => { status.textContent = '동기화 상태를 읽지 못했어요.'; });
})();

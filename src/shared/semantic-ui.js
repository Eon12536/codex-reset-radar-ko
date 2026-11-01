(function () {
  const output = document.getElementById('semanticStatus');
  if (!output) return;
  const prepare = document.getElementById('prepareSemanticModel');
  let preparing = false;
  async function render() {
    if (preparing) return;
    const { semanticStatus: status, settings } = await chrome.storage.local.get(['semanticStatus', 'settings']);
    const shortcut = document.getElementById('openSemanticSettings');
    if (shortcut) {
      shortcut.hidden = settings?.semanticEnabled === false || ['unsupported', 'unavailable'].includes(status?.state) ||
        status?.state === 'available' && !status.lastError;
      shortcut.textContent = status?.state === 'downloadable' ? 'AI 모델 준비' : status?.lastError ? 'AI 상태 확인' : 'AI 설정';
    }
    if (settings?.semanticEnabled === false) { output.textContent = '기기 AI: 꺼짐'; return; }
    const labels = { available: '준비됨', downloadable: '모델 준비 필요', downloading: '모델 준비 중',
      unavailable: '이 기기에서 사용 불가', unsupported: '이 실행 환경에서 지원하지 않음', error: '판정 오류 · 재확인 필요' };
    output.textContent = status ? `기기 AI: ${labels[status.state] || '확인 필요'} · 판정 ${status.classified || 0}개 · 대기 ${status.pending ?? '미확인'}개` +
      (status.running ? ' · 판정 중' : '') +
      (status.lastError ? ` · ${status.errorPhase || '판정'}: ${status.lastError}${status.errorDetail && status.errorDetail !== status.lastError ? ' (' + status.errorDetail + ')' : ''} · 자동 재시도 대기` : '') +
      (status.overflow ? ' · 보관 상한 초과' : '') : '기기 AI: 지원 상태 확인 전';
    output.title = '유료 API를 사용하지 않습니다. 지원·준비 실패 시 기존 규칙 탐지는 계속되며, 의미 판정이 완료된 것으로 표시하지 않습니다.';
  }
  document.getElementById('openSemanticSettings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
  prepare?.addEventListener('click', async () => {
    if (preparing) return;
    preparing = true; prepare.disabled = true;
    let session;
    try {
      if (!globalThis.LanguageModel?.create) throw new Error('이 Chrome 실행 환경은 내장 AI를 지원하지 않습니다.');
      output.textContent = 'Chrome 모델 준비 중 · 완료될 때까지 이 설정 화면을 열어 두세요.';
      // User activation is required for the first model download. Never initiate it in the worker.
      session = await LanguageModel.create({ expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }], monitor(monitor) {
          monitor.addEventListener('downloadprogress', event => {
            output.textContent = `Chrome 모델 준비 중 · ${Math.min(100, Math.round(event.loaded * 100))}%`;
          });
        } });
      session.destroy(); session = null;
      output.textContent = '모델 준비 완료 · 공개 글을 수집해 백그라운드 판정 가능 여부를 확인합니다.';
      await chrome.runtime.sendMessage({ type: 'REFRESH_SIGNALS' });
    } catch (error) {
      output.textContent = `모델 준비 실패: ${String(error?.message || error).slice(0, 180)}`;
      return;
    } finally {
      session?.destroy(); preparing = false; prepare.disabled = false;
    }
    await render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.semanticStatus || changes.settings)) render().catch(() => {});
  });
  render().catch(() => { output.textContent = '기기 AI: 상태 확인 실패'; });
})();

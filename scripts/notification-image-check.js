document.getElementById('check').addEventListener('click', () => {
  const result = document.getElementById('result');
  result.textContent = '검사 중…';
  const worker = new Worker('notification-image-worker.js');
  worker.onmessage = event => { result.textContent = event.data; worker.terminate(); };
  worker.onerror = () => { result.textContent = '검사 실패: Worker 실행 오류'; worker.terminate(); };
  worker.postMessage('check');
});

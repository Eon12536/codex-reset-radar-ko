importScripts('/src/core/notification-icon.js');
self.onmessage = async () => {
  try {
    // Mirrors Chromium image_util's worker pipeline, with the release CSP.
    const response = await fetch(RadarNotificationIcon);
    if (!response.ok) throw new Error('image fetch');
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    postMessage(`통과: 실제 Chrome Worker에서 내장 PNG fetch → 디코딩 → 캔버스 읽기 완료 (${bitmap.width}×${bitmap.height}, ${pixels.data.byteLength} bytes). Windows 알림 표시는 별도 확인이 필요합니다.`);
    bitmap.close();
  } catch (error) { postMessage('실패: ' + error.message); }
};

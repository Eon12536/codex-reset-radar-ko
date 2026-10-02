RadarI18n.apply();

document.getElementById("openUsage").addEventListener("click", async () => {
  const button = document.getElementById("openUsage");
  button.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "ENABLE_ACCOUNT" });
    if (!result?.ok) throw new Error("Account connection was not enabled");
    const opened = await chrome.runtime.sendMessage({ type: "OPEN_ACCOUNT_LOGIN" });
    if (!opened?.ok) throw new Error("Could not open login");
    document.getElementById("connectionHelp").textContent = "ChatGPT에서 로그인한 뒤 확장을 다시 열어 주세요. 잔여량 연결을 다시 확인합니다.";
  } catch {
    button.textContent = RadarI18n.t("retryAfterRefresh");
  } finally { button.disabled = false; }
});

document.getElementById("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

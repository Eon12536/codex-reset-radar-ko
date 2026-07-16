document.getElementById("openUsage").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://chatgpt.com/codex/settings/usage" });
});

document.getElementById("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

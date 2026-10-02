(function initAccount(root) {
  function view(data) {
    const enabled = Boolean(data.settings?.monitorAccount);
    const hasUsage = enabled && Boolean(data.accountSnapshot?.usage);
    const status = data.accountState?.status;
    const needsCheck = enabled && (!hasUsage || status === "signedOut" || status === "error" || Boolean(data.accountError));
    let message = "잔여량이 연결되어 있습니다.";
    let action = "ChatGPT 열기";
    if (!enabled) {
      message = "내 잔여량 조회가 꺼져 있어요. 계정 연결에서 켤 수 있습니다.";
      action = "계정 연결";
    } else if (status === "signedOut") {
      message = "같은 Chrome 프로필에서 ChatGPT에 로그인한 뒤 확장을 다시 열어 주세요.";
      action = "ChatGPT 로그인";
    } else if (data.accountState?.reason === "accessDenied" || data.accountError?.reason === "accessDenied") {
      message = "ChatGPT 접근 확인이 필요해요. ChatGPT를 연 뒤 연결을 다시 확인해 주세요.";
    } else if (status === "error" || data.accountError) {
      message = "잔여량 조회에 실패했어요. ChatGPT 로그인 상태와 인터넷 연결을 확인해 주세요.";
    } else if (!hasUsage) {
      message = "같은 Chrome 프로필에서 ChatGPT에 로그인한 뒤 연결을 확인해 주세요.";
      action = "ChatGPT 로그인";
    }
    if (hasUsage && needsCheck) message = "마지막 조회값입니다. " + message;
    return { enabled, hasUsage, needsCheck, message, action };
  }

  function refreshMessage(result) {
    const account = result?.account || result;
    if (account?.reason === "signedOut") return "ChatGPT 로그인이 필요해요. 위 로그인 버튼을 눌러 주세요.";
    if (account?.reason === "accessDenied") return "ChatGPT 접근을 확인하지 못했어요. ChatGPT를 연 뒤 다시 확인해 주세요.";
    if (account?.skipped) return result?.signals?.ok ? "공개 소식을 확인했습니다. 내 잔여량 조회는 꺼져 있어요." : "내 잔여량 조회를 먼저 켜 주세요.";
    if (!account?.ok) return "잔여량을 조회하지 못했어요. 로그인 상태와 인터넷 연결을 확인해 주세요.";
    return result?.signals?.ok === false ? "잔여량을 확인했습니다. 공개 소식은 조회하지 못했어요." : "잔여량을 확인했습니다.";
  }

  root.RadarAccount = Object.freeze({ view, refreshMessage });
  if (typeof module !== "undefined") module.exports = root.RadarAccount;
})(globalThis);

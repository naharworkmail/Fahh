const statusCard = document.getElementById("statusCard");
const statusBadge = document.getElementById("statusBadge");
const statusLabel = document.getElementById("statusLabel");
const statusText = document.getElementById("statusText");
const uptime = document.getElementById("uptime");
const coords = document.getElementById("coords");
const reconnects = document.getElementById("reconnects");
const reconnectState = document.getElementById("reconnectState");
const reconnectTimer = document.getElementById("reconnectTimer");
const serverAddress = document.getElementById("serverAddress");
const serverVersion = document.getElementById("serverVersion");
const botName = document.getElementById("botName");
const botAuth = document.getElementById("botAuth");
const lastError = document.getElementById("lastError");
const lastDisconnect = document.getElementById("lastDisconnect");
const toggleReconnectButton = document.getElementById("toggleReconnectButton");
const commandForm = document.getElementById("commandForm");
const commandInput = document.getElementById("commandInput");
const commandMessage = document.getElementById("commandMessage");
const settingsForm = document.getElementById("settingsForm");
const appNameInput = document.getElementById("appNameInput");
const hostInput = document.getElementById("hostInput");
const portInput = document.getElementById("portInput");
const usernameInput = document.getElementById("usernameInput");
const passwordInput = document.getElementById("passwordInput");
const versionInput = document.getElementById("versionInput");
const authInput = document.getElementById("authInput");
const autoAuthPasswordInput = document.getElementById("autoAuthPasswordInput");
const autoAuthEnabledInput = document.getElementById("autoAuthEnabledInput");
const antiAfkEnabledInput = document.getElementById("antiAfkEnabledInput");
const settingsMessage = document.getElementById("settingsMessage");

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatReconnectTime(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined) {
    return "Retry delay: 5 minutes";
  }

  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (seconds === 0) {
      return `Next retry in ${minutes} min`;
    }
    return `Next retry in ${minutes} min ${seconds}s`;
  }

  return `Next retry in ${totalSeconds}s`;
}

function applyStatus(status) {
  statusCard.className = `status-card status-${status.status}`;
  statusBadge.textContent =
    status.status === "connected"
      ? "ON"
      : status.status === "connecting"
        ? "..."
        : status.status === "stopped"
          ? "OFF"
          : "ERR";

  statusLabel.textContent = status.status[0].toUpperCase() + status.status.slice(1);

  const descriptions = {
    connected: "Bot is active on the server.",
    connecting: "Bot is trying to join the server.",
    disconnected: "Bot is offline and waiting to retry.",
    stopped: "Bot is stopped from the dashboard.",
  };

  statusText.textContent = descriptions[status.status] || "Unknown bot state.";
  uptime.textContent = formatDuration(status.uptimeSeconds);
  reconnects.textContent = String(status.reconnectAttempts);
  reconnectState.textContent = status.autoReconnectEnabled ? "Enabled" : "Disabled";
  reconnectTimer.textContent = status.autoReconnectEnabled
    ? formatReconnectTime(status.nextReconnectInSeconds)
    : "Reconnect will stay off until you turn it back on.";
  serverAddress.textContent = `${status.server.host}:${status.server.port}`;
  serverVersion.textContent = `Version: ${status.server.version}`;
  botName.textContent = status.bot.username || "Not configured";
  botAuth.textContent = `Auth: ${status.bot.auth}`;
  lastError.textContent = status.lastError || "None";
  lastDisconnect.textContent = status.lastDisconnectReason || "No disconnect reason";
  toggleReconnectButton.textContent = status.autoReconnectEnabled
    ? "Disable auto reconnect"
    : "Enable auto reconnect";

  if (status.coords) {
    coords.textContent = `X ${Math.floor(status.coords.x)}, Y ${Math.floor(status.coords.y)}, Z ${Math.floor(status.coords.z)}`;
  } else {
    coords.textContent = "Waiting for spawn...";
  }
}

async function refreshStatus() {
  const response = await fetch("/api/status");
  const status = await response.json();
  applyStatus(status);
}

async function loadSettings() {
  const response = await fetch("/api/settings");
  const settings = await response.json();
  appNameInput.value = settings.appName || "";
  hostInput.value = settings.host || "";
  portInput.value = settings.port || "";
  usernameInput.value = settings.username || "";
  passwordInput.value = settings.password || "";
  versionInput.value = settings.version || "";
  authInput.value = settings.auth || "offline";
  autoAuthPasswordInput.value = settings.autoAuthPassword || "";
  autoAuthEnabledInput.checked = Boolean(settings.autoAuthEnabled);
  antiAfkEnabledInput.checked = Boolean(settings.antiAfkEnabled);
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return response.json();
}

document.getElementById("startButton").addEventListener("click", async () => {
  const result = await postJson("/api/start");
  commandMessage.textContent = result.message;
  refreshStatus();
});

document.getElementById("stopButton").addEventListener("click", async () => {
  const result = await postJson("/api/stop");
  commandMessage.textContent = result.message;
  refreshStatus();
});

toggleReconnectButton.addEventListener("click", async () => {
  const enable = toggleReconnectButton.textContent.toLowerCase().includes("enable");
  const result = await postJson("/api/auto-reconnect", { enabled: enable });
  commandMessage.textContent = result.message;
  refreshStatus();
});

commandForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const command = commandInput.value.trim();

  if (!command) {
    commandMessage.textContent = "Type a command first.";
    return;
  }

  const result = await postJson("/api/command", { command });
  commandMessage.textContent = result.message;
  if (result.success) {
    commandInput.value = "";
  }
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = await postJson("/api/settings", {
    appName: appNameInput.value.trim(),
    host: hostInput.value.trim(),
    port: Number(portInput.value),
    username: usernameInput.value.trim(),
    password: passwordInput.value,
    version: versionInput.value.trim(),
    auth: authInput.value,
    autoAuthPassword: autoAuthPasswordInput.value,
    autoAuthEnabled: autoAuthEnabledInput.checked,
    antiAfkEnabled: antiAfkEnabledInput.checked,
  });

  settingsMessage.textContent = result.message;
  if (result.success) {
    await loadSettings();
    await refreshStatus();
  }
});

loadSettings();
refreshStatus();
setInterval(refreshStatus, 5000);

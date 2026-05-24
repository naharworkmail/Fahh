"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const express = require("express");
const mineflayer = require("mineflayer");
const { pathfinder } = require("mineflayer-pathfinder");
const { addLog, getLogs } = require("./logger");
const config = require("./config");

const app = express();
const port = Number(process.env.PORT || 5000);
const settingsPath = path.join(__dirname, "settings.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const state = {
  desiredRunning: true,
  connected: false,
  connecting: false,
  autoReconnectEnabled: config.reconnect.enabled,
  startTime: null,
  lastActivity: null,
  reconnectAttempts: 0,
  lastDisconnectReason: "Not started yet",
  lastError: null,
  nextReconnectAt: null,
};

let bot = null;
let reconnectTimer = null;
let antiAfkTimer = null;
let keepAliveTimer = null;

function readSettingsFile() {
  return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
}

function writeSettingsFile(settings) {
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function now() {
  return Date.now();
}

function getEditableSettings() {
  return {
    appName: config.name,
    host: config.server.host,
    port: config.server.port,
    version: config.server.version || "",
    username: config.bot.username,
    password: config.bot.password || "",
    auth: config.bot.auth,
    autoAuthEnabled: config.autoAuth.enabled,
    autoAuthPassword: config.autoAuth.password || "",
    antiAfkEnabled: config.antiAfk.enabled,
    reconnectDelayMs: config.reconnect.delayMs,
  };
}

function getBotCoords() {
  if (!bot || !bot.entity || !bot.entity.position) {
    return null;
  }

  const { x, y, z } = bot.entity.position;
  return { x, y, z };
}

function getStatus() {
  return {
    name: config.name,
    status: state.connected
      ? "connected"
      : state.connecting
        ? "connecting"
        : state.desiredRunning
          ? "disconnected"
          : "stopped",
    desiredRunning: state.desiredRunning,
    autoReconnectEnabled: state.autoReconnectEnabled,
    uptimeSeconds: state.startTime ? Math.floor((now() - state.startTime) / 1000) : 0,
    reconnectAttempts: state.reconnectAttempts,
    lastActivity: state.lastActivity,
    lastDisconnectReason: state.lastDisconnectReason,
    lastError: state.lastError,
    nextReconnectInSeconds: state.nextReconnectAt
      ? Math.max(0, Math.ceil((state.nextReconnectAt - now()) / 1000))
      : null,
    coords: getBotCoords(),
    server: {
      host: config.server.host,
      port: config.server.port,
      version: config.server.version || "auto",
    },
    bot: {
      username: config.bot.username,
      auth: config.bot.auth,
    },
  };
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  state.nextReconnectAt = null;
}

function clearAntiAfkTimer() {
  if (antiAfkTimer) {
    clearInterval(antiAfkTimer);
    antiAfkTimer = null;
  }
}

function cleanupBot() {
  clearAntiAfkTimer();

  if (!bot) {
    return;
  }

  try {
    bot.removeAllListeners();
    if (typeof bot.end === "function") {
      bot.end("Dashboard stop");
    }
  } catch (error) {
    addLog(`[Cleanup] ${error.message}`);
  }

  bot = null;
}

function scheduleReconnect(reason) {
  clearReconnectTimer();

  if (!state.desiredRunning || !state.autoReconnectEnabled) {
    addLog(`[Reconnect] Skipped (${reason})`);
    return;
  }

  state.connecting = false;
  state.connected = false;
  state.reconnectAttempts += 1;

  const baseDelay = Math.max(config.reconnect.delayMs, 1000);
  const maxDelay = Math.max(config.reconnect.maxDelayMs, baseDelay);
  const delay = Math.min(baseDelay, maxDelay);
  state.nextReconnectAt = now() + delay;

  addLog(`[Reconnect] ${reason}. Retrying in ${Math.round(delay / 1000)}s`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    state.nextReconnectAt = null;
    startBot();
  }, delay);
}

function startAntiAfk() {
  clearAntiAfkTimer();

  if (!config.antiAfk.enabled) {
    return;
  }

  antiAfkTimer = setInterval(() => {
    if (!bot || !state.connected) {
      return;
    }

    try {
      bot.swingArm("right", true);
    } catch (_) {}

    try {
      if (config.antiAfk.jump) {
        bot.setControlState("jump", true);
        setTimeout(() => {
          if (bot) {
            try {
              bot.setControlState("jump", false);
            } catch (_) {}
          }
        }, 300);
      }
    } catch (_) {}

    try {
      if (config.antiAfk.rotate) {
        const yaw = Math.random() * Math.PI * 2 - Math.PI;
        bot.look(yaw, 0, true);
      }
    } catch (_) {}

    state.lastActivity = now();
  }, config.antiAfk.intervalMs);
}

function wireAutoAuth(currentBot) {
  if (!config.autoAuth.enabled || !config.autoAuth.password) {
    return;
  }

  let handled = false;

  currentBot.on("messagestr", (message) => {
    if (handled) {
      return;
    }

    const text = String(message).toLowerCase();
    if (text.includes("/register") || text.includes("register")) {
      handled = true;
      currentBot.chat(`/register ${config.autoAuth.password} ${config.autoAuth.password}`);
      addLog("[Auth] Sent /register");
      return;
    }

    if (text.includes("/login") || text.includes("login")) {
      handled = true;
      currentBot.chat(`/login ${config.autoAuth.password}`);
      addLog("[Auth] Sent /login");
    }
  });
}

function startBot() {
  clearReconnectTimer();

  if (!state.desiredRunning) {
    addLog("[Bot] Start skipped because dashboard marked it stopped");
    return;
  }

  if (bot || state.connecting || state.connected) {
    addLog("[Bot] Already running or connecting");
    return;
  }

  state.connecting = true;
  state.lastError = null;
  state.lastDisconnectReason = null;

  addLog(`[Bot] Connecting to ${config.server.host}:${config.server.port}`);

  try {
    bot = mineflayer.createBot({
      host: config.server.host,
      port: config.server.port,
      username: config.bot.username,
      password: config.bot.password || undefined,
      auth: config.bot.auth,
      version: config.server.version || false,
      hideErrors: false,
      checkTimeoutInterval: 60_000,
    });

    bot.loadPlugin(pathfinder);
    wireAutoAuth(bot);

    bot.once("spawn", () => {
      state.connected = true;
      state.connecting = false;
      state.reconnectAttempts = 0;
      state.startTime = now();
      state.lastActivity = now();
      state.nextReconnectAt = null;
      addLog("[Bot] Connected and spawned");
      startAntiAfk();
    });

    bot.on("chat", (username, message) => {
      if (username !== bot.username) {
        addLog(`[Chat] ${username}: ${message}`);
      }
    });

    bot.on("messagestr", (message) => {
      addLog(`[Game] ${String(message)}`);
    });

    bot.on("end", (reason) => {
      state.connected = false;
      state.connecting = false;
      state.lastDisconnectReason = reason || "Connection ended";
      addLog(`[Bot] Disconnected: ${state.lastDisconnectReason}`);
      cleanupBot();
      scheduleReconnect("Connection ended");
    });

    bot.on("kicked", (reason) => {
      const kickReason = typeof reason === "object" ? JSON.stringify(reason) : String(reason);
      state.lastDisconnectReason = kickReason;
      addLog(`[Bot] Kicked: ${kickReason}`);
    });

    bot.on("error", (error) => {
      state.lastError = error.message;
      addLog(`[Bot] Error: ${error.message}`);
    });
  } catch (error) {
    state.connecting = false;
    state.lastError = error.message;
    addLog(`[Bot] Failed to start: ${error.message}`);
    cleanupBot();
    scheduleReconnect("Startup failed");
  }
}

function stopBot() {
  state.desiredRunning = false;
  state.connected = false;
  state.connecting = false;
  state.lastDisconnectReason = "Stopped from dashboard";
  clearReconnectTimer();
  cleanupBot();
  addLog("[Control] Bot stopped from dashboard");
}

function updateRuntimeConfig(nextSettings) {
  config.name = nextSettings.appName;
  config.server.host = nextSettings.host;
  config.server.port = nextSettings.port;
  config.server.version = nextSettings.version;
  config.bot.username = nextSettings.username;
  config.bot.password = nextSettings.password;
  config.bot.auth = nextSettings.auth;
  config.autoAuth.enabled = nextSettings.autoAuthEnabled;
  config.autoAuth.password = nextSettings.autoAuthPassword;
  config.antiAfk.enabled = nextSettings.antiAfkEnabled;
  config.reconnect.delayMs = nextSettings.reconnectDelayMs;
  config.reconnect.maxDelayMs = nextSettings.reconnectDelayMs;
}

function saveEditableSettings(nextSettings) {
  const settings = readSettingsFile();
  settings.name = nextSettings.appName;
  settings["bot-account"] = {
    ...(settings["bot-account"] || {}),
    username: nextSettings.username,
    password: nextSettings.password,
    type: nextSettings.auth,
  };
  settings.server = {
    ...(settings.server || {}),
    ip: nextSettings.host,
    port: nextSettings.port,
    version: nextSettings.version,
  };
  settings.utils = settings.utils || {};
  settings.utils["auto-auth"] = {
    ...(settings.utils["auto-auth"] || {}),
    enabled: nextSettings.autoAuthEnabled,
    password: nextSettings.autoAuthPassword,
  };
  settings.utils["anti-afk"] = {
    ...(settings.utils["anti-afk"] || {}),
    enabled: nextSettings.antiAfkEnabled,
  };
  settings.utils["auto-reconnect"] = true;
  settings.utils["auto-reconnect-delay"] = nextSettings.reconnectDelayMs;
  settings.utils["max-reconnect-delay"] = nextSettings.reconnectDelayMs;
  writeSettingsFile(settings);
  updateRuntimeConfig(nextSettings);
}

function pingSelf(url) {
  if (!url) return;

  try {
    https
      .get(`${url.replace(/\/$/, "")}/health`, (res) => {
        addLog(`[KeepAlive] Self-ping: ${res.statusCode}`);
        res.resume();
      })
      .on("error", (error) => {
        addLog(`[KeepAlive] Ping failed: ${error.message}`);
      });
  } catch (error) {
    addLog(`[KeepAlive] Ping error: ${error.message}`);
  }
}

function startKeepAlive() {
  const selfUrl = process.env.RENDER_EXTERNAL_URL;

  if (!selfUrl) {
    addLog("[KeepAlive] RENDER_EXTERNAL_URL not found, skipping self-ping");
    return;
  }

  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
  }

  addLog(`[KeepAlive] Enabled for ${selfUrl}`);
  pingSelf(selfUrl);

  keepAliveTimer = setInterval(() => {
    pingSelf(selfUrl);
  }, 5 * 60 * 1000);
}

app.get("/api/status", (_req, res) => {
  res.json(getStatus());
});

app.get("/api/settings", (_req, res) => {
  res.json(getEditableSettings());
});

app.get("/api/logs", (_req, res) => {
  res.json({ logs: getLogs() });
});

app.post("/api/start", (_req, res) => {
  if (state.desiredRunning && (state.connected || state.connecting || bot)) {
    return res.json({ success: false, message: "Bot is already running." });
  }

  state.desiredRunning = true;
  startBot();
  return res.json({ success: true, message: "Bot start requested." });
});

app.post("/api/stop", (_req, res) => {
  if (!state.desiredRunning && !bot && !state.connected && !state.connecting) {
    return res.json({ success: false, message: "Bot is already stopped." });
  }

  stopBot();
  return res.json({ success: true, message: "Bot stopped." });
});

app.post("/api/auto-reconnect", (req, res) => {
  const enabled = Boolean(req.body.enabled);
  state.autoReconnectEnabled = enabled;

  if (!enabled) {
    clearReconnectTimer();
    addLog("[Control] Auto reconnect disabled from dashboard");
  } else {
    addLog("[Control] Auto reconnect enabled from dashboard");
    if (!state.connected && !state.connecting && state.desiredRunning && !bot) {
      scheduleReconnect("Auto reconnect enabled");
    }
  }

  return res.json({
    success: true,
    message: enabled ? "Auto reconnect enabled." : "Auto reconnect disabled.",
    autoReconnectEnabled: state.autoReconnectEnabled,
  });
});

app.post("/api/settings", (req, res) => {
  const body = req.body || {};
  const nextSettings = {
    appName: String(body.appName || "").trim() || config.name,
    host: String(body.host || "").trim(),
    port: Number(body.port),
    version: String(body.version || "").trim(),
    username: String(body.username || "").trim(),
    password: String(body.password || ""),
    auth: String(body.auth || "").trim() || "offline",
    autoAuthEnabled: Boolean(body.autoAuthEnabled),
    autoAuthPassword: String(body.autoAuthPassword || ""),
    antiAfkEnabled: Boolean(body.antiAfkEnabled),
    reconnectDelayMs: 300000,
  };

  if (!nextSettings.host) {
    return res.status(400).json({ success: false, message: "Server IP or host is required." });
  }
  if (!Number.isFinite(nextSettings.port) || nextSettings.port <= 0) {
    return res.status(400).json({ success: false, message: "Server port must be a valid number." });
  }
  if (!nextSettings.username) {
    return res.status(400).json({ success: false, message: "Bot username is required." });
  }

  saveEditableSettings(nextSettings);
  addLog(`[Control] Settings updated for ${nextSettings.host}:${nextSettings.port}`);

  const shouldRestart = state.desiredRunning;
  if (bot || state.connecting || state.connected) {
    cleanupBot();
  }
  clearReconnectTimer();
  state.connected = false;
  state.connecting = false;
  state.lastDisconnectReason = "Settings updated from dashboard";

  if (shouldRestart) {
    startBot();
  }

  return res.json({
    success: true,
    message: "Settings saved. Bot updated with the new server details.",
    settings: getEditableSettings(),
  });
});

app.post("/api/command", (req, res) => {
  const command = String(req.body.command || "").trim();

  if (!command) {
    return res.status(400).json({ success: false, message: "Command is empty." });
  }

  if (!bot || !state.connected) {
    return res.status(400).json({ success: false, message: "Bot is not connected yet." });
  }

  try {
    bot.chat(command);
    addLog(`[Dashboard] Sent command: ${command}`);
    return res.json({ success: true, message: `Sent: ${command}` });
  } catch (error) {
    addLog(`[Dashboard] Command failed: ${error.message}`);
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    app: config.name,
    state: getStatus(),
  });
});

app.get("/ping", (_req, res) => {
  res.type("text/plain").send("pong");
});

app.listen(port, "0.0.0.0", () => {
  addLog(`[Server] Dashboard running on port ${port}`);
  state.desiredRunning = true;
  startBot();
  startKeepAlive();
});

process.on("uncaughtException", (error) => {
  state.lastError = error.message;
  addLog(`[Fatal] ${error.message}`);
  cleanupBot();
  scheduleReconnect("Uncaught exception");
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  state.lastError = message;
  addLog(`[Fatal] ${message}`);
  cleanupBot();
  scheduleReconnect("Unhandled rejection");
});

process.on("SIGINT", () => {
  stopBot();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopBot();
  process.exit(0);
});

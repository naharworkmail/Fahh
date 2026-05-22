"use strict";

const fs = require("fs");
const path = require("path");
const settings = require("./settings.json");

const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value, min, max, fallback) {
  const parsed = parseNumber(value, fallback);
  return Math.min(Math.max(parsed, min), max);
}

module.exports = {
  name: process.env.APP_NAME || settings.name || "AFK Bot Dashboard",
  bot: {
    username: process.env.MC_USERNAME || settings["bot-account"]?.username || "",
    password: process.env.MC_PASSWORD || settings["bot-account"]?.password || "",
    auth: process.env.MC_AUTH || settings["bot-account"]?.type || "offline",
  },
  server: {
    host: process.env.MC_HOST || settings.server?.ip || "localhost",
    port: parseNumber(process.env.MC_PORT, settings.server?.port || 25565),
    version: process.env.MC_VERSION || settings.server?.version || "",
  },
  autoAuth: {
    enabled: parseBoolean(
      process.env.AUTO_AUTH_ENABLED,
      settings.utils?.["auto-auth"]?.enabled ?? false,
    ),
    password:
      process.env.AUTO_AUTH_PASSWORD || settings.utils?.["auto-auth"]?.password || "",
  },
  antiAfk: {
    enabled: parseBoolean(
      process.env.ANTI_AFK_ENABLED,
      settings.utils?.["anti-afk"]?.enabled ?? true,
    ),
    jump: parseBoolean(process.env.ANTI_AFK_JUMP, true),
    rotate: parseBoolean(process.env.ANTI_AFK_ROTATE, true),
    intervalMs: parseNumber(process.env.ANTI_AFK_INTERVAL_MS, 15000),
  },
  reconnect: {
    enabled: parseBoolean(
      process.env.AUTO_RECONNECT_ENABLED,
      settings.utils?.["auto-reconnect"] ?? true,
    ),
    delayMs: clampNumber(
      process.env.AUTO_RECONNECT_DELAY_MS,
      1000,
      300000,
      settings.utils?.["auto-reconnect-delay"] || 300000,
    ),
    maxDelayMs: clampNumber(
      process.env.AUTO_RECONNECT_MAX_DELAY_MS,
      1000,
      900000,
      settings.utils?.["max-reconnect-delay"] || 300000,
    ),
  },
};

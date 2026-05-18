#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ENV_PATH = path.resolve(process.cwd(), ".env");

function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) {
    return "";
  }
  return fs.readFileSync(ENV_PATH, "utf8");
}

function upsertEnvValue(content, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }
  const separator = content && !content.endsWith("\n") ? "\n" : "";
  return `${content}${separator}${line}\n`;
}

function extractAuthCode(input) {
  const value = String(input || "").trim();
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    return url.searchParams.get("code") || url.searchParams.get("request_token") || value;
  } catch (_) {
    const match = value.match(/[?&](?:code|request_token)=([^&#\s]+)/);
    return match ? decodeURIComponent(match[1]) : value;
  }
}

const input = process.argv.slice(2).join(" ").trim();
const code = extractAuthCode(input);

if (!code) {
  console.error("Usage: npm run oauth:save-code -- '<code-or-full-redirect-url>'");
  process.exit(1);
}

const updated = upsertEnvValue(readEnvFile(), "SHOONYA_AUTH_CODE", code);
fs.writeFileSync(ENV_PATH, updated, { mode: 0o600 });

console.log(`Saved SHOONYA_AUTH_CODE to ${ENV_PATH}`);

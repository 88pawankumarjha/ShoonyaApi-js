#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const NorenRestApi = require("../lib/RestApi");

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

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

async function main() {
  const input = process.argv.slice(2).join(" ").trim();

  if (!input) {
    console.error("Usage: npm run oauth:flow -- '<code-or-full-redirect-url>'");
    process.exit(1);
  }

  // Step 1: Extract and save auth code
  const code = extractAuthCode(input);

  if (!code) {
    console.error("Failed to extract authentication code from input");
    process.exit(1);
  }

  const updated = upsertEnvValue(readEnvFile(), "SHOONYA_AUTH_CODE", code);
  fs.writeFileSync(ENV_PATH, updated, { mode: 0o600 });
  console.log(`✓ Saved SHOONYA_AUTH_CODE to ${ENV_PATH}`);

  // Step 2: Generate OAuth token
  try {
    const api = new NorenRestApi();
    const clientId = requireEnv("SHOONYA_CLIENT_ID");
    const secretCode = requireEnv("SHOONYA_SECRET_CODE");

    const response = await api.getAccessToken({
      code,
      client_id: clientId,
      secret_code: secretCode,
      uid: process.env.SHOONYA_UID,
      token_url: process.env.SHOONYA_OAUTH_TOKEN_URL,
    });

    if (!response || !response.access_token) {
      console.error("OAuth token exchange failed.");
      console.error(JSON.stringify(response, null, 2));
      process.exit(1);
    }

    const outputPath = path.resolve(process.cwd(), ".shoonya-oauth-token.json");
    fs.writeFileSync(outputPath, JSON.stringify(response, null, 2), { mode: 0o600 });

    console.log("✓ OAuth token generated and saved to .shoonya-oauth-token.json");
    console.log(JSON.stringify({
      stat: response.stat,
      user: response.USERID,
      account: response.actid,
      expires_in: response.expires_in,
      request_time: response.request_time,
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

main();

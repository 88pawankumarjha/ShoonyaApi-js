#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ENV_PATH = path.resolve(process.cwd(), ".env");
const PORT = Number(process.env.SHOONYA_OAUTH_LISTEN_PORT || 8787);
const HOST = process.env.SHOONYA_OAUTH_LISTEN_HOST || "0.0.0.0";
const CALLBACK_PATH = process.env.SHOONYA_OAUTH_CALLBACK_PATH || "/callback";

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

function saveAuthCode(code) {
  const current = readEnvFile();
  const updated = upsertEnvValue(current, "SHOONYA_AUTH_CODE", code);
  fs.writeFileSync(ENV_PATH, updated, { mode: 0o600 });
}

function runTokenExchange(code) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "oauth:token"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SHOONYA_AUTH_CODE: code,
      },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (status) => {
      if (status === 0) {
        resolve();
        return;
      }
      reject(new Error(`oauth:token failed with exit code ${status}`));
    });
  });
}

function sendHtml(res, statusCode, title, body) {
  res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="font-family: system-ui, sans-serif; padding: 24px; line-height: 1.4;">
    <h2>${title}</h2>
    <p>${body}</p>
  </body>
</html>`);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname !== CALLBACK_PATH && requestUrl.pathname !== "/") {
    sendHtml(res, 404, "Not found", "Use the configured Shoonya OAuth callback URL.");
    return;
  }

  const code = requestUrl.searchParams.get("code") || requestUrl.searchParams.get("request_token");
  if (!code) {
    sendHtml(res, 200, "Waiting for Shoonya code", "Authorize Shoonya from mobile. This page will capture the OAuth code after redirect.");
    return;
  }

  try {
    saveAuthCode(code);
    console.log(`Saved Shoonya auth code to ${ENV_PATH}`);
    await runTokenExchange(code);
    sendHtml(res, 200, "Shoonya token ready", "OAuth code was captured and today's token file was generated. You can close this page.");
    setTimeout(() => server.close(), 500);
  } catch (error) {
    console.error(error.message);
    sendHtml(res, 500, "Shoonya token failed", "OAuth code was captured, but token generation failed. Check the EC2 terminal logs.");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Shoonya OAuth listener running on http://${HOST}:${PORT}${CALLBACK_PATH}`);
  console.log(`Set Shoonya redirect URL to http://<EC2_PUBLIC_IP>:${PORT}${CALLBACK_PATH}`);
  const clientId = encodeURIComponent(process.env.SHOONYA_CLIENT_ID || "YOUR_CLIENT_ID");
  console.log(`Open on mobile: https://trade.shoonya.com/OAuthlogin/authorize/oauth?client_id=${clientId}`);
});

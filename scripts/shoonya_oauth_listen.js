#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { spawn } = require("child_process");
const http = require("http");

const PORT = Number(process.env.SHOONYA_OAUTH_LISTEN_PORT || 8787);
const HOST = process.env.SHOONYA_OAUTH_LISTEN_HOST || "0.0.0.0";
const CALLBACK_PATH = process.env.SHOONYA_OAUTH_CALLBACK_PATH || "/callback";
const AUTO_CLOSE = process.env.SHOONYA_OAUTH_AUTO_CLOSE !== "false";

function runOAuthFlow(code) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "oauth:flow", "--", code], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (status) => {
      if (status === 0) {
        resolve();
        return;
      }
      reject(new Error(`oauth:flow failed with exit code ${status}`));
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getBaseUrl(req) {
  if (process.env.SHOONYA_OAUTH_PUBLIC_BASE_URL) {
    return process.env.SHOONYA_OAUTH_PUBLIC_BASE_URL.replace(/\/+$/, "");
  }
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function getAuthorizeUrl() {
  const loginUrl = process.env.SHOONYA_OAUTH_LOGIN_URL || "https://trade.shoonya.com/OAuthlogin";
  const clientId = encodeURIComponent(process.env.SHOONYA_CLIENT_ID || "YOUR_CLIENT_ID");
  return `${loginUrl.replace(/\/+$/, "")}/authorize/oauth?client_id=${clientId}`;
}

function createBookmarklet(callbackUrl) {
  return `javascript:(()=>{const urls=[location.href,document.referrer,...performance.getEntriesByType('navigation').map(e=>e.name),...performance.getEntriesByType('resource').map(e=>e.name)];let code='';for(const item of urls){try{const url=new URL(item,location.href);code=url.searchParams.get('code')||url.searchParams.get('request_token')||code;if(code)break}catch(_){}}if(!code){prompt('Shoonya code not found. Copy the address-bar URL and run npm run oauth:save-code -- "<URL>"');return;}location.href=${JSON.stringify(callbackUrl)}+'?code='+encodeURIComponent(code);})();`;
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

function sendHtml(res, statusCode, title, body) {
  res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="font-family: system-ui, sans-serif; padding: 24px; line-height: 1.45; max-width: 720px; margin: 0 auto;">
    <h2>${escapeHtml(title)}</h2>
    ${body}
  </body>
</html>`);
}

function sendHomePage(req, res) {
  const baseUrl = getBaseUrl(req);
  const callbackUrl = `${baseUrl}${CALLBACK_PATH}`;
  const bookmarklet = createBookmarklet(callbackUrl);
  const bookmarkletUrl = `${baseUrl}/bookmarklet.txt`;
  const authorizeUrl = getAuthorizeUrl();

  sendHtml(res, 200, "Shoonya mobile OAuth", `
    <p>This page removes the daily terminal copy/paste step. Login still has to be completed manually in Shoonya.</p>
    <h3>One-time phone setup</h3>
    <ol>
      <li>Create or edit a phone browser bookmark named <strong>Shoonya Auto Token</strong>.</li>
      <li>Set the bookmark URL to the bookmarklet below.</li>
    </ol>
    <p><a href="${escapeHtml(bookmarkletUrl)}">Open bookmarklet text</a></p>
    <textarea readonly style="box-sizing: border-box; width: 100%; min-height: 160px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;">${escapeHtml(bookmarklet)}</textarea>
    <h3>Daily flow</h3>
    <ol>
      <li><a href="${escapeHtml(authorizeUrl)}">Open Shoonya login</a></li>
      <li>Login and authorize.</li>
      <li>On the final Shoonya page, open the <strong>Shoonya Auto Token</strong> bookmark.</li>
    </ol>
    <p>The bookmark will send the code to <code>${escapeHtml(callbackUrl)}</code>, update <code>.env</code>, and run <code>npm run oauth:flow</code>.</p>
    <h3>Fallback</h3>
    <p>If the bookmark says it cannot find the code, copy the final Shoonya page URL, paste it below, and submit.</p>
    <form method="post" action="${escapeHtml(callbackUrl)}">
      <textarea name="url" rows="4" style="box-sizing: border-box; width: 100%; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;" placeholder="Paste final Shoonya URL or raw code"></textarea>
      <button type="submit" style="margin-top: 12px; padding: 10px 14px;">Generate token</button>
    </form>
  `);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10000) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/bookmarklet.txt") {
    const callbackUrl = `${getBaseUrl(req)}${CALLBACK_PATH}`;
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`${createBookmarklet(callbackUrl)}\n`);
    return;
  }

  if (requestUrl.pathname !== CALLBACK_PATH && requestUrl.pathname !== "/") {
    sendHtml(res, 404, "Not found", "Use the configured Shoonya OAuth callback URL.");
    return;
  }

  let code = requestUrl.searchParams.get("code") || requestUrl.searchParams.get("request_token");
  if (!code && req.method === "POST" && requestUrl.pathname === CALLBACK_PATH) {
    const body = await readRequestBody(req);
    const params = new URLSearchParams(body);
    code = extractAuthCode(params.get("url") || params.get("code") || body);
  }

  if (!code) {
    sendHomePage(req, res);
    return;
  }

  try {
    await runOAuthFlow(code);
    sendHtml(res, 200, "Shoonya token ready", "<p>OAuth code was captured and today's token file was generated. You can close this page.</p>");
    if (AUTO_CLOSE) {
      setTimeout(() => server.close(), 500);
    }
  } catch (error) {
    console.error(error.message);
    sendHtml(res, 500, "Shoonya token failed", "<p>OAuth code was captured, but token generation failed. Check the EC2 terminal logs.</p>");
  }
});

server.listen(PORT, HOST, () => {
  const defaultBaseUrl = process.env.SHOONYA_OAUTH_PUBLIC_BASE_URL || `http://<EC2_PUBLIC_IP>:${PORT}`;
  console.log(`Shoonya OAuth mobile helper running on http://${HOST}:${PORT}/`);
  console.log(`Open this on mobile: ${defaultBaseUrl}/`);
  console.log(`Callback endpoint: ${defaultBaseUrl}${CALLBACK_PATH}`);
  console.log(`Shoonya login URL: ${getAuthorizeUrl()}`);
});

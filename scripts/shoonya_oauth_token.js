#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const NorenRestApi = require("../lib/RestApi");

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

async function main() {
  const api = new NorenRestApi();
  const code = requireEnv("SHOONYA_AUTH_CODE");
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

  console.log("OAuth token generated and saved to .shoonya-oauth-token.json");
  console.log(JSON.stringify({
    stat: response.stat,
    user: response.USERID,
    account: response.actid,
    expires_in: response.expires_in,
    request_time: response.request_time,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

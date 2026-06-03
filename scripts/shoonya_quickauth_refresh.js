#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const speakeasy = require("speakeasy");
const NorenRestApi = require("../lib/RestApi");

const DEFAULT_SESSION_FILE = ".shoonya-oauth-token.json";

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function loadLocalAuthParams() {
  for (const modulePath of ["../creds", "../cred"]) {
    try {
      return require(modulePath).authparams || {};
    } catch (_) {
      // Try the next local credential module.
    }
  }
  return {};
}

function envAuthParams() {
  return {
    userid: firstValue(process.env.SHOONYA_USERID, process.env.SHOONYA_UID),
    password: process.env.SHOONYA_PASSWORD,
    vendor_code: process.env.SHOONYA_VENDOR_CODE,
    api_secret: process.env.SHOONYA_API_SECRET,
    imei: process.env.SHOONYA_IMEI,
  };
}

function buildTotp() {
  const secret = process.env.SHOONYA_TOTP_SECRET;
  if (!secret) {
    return undefined;
  }

  return speakeasy.totp({
    secret,
    encoding: process.env.SHOONYA_TOTP_ENCODING || "base32",
  });
}

function buildAuthParams() {
  const local = loadLocalAuthParams();
  const env = envAuthParams();
  const totp = buildTotp();

  const params = {
    ...local,
    ...Object.fromEntries(Object.entries(env).filter(([, value]) => value)),
  };

  if (totp) {
    params.twoFA = totp;
  }

  return params;
}

function assertRequired(params) {
  const required = ["userid", "password", "twoFA", "vendor_code", "api_secret", "imei"];
  const missing = required.filter((key) => !params[key] || !String(params[key]).trim());
  if (missing.length) {
    throw new Error(`Missing Shoonya QuickAuth fields: ${missing.join(", ")}`);
  }
}

function sessionOutputPath() {
  return path.resolve(process.cwd(), process.env.SHOONYA_SESSION_FILE || process.env.SHOONYA_TOKEN_FILE || DEFAULT_SESSION_FILE);
}

function safeSummary(response) {
  return {
    stat: response && response.stat,
    request_time: response && response.request_time,
    user: response && (response.uid || response.userid || response.USERID),
    account: response && response.actid,
    token_present: Boolean(response && response.susertoken),
    emsg: response && response.emsg,
  };
}

function countPositions(response) {
  if (Array.isArray(response)) {
    return response.length;
  }
  if (Array.isArray(response && response.values)) {
    return response.values.length;
  }
  return undefined;
}

async function verifyReadOnly(api) {
  const limits = await api.get_limits();
  console.log("Read-only limits check:", JSON.stringify({
    stat: limits && limits.stat,
    emsg: limits && limits.emsg,
  }));

  const positions = await api.get_positions();
  console.log("Read-only positions check:", JSON.stringify({
    stat: positions && positions.stat,
    count: countPositions(positions),
    emsg: positions && positions.emsg,
  }));
}

async function main() {
  const verify = process.argv.includes("--verify");
  const params = buildAuthParams();
  assertRequired(params);

  const api = new NorenRestApi();
  const response = await api.login({
    ...params,
    forceQuickAuth: true,
  });

  if (!response || response.stat !== "Ok" || !response.susertoken) {
    console.error("Shoonya QuickAuth refresh failed.");
    console.error(JSON.stringify(safeSummary(response), null, 2));
    process.exit(1);
  }

  if (verify) {
    await verifyReadOnly(api);
  }

  const outputPath = sessionOutputPath();
  const output = {
    ...response,
    auth_type: "quickauth",
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), { mode: 0o600 });

  console.log("Shoonya QuickAuth session refreshed.");
  console.log(JSON.stringify({
    ...safeSummary(response),
    output: outputPath,
    auth_type: output.auth_type,
    generated_at: output.generated_at,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

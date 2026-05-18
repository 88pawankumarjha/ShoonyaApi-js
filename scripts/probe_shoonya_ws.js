#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { API } = require("../lib/config");

function firstValue(source, keys) {
  const key = keys.find((candidate) => source[candidate]);
  return key ? source[key] : undefined;
}

function connectOnce({ label, token, uid, actid }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(API.websocket, null, { rejectUnauthorized: false });
    const done = (result) => {
      try {
        ws.close();
      } catch (_) {}
      resolve({ label, ...result });
    };
    const timeout = setTimeout(() => done({ ok: false, error: "timeout waiting for ck" }), 7000);

    ws.on("open", () => {
      ws.send(JSON.stringify({
        t: "c",
        uid,
        actid,
        susertoken: token,
        source: "API",
      }));
    });

    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch (error) {
        clearTimeout(timeout);
        done({ ok: false, error: `non-json message: ${error.message}` });
        return;
      }

      if (message.t === "ck") {
        clearTimeout(timeout);
        done({ ok: message.s === "OK", ack: { t: message.t, s: message.s, uid: message.uid, actid: message.actid, emsg: message.emsg } });
      }
    });

    ws.on("error", (error) => {
      clearTimeout(timeout);
      done({ ok: false, error: error.message });
    });
  });
}

async function main() {
  const tokenPath = path.resolve(process.cwd(), process.env.SHOONYA_TOKEN_FILE || ".shoonya-oauth-token.json");
  const tokenData = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  const uid = firstValue(tokenData, ["USERID", "UserID", "UserId", "uid", "UID", "usrid", "user_id", "userid"]) || process.env.SHOONYA_UID;
  const actid = firstValue(tokenData, ["actid", "ActID", "ActId", "Account_ID", "AccountID", "account_id", "accountId"]) || process.env.SHOONYA_ACTID || uid;

  if (!uid || !actid) {
    throw new Error("uid/actid is missing in token file or env");
  }

  const candidates = [
    ["access_token", tokenData.access_token],
    ["susertoken", tokenData.susertoken],
    ["refresh_token", tokenData.refresh_token],
  ].filter(([, value]) => value);

  console.log(JSON.stringify({
    websocket: API.websocket,
    uid,
    actid,
    tokenCandidates: candidates.map(([label]) => label),
  }));

  for (const [label, token] of candidates) {
    const result = await connectOnce({ label, token, uid, actid });
    console.log(JSON.stringify(result));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

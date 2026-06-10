#!/usr/bin/env python3
"""Refresh Shoonya OAuth token through the browser login + TOTP flow."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


DEFAULT_LOGIN_BASE = "https://api.shoonya.com/OAuthlogin/investor-entry-level/login"
DEFAULT_TOKEN_URL = "https://api.shoonya.com/NorenWClientAPI/GenAcsTok"
DEFAULT_TOKEN_FILE = ".shoonya-oauth-token.json"


class RefreshError(RuntimeError):
    """Raised for expected refresh failures."""


def run_node(repo_dir: Path, code: str) -> str:
    completed = subprocess.run(
        ["node", "-e", code, str(repo_dir)],
        cwd=repo_dir,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise RefreshError(f"Node helper failed: {detail}")
    return completed.stdout.strip()


def load_config(repo_dir: Path) -> dict[str, str]:
    node_code = r"""
const path = require("path");
const repoDir = process.argv[1];
process.chdir(repoDir);
require(path.join(repoDir, "node_modules", "dotenv")).config({ path: path.join(repoDir, ".env") });
const speakeasy = require(path.join(repoDir, "node_modules", "speakeasy"));

function loadAuthParams() {
  for (const name of ["creds", "cred"]) {
    try {
      return require(path.join(repoDir, name)).authparams || {};
    } catch (_) {
      // Try the next local credential module.
    }
  }
  return {};
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

const local = loadAuthParams();
let factor2 = firstValue(process.env.SHOONYA_2FA, process.env.SHOONYA_FACTOR2, local.twoFA, local.factor2);
if (firstValue(process.env.SHOONYA_TOTP_SECRET)) {
  factor2 = speakeasy.totp({
    secret: process.env.SHOONYA_TOTP_SECRET,
    encoding: process.env.SHOONYA_TOTP_ENCODING || "base32",
  });
}

const output = {
  client_id: firstValue(process.env.SHOONYA_CLIENT_ID, process.env.SHOONYA_CLIENTID, process.env.SHOONYA_API_KEY),
  secret_code: firstValue(process.env.SHOONYA_SECRET_CODE),
  userid: firstValue(process.env.SHOONYA_USERID, process.env.SHOONYA_UID, local.userid, local.uid),
  password: firstValue(process.env.SHOONYA_PASSWORD, local.password, local.pwd),
  factor2,
  login_base: firstValue(process.env.SHOONYA_OAUTH_BROWSER_LOGIN_URL, "https://api.shoonya.com/OAuthlogin/investor-entry-level/login"),
  token_url: firstValue(process.env.SHOONYA_OAUTH_BROWSER_TOKEN_URL, "https://api.shoonya.com/NorenWClientAPI/GenAcsTok"),
};

console.log(JSON.stringify(output));
"""
    raw = run_node(repo_dir, node_code)
    try:
        config = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RefreshError(f"Node helper returned non-JSON config: {raw[:120]}") from exc

    missing = [key for key in ("client_id", "secret_code", "userid", "password", "factor2") if not config.get(key)]
    if missing:
        raise RefreshError(f"Missing Shoonya OAuth fields: {', '.join(missing)}")
    return {key: str(value) for key, value in config.items() if value is not None}


def set_input(driver: webdriver.Chrome, element_id: str, value: str) -> None:
    element = WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.ID, element_id)))
    driver.execute_script(
        """
        const element = arguments[0];
        const value = arguments[1];
        element.focus();
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        """,
        element,
        value,
    )


def click_login(driver: webdriver.Chrome) -> None:
    candidates = driver.find_elements(By.XPATH, "//*[self::button or self::input or self::a][contains(translate(normalize-space(.), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), 'LOGIN') or translate(@value, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')='LOGIN']")
    for candidate in candidates:
        try:
            if candidate.is_displayed() and candidate.is_enabled():
                driver.execute_script("arguments[0].click();", candidate)
                return
        except Exception:
            continue
    raise RefreshError("Could not find Shoonya browser login button")


def extract_code_from_text(text: str) -> str | None:
    patterns = (
        r"[?&]code=([^&#]+)",
        r'"code"\s*:\s*"([^"]+)"',
        r"'code'\s*:\s*'([^']+)'",
        r"\bcode=([A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+)",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    return None


def capture_code_from_logs(driver: webdriver.Chrome) -> str | None:
    try:
        logs = driver.get_log("performance")
    except Exception:
        return None

    for entry in logs:
        message = entry.get("message", "")
        code = extract_code_from_text(message)
        if code:
            return code
    return None


def capture_auth_code(config: dict[str, str], timeout_seconds: int) -> str:
    login_url = (
        f"{config.get('login_base') or DEFAULT_LOGIN_BASE}"
        f"?api_key={requests.utils.quote(config['client_id'])}"
        f"&route_to={requests.utils.quote(config['userid'])}"
    )

    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-background-networking")
    options.add_argument("--disable-extensions")
    options.add_argument("--window-size=1365,900")
    options.set_capability("goog:loggingPrefs", {"performance": "ALL"})

    with tempfile.TemporaryDirectory(prefix="shoonya-oauth-browser-") as user_data_dir:
        options.add_argument(f"--user-data-dir={user_data_dir}")
        driver = webdriver.Chrome(options=options)
        try:
            driver.get(login_url)
            set_input(driver, "lgnusrid", config["userid"])
            set_input(driver, "lgnpwd", config["password"])
            set_input(driver, "lgnotp", config["factor2"])
            click_login(driver)

            deadline = time.time() + timeout_seconds
            while time.time() < deadline:
                for text in (driver.current_url, driver.page_source):
                    code = extract_code_from_text(text)
                    if code:
                        return code
                code = capture_code_from_logs(driver)
                if code:
                    return code
                time.sleep(0.5)
        finally:
            driver.quit()

    raise RefreshError("Shoonya OAuth code was not captured before timeout")


def exchange_token(config: dict[str, str], auth_code: str) -> dict[str, Any]:
    checksum = hashlib.sha256(f"{config['client_id']}{config['secret_code']}{auth_code}".encode()).hexdigest()
    payload = "jData=" + json.dumps({"code": auth_code, "checksum": checksum}, separators=(",", ":"))
    response = requests.post(
        config.get("token_url") or DEFAULT_TOKEN_URL,
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    try:
        token_data = response.json()
    except ValueError as exc:
        raise RefreshError(f"Token endpoint returned non-JSON HTTP {response.status_code}: {response.text[:160]}") from exc

    if response.status_code >= 400 or not token_data.get("access_token"):
        safe = {
            "http_status": response.status_code,
            "stat": token_data.get("stat"),
            "emsg": token_data.get("emsg"),
            "message": token_data.get("message"),
            "access_token_present": bool(token_data.get("access_token")),
        }
        raise RefreshError(f"Shoonya OAuth token exchange failed: {json.dumps(safe)}")
    return token_data


def write_token_file(path: Path, token_data: dict[str, Any], auth_code: str) -> None:
    output = {
        **token_data,
        "auth_type": "python_browser_oauth",
        "auth_code_captured": True,
        "auth_code_preview": f"{auth_code[:4]}...{auth_code[-4:]}" if len(auth_code) > 8 else "***",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    os.chmod(tmp_path, stat.S_IRUSR | stat.S_IWUSR)
    tmp_path.replace(path)
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


def verify_js_login(repo_dir: Path) -> dict[str, Any]:
    node_code = r"""
const path = require("path");
const repoDir = process.argv[1];
process.chdir(repoDir);
require(path.join(repoDir, "node_modules", "dotenv")).config({ path: path.join(repoDir, ".env") });
const Api = require(path.join(repoDir, "lib", "RestApi"));

function loadAuthParams() {
  for (const name of ["creds", "cred"]) {
    try {
      return require(path.join(repoDir, name)).authparams || {};
    } catch (_) {
      // Try the next local credential module.
    }
  }
  return {};
}

function countPositions(response) {
  if (Array.isArray(response)) return response.length;
  if (Array.isArray(response && response.values)) return response.values.length;
  return undefined;
}

(async () => {
  const api = new Api({});
  const login = await api.login(loadAuthParams());
  const limits = await api.get_limits();
  const positions = await api.get_positions();
  console.log(JSON.stringify({
    login_token_type: login && login.access_token ? "oauth_access_token" : (login && login.susertoken ? "susertoken" : "none"),
    token_file_loaded: Boolean(login && (login.access_token || login.susertoken)),
    limits_stat: limits && limits.stat,
    limits_emsg: limits && limits.emsg,
    positions_stat: Array.isArray(positions) ? "Ok" : positions && positions.stat,
    positions_count: countPositions(positions),
    positions_emsg: positions && positions.emsg,
  }));
})().catch((error) => {
  console.log(JSON.stringify({
    error: error && error.message ? error.message : String(error),
  }));
  process.exit(1);
});
"""
    raw = run_node(repo_dir, node_code)
    try:
        result = json.loads(raw.splitlines()[-1])
    except json.JSONDecodeError as exc:
        raise RefreshError(f"JS verification returned non-JSON output: {raw[:200]}") from exc

    if result.get("error"):
        raise RefreshError(f"JS verification failed: {result['error']}")
    if not result.get("token_file_loaded") or result.get("limits_stat") != "Ok":
        raise RefreshError(f"JS verification did not pass: {json.dumps(result)}")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh Shoonya OAuth token through headless browser login.")
    parser.add_argument("--repo-dir", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--token-file", default=os.environ.get("SHOONYA_SESSION_FILE") or os.environ.get("SHOONYA_TOKEN_FILE") or DEFAULT_TOKEN_FILE)
    parser.add_argument("--timeout", type=int, default=75)
    parser.add_argument("--verify-js", action="store_true")
    args = parser.parse_args()

    repo_dir = Path(args.repo_dir).resolve()
    token_path = Path(args.token_file)
    if not token_path.is_absolute():
        token_path = repo_dir / token_path

    config = load_config(repo_dir)
    auth_code = capture_auth_code(config, args.timeout)
    token_data = exchange_token(config, auth_code)
    write_token_file(token_path, token_data, auth_code)

    summary: dict[str, Any] = {
        "stage": "shoonya_oauth_browser_refresh",
        "auth_code_captured": True,
        "token_exchange": "ok",
        "token_file": str(token_path),
        "access_token_present": bool(token_data.get("access_token")),
        "refresh_token_present": bool(token_data.get("refresh_token")),
        "account_present": bool(token_data.get("actid") or token_data.get("AccountId")),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    if args.verify_js:
        summary["js_verify"] = verify_js_login(repo_dir)

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RefreshError as exc:
        print(json.dumps({"stage": "shoonya_oauth_browser_refresh", "status": "error", "message": str(exc)}, indent=2), file=sys.stderr)
        raise SystemExit(1)

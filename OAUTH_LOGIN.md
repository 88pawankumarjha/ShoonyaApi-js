# Shoonya OAuth Login

Run this from the whitelisted EC2 instance.

```bash
npm install
```

```bash
cp .env.example .env
```

Fill `.env` locally:

```bash
SHOONYA_CLIENT_ID=your_client_id
SHOONYA_SECRET_CODE=your_secret_code
SHOONYA_AUTH_CODE=fresh_code_from_oauth_login
```

Then exchange the code for an access token:

```bash
npm run oauth:token
```

The response is saved to `.shoonya-oauth-token.json`, which is ignored by Git.

## Automated mobile flow

Shoonya login/2FA still has to be completed manually. The code capture, `.env`
update, and token generation can be automated from the phone.

Keep the Shoonya API URL as the valid HTTPS Shoonya login URL:

```text
https://trade.shoonya.com/OAuthlogin
```

On EC2, set the public helper URL in `.env`:

```bash
SHOONYA_OAUTH_PUBLIC_BASE_URL=http://<EC2_PUBLIC_IP>:8787
```

Start the helper before login:

```bash
cd ~/2
pm2 delete shoonya-oauth-listener 2>/dev/null || true
pm2 start scripts/shoonya_oauth_listen.js --name shoonya-oauth-listener --interpreter node --no-autorestart
```

Open the helper on your phone:

```text
http://<EC2_PUBLIC_IP>:8787/
```

One-time phone setup:

1. Open the helper page.
2. Open `bookmarklet.txt` from the helper page.
3. Copy the generated `javascript:(()=>{...})();` line.
4. Create or edit a phone browser bookmark named `Shoonya Auto Token`.
5. Set the bookmark URL to that generated JavaScript line.

Daily phone flow:

1. Start `shoonya-oauth-listener` on EC2.
2. Open `http://<EC2_PUBLIC_IP>:8787/` on mobile.
3. Tap `Open Shoonya login`.
4. Login and authorize.
5. On the final Shoonya page, open the `Shoonya Auto Token` bookmark.

The bookmark sends the code back to EC2 and runs:

```bash
npm run oauth:flow
```

The response is saved to `.shoonya-oauth-token.json`, which is ignored by Git.
The listener exits automatically after a successful token exchange unless
`SHOONYA_OAUTH_AUTO_CLOSE=false`.

## Manual mobile fallback

If the phone cannot reach the EC2 helper page, use the raw-code bookmarklet in:

```text
tools/shoonya_mobile_oauth_bookmarklet.txt
```

Fallback daily flow:

1. Open the Shoonya authorize URL on mobile.
2. Login and authorize.
3. On the final Shoonya page, open the `Shoonya Code` bookmark.
4. Copy the generated raw code value.
5. On EC2, save it and generate today's token:

```bash
cd ~/2
npm run oauth:save-code -- '<paste-code-or-full-redirect-url>'
npm run oauth:token
```

For API calls, use the returned `access_token` as:

```text
Authorization: Bearer <access_token>
```

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

## Mobile-only code capture

If Shoonya rejects a custom `http://<EC2 IP>:8787/callback` URL, keep the
Shoonya API URL as the valid HTTPS Shoonya login URL:

```text
https://trade.shoonya.com/OAuthlogin
```

On your phone, create a browser bookmark named `Shoonya Code` and set its URL to
the one-line bookmarklet in:

```text
tools/shoonya_mobile_oauth_bookmarklet.txt
```

Daily flow:

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

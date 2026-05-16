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

For API calls, use the returned `access_token` as:

```text
Authorization: Bearer <access_token>
```

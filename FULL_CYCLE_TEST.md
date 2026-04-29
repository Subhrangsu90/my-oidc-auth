# Full Cycle OIDC Test

This guide walks through the complete manual test flow for this project:

1. Start the auth server
2. Register a client application
3. Check the discovery endpoints
4. Create a user account
5. Run the authorization code flow
6. Exchange the code for tokens
7. Call the `userinfo` endpoint

## Prerequisites

- PostgreSQL is running and `DATABASE_URL` is set in `.env`
- The app dependencies are installed
- The server is started from the project root

## 1. Start The Server

Run:

```bash
npm run dev
```

By default, the app runs at:

```text
http://localhost:8000
```

## 2. Register A Client Application

Open this page in your browser:

```text
http://localhost:8000/o/admin
```

Create an application with values like:

- Display name: `OIDC Test Client`
- Application URL: `http://localhost:3000`
- Redirect URL: `http://localhost:3000/callback`
- Description: `Manual end-to-end OIDC test`

After submitting, keep these values:

- `clientId`
- `clientSecret`
- redirect URL

You will use them in the next steps.

## 3. Verify Discovery Endpoints

Open these URLs in your browser or test with `curl`.

OpenID discovery:

```bash
curl http://localhost:8000/o/.well-known/openid-configuration
```

OAuth authorization server discovery:

```bash
curl http://localhost:8000/o/.well-known/oauth-authorization-server
```

JWKS:

```bash
curl http://localhost:8000/.well-known/jwks.json
```

Expected:

- `issuer` points to `http://localhost:8000`
- `authorization_endpoint` is `/auth/authenticate`
- `token_endpoint` is `/auth/token`
- `userinfo_endpoint` is `/user/userinfo`
- `jwks_uri` is `/.well-known/jwks.json`

## 4. Create A User Account

Open this signup URL in your browser. Replace `YOUR_CLIENT_ID` and `YOUR_REDIRECT_URI`.

```text
http://localhost:8000/o/sign-up?client_id=YOUR_CLIENT_ID&redirect_uri=YOUR_REDIRECT_URI&state=test-state-123
```

Example:

```text
http://localhost:8000/o/sign-up?client_id=client_xxx&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&state=test-state-123
```

Expected:

- The page shows the client application name and URL
- You can create a new account
- After signup, the page redirects back to sign-in

## 5. Run The Authorization Step

Open this authorization URL in your browser:

```text
http://localhost:8000/o/auth/authenticate?client_id=YOUR_CLIENT_ID&redirect_uri=YOUR_REDIRECT_URI&response_type=code&scope=openid%20profile%20email&state=test-state-123
```

Example:

```text
http://localhost:8000/o/auth/authenticate?client_id=client_xxx&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&response_type=code&scope=openid%20profile%20email&state=test-state-123
```

Sign in with the account you created.

Expected:

- The login page shows the client application name and URL
- After sign-in, the browser redirects to your redirect URL
- The redirect URL contains:

```text
code=...
state=test-state-123
```

Copy the authorization `code`.

## 6. Exchange The Code For Tokens

Use the copied authorization code here:

```bash
curl -X POST http://localhost:8000/o/auth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "authorization_code",
    "code": "PASTE_AUTH_CODE_HERE",
    "redirect_uri": "http://localhost:3000/callback",
    "client_id": "PASTE_CLIENT_ID_HERE",
    "client_secret": "PASTE_CLIENT_SECRET_HERE"
  }'
```

Expected response:

- `token_type` is `Bearer`
- `access_token` is returned
- `id_token` is returned
- `expires_in` is `3600`

Copy the `access_token`.

## 7. Call The Userinfo Endpoint

```bash
curl http://localhost:8000/o/user/userinfo \
  -H "Authorization: Bearer PASTE_ACCESS_TOKEN_HERE"
```

Expected response fields:

- `sub`
- `email`
- `email_verified`
- `given_name`
- `family_name`
- `name`
- `picture`

## Quick End-To-End Checklist

- Client registration succeeds from `/o/admin`
- `/.well-known/openid-configuration` works
- `/.well-known/oauth-authorization-server` works
- `/o/auth/jwks.json` returns keys
- Signup page shows client name and URL
- Login page shows client name and URL
- Authorization redirects back with `code` and `state`
- Token exchange returns `access_token` and `id_token`
- `userinfo` returns the logged-in user

## Common Issues

## Invalid `redirect_uri`

Make sure the `redirect_uri` in the authorize request exactly matches one of the redirect URLs saved for the application.

## Invalid `client_id`

Make sure you are using the `clientId` returned from the app registration step.

## Invalid Client Credentials

Make sure the `client_id` and `client_secret` in the token request match the registered application.

## User Already Exists

If signup returns a duplicate account error, use a different email address.

## Token Or Userinfo Fails

Make sure:

- the authorization code is fresh and not already used
- the `redirect_uri` in the token request matches the one used during authorization
- the `Authorization` header is `Bearer <access_token>`

## Suggested Test Values

These values are handy for local manual testing:

```text
Application URL: http://localhost:3000
Redirect URL: http://localhost:3000/callback
State: test-state-123
Scope: openid profile email
```

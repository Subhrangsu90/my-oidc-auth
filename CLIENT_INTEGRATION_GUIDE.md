# Client Integration Guide (Start to End)

This guide shows how one client application integrates with this OIDC auth server from start to end:

1. register an application
2. create end-user account
3. sign in user and get auth code
4. exchange code for tokens
5. verify user with token
6. fetch user info
7. refresh access token (cookie-based)
8. logout
9. revoke refresh token

All examples below match current endpoints implemented in this project.

## 0) Base URL

- Local: `http://localhost:8000`
- Production: use your deployed auth server URL

## 1) Create OIDC Client Application

Use the UI:

- `GET /admin` in browser

or API:

```http
POST /auth/application/register
Content-Type: application/json

{
  "displayName": "My Demo App",
  "applicationUrl": "http://localhost:3000",
  "redirectUrl": "http://localhost:3000/auth/callback",
  "description": "Demo OIDC client"
}
```

Success response contains:

- `clientId`
- `clientSecret`
- application details

Save `clientId`, `clientSecret`, and `redirectUrl`.

## 2) End-User Creates Account

This provider exposes direct sign-up API:

```http
POST /auth/authenticate/sign-up
Content-Type: application/json

{
  "firstName": "Amit",
  "lastName": "Sharma",
  "email": "amit@example.com",
  "password": "StrongPassword123",
  "clientId": "YOUR_CLIENT_ID",
  "redirectUri": "http://localhost:3000/auth/callback"
}
```

## 3) Start Login (Authorization Request)

Redirect user to:

```text
GET /auth/authenticate?client_id=YOUR_CLIENT_ID&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback&response_type=code&scope=openid%20profile%20email&state=RANDOM_STATE
```

After successful sign-in, user is redirected to:

```text
http://localhost:3000/auth/callback?code=AUTH_CODE&state=RANDOM_STATE
```

## 4) Exchange Code for Tokens

Call token endpoint from your backend (recommended), and include cookies.

```js
const tokenResponse = await fetch("http://localhost:8000/auth/token", {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	credentials: "include",
	body: JSON.stringify({
		grant_type: "authorization_code",
		code: authCodeFromCallback,
		redirect_uri: "http://localhost:3000/auth/callback",
		client_id: process.env.OIDC_CLIENT_ID,
		client_secret: process.env.OIDC_CLIENT_SECRET,
	}),
});

const tokens = await tokenResponse.json();
```

Response:

```json
{
	"token_type": "Bearer",
	"expires_in": 3600,
	"access_token": "eyJ...",
	"id_token": "eyJ..."
}
```

Important:

- refresh token is set in `HttpOnly` cookie by auth server
- refresh token is not exposed in JSON response

## 5) Verify User Authentication

Simple check pattern in your client app:

1. if access token exists and not expired -> authenticated
2. if expired -> call refresh flow
3. if refresh fails -> force re-login

Minimal helper:

```js
async function ensureValidAccessToken(session) {
	if (session.accessToken && Date.now() < session.accessTokenExpiresAt) {
		return session.accessToken;
	}

	const refreshed = await refreshAccessToken();
	if (!refreshed) return null;

	session.accessToken = refreshed.access_token;
	session.accessTokenExpiresAt = Date.now() + refreshed.expires_in * 1000;
	return session.accessToken;
}
```

## 6) Get User Profile (`/user/userinfo`)

```js
const userInfoResponse = await fetch("http://localhost:8000/user/userinfo", {
	headers: {
		Authorization: `Bearer ${accessToken}`,
	},
});

const user = await userInfoResponse.json();
```

Example response:

```json
{
	"sub": "user-id",
	"email": "amit@example.com",
	"email_verified": false,
	"given_name": "Amit",
	"family_name": "Sharma",
	"name": "Amit Sharma",
	"picture": null
}
```

## 6.1) `jwks_uri` Use Case (Local JWT Verification)

Use `jwks_uri` when your client/backend/resource-server wants to verify JWTs locally instead of calling `/user/userinfo` for every request.

From discovery:

- `GET /.well-known/openid-configuration`
- read `jwks_uri` (usually `/.well-known/jwks.json`)

Use local verification for:

- validating `id_token` in callback flow
- validating `access_token` in your protected APIs
- reducing network round-trips to auth server

Minimal Node.js example (`jose` package):

```js
import { createRemoteJWKSet, jwtVerify } from "jose";

const issuer = "http://localhost:8000";
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

async function verifyToken(token, expectedAudience) {
	const { payload } = await jwtVerify(token, jwks, {
		issuer,
		audience: expectedAudience,
		algorithms: ["RS256"],
	});

	return payload;
}

// Example:
// const claims = await verifyToken(idTokenOrAccessToken, "YOUR_CLIENT_ID");
```

Verify these claims:

- signature is valid against current JWKS key
- `iss` equals your provider issuer
- `aud` matches your client ID (or expected API audience)
- `exp` is in the future
- `sub` is present

When to use which:

- `/user/userinfo`: easiest way to fetch canonical profile from provider
- `jwks_uri` verification: best for high-throughput API authorization and zero extra provider call

## 7) Refresh Access Token (Cookie-Based)

When access token expires, call:

```js
async function refreshAccessToken() {
	const response = await fetch("http://localhost:8000/auth/token", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify({
			grant_type: "refresh_token",
			client_id: process.env.OIDC_CLIENT_ID,
			client_secret: process.env.OIDC_CLIENT_SECRET,
		}),
	});

	if (!response.ok) return null;
	return response.json();
}
```

Server behavior:

- reads refresh token from cookie
- validates token in DB
- rotates refresh token (old revoked, new cookie issued)
- returns new `access_token` / `id_token`

## 8) Logout Endpoint

Call provider logout endpoint:

```js
await fetch("http://localhost:8000/auth/logout", {
	method: "POST",
	credentials: "include",
	headers: { "Content-Type": "application/json" },
});
```

Server behavior:

- revokes current refresh token (if present)
- clears refresh cookie

Also clear your own client app session/cookies.

## 9) Revoke Endpoint (`/oauth/revoke`)

Use revoke when disconnecting app or invalidating token explicitly.

```js
await fetch("http://localhost:8000/oauth/revoke", {
	method: "POST",
	credentials: "include",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({
		client_id: process.env.OIDC_CLIENT_ID,
		client_secret: process.env.OIDC_CLIENT_SECRET,
		token_type_hint: "refresh_token",
	}),
});
```

Notes:

- You can provide `token` in body, or rely on cookie token.
- This server currently supports revoking refresh tokens.

## End-to-End Express Client Example

This example shows practical flow in one place.

```js
import express from "express";
import session from "express-session";
import crypto from "node:crypto";

const app = express();
const issuer = "http://localhost:8000";
const clientId = process.env.OIDC_CLIENT_ID;
const clientSecret = process.env.OIDC_CLIENT_SECRET;
const redirectUri = "http://localhost:3000/auth/callback";

app.use(express.json());
app.use(
	session({
		secret: "replace-me",
		resave: false,
		saveUninitialized: false,
		cookie: { httpOnly: true, sameSite: "lax", secure: false },
	})
);

app.get("/login", (req, res) => {
	const state = crypto.randomBytes(16).toString("hex");
	req.session.oidcState = state;
	const u = new URL(`${issuer}/auth/authenticate`);
	u.searchParams.set("client_id", clientId);
	u.searchParams.set("redirect_uri", redirectUri);
	u.searchParams.set("response_type", "code");
	u.searchParams.set("scope", "openid profile email");
	u.searchParams.set("state", state);
	res.redirect(u.toString());
});

app.get("/auth/callback", async (req, res) => {
	const { code, state } = req.query;
	if (!code || state !== req.session.oidcState) {
		return res.status(400).send("Invalid callback");
	}
	delete req.session.oidcState;

	const tokenResp = await fetch(`${issuer}/auth/token`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
			client_id: clientId,
			client_secret: clientSecret,
		}),
	});
	const tokens = await tokenResp.json();
	if (!tokenResp.ok) return res.status(tokenResp.status).json(tokens);

	req.session.accessToken = tokens.access_token;
	req.session.accessTokenExpiresAt = Date.now() + tokens.expires_in * 1000;
	res.redirect("/me");
});

app.get("/me", async (req, res) => {
	let accessToken = req.session.accessToken;
	if (!accessToken || Date.now() >= req.session.accessTokenExpiresAt) {
		const refreshResp = await fetch(`${issuer}/auth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({
				grant_type: "refresh_token",
				client_id: clientId,
				client_secret: clientSecret,
			}),
		});
		if (!refreshResp.ok) return res.redirect("/login");
		const refreshed = await refreshResp.json();
		accessToken = refreshed.access_token;
		req.session.accessToken = accessToken;
		req.session.accessTokenExpiresAt = Date.now() + refreshed.expires_in * 1000;
	}

	const meResp = await fetch(`${issuer}/user/userinfo`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	const me = await meResp.json();
	if (!meResp.ok) return res.status(meResp.status).json(me);
	res.json(me);
});

app.post("/logout", async (req, res) => {
	await fetch(`${issuer}/auth/logout`, {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
	});
	req.session.destroy(() => res.status(204).end());
});

app.listen(3000, () => console.log("Client app at http://localhost:3000"));
```

## Required Security Checklist

- Keep `clientSecret` only on backend.
- Use HTTPS in production.
- Use `credentials: "include"` for cookie-based refresh.
- Validate and store `state` per login.
- Keep access token short-lived.
- Revoke + clear cookie on logout.

## Quick Endpoint Map

- Discovery: `GET /.well-known/openid-configuration`
- Authorization start: `GET /auth/authenticate`
- Client registration: `POST /auth/application/register`
- User sign-up: `POST /auth/authenticate/sign-up`
- Token endpoint: `POST /auth/token`
- User info: `GET /user/userinfo`
- Logout: `POST /auth/logout`
- Revoke: `POST /oauth/revoke`

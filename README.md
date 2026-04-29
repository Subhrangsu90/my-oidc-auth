# my-oidc-auth

Minimal OpenID Connect provider built with Express, TypeScript, PostgreSQL, and Drizzle.

This provider currently supports the OpenID Connect Authorization Code flow and issues RS256-signed JWTs.

## Full Client Integration (Step-by-step)

For complete start-to-end client onboarding (register app -> sign up -> login -> token exchange -> refresh -> userinfo -> logout -> revoke), see:

- [`CLIENT_INTEGRATION_GUIDE.md`](./CLIENT_INTEGRATION_GUIDE.md)

## Provider URL

Production issuer/discovery URL:

```text
https://autho.brewcodex.online/.well-known/openid-configuration
```

Local development URL:

```text
http://localhost:8000/.well-known/openid-configuration
```

Important endpoints:

| Purpose                | Endpoint                            |
| ---------------------- | ----------------------------------- |
| Discovery              | `/.well-known/openid-configuration` |
| Authorization          | `/auth/authenticate`                |
| Token exchange         | `/auth/token`                       |
| User profile           | `/user/userinfo`                    |
| JWKS public keys       | `/.well-known/jwks.json`            |
| Client registration UI | `/admin`                            |

Supported values:

- `response_type`: `code`
- `grant_type`: `authorization_code`, `refresh_token`
- `scope`: `openid profile email`
- signing algorithm: `RS256`
- token lifetime: `3600` seconds

## Register A Client

Open the registration UI:

```text
https://autho.brewcodex.online/admin
```

For local development:

```text
http://localhost:8000/admin
```

Create an application and save:

- `clientId`
- `clientSecret`
- redirect URI, for example `http://localhost:3000/auth/callback`

The redirect URI used during login must exactly match one of the redirect URIs registered for the application.

## Which Client Type Should I Use?

### 1. Server-side app

Use this when your app has a backend that renders pages or owns the login session.

Good examples:

- Express
- NestJS
- Django
- Laravel
- Rails
- Next.js server routes

This is the simplest and safest setup because the backend can keep `clientSecret` private.

### 2. SPA plus backend

Use this when your frontend is vanilla HTML/CSS/JS, React, Vue, Angular, or similar, and you also have a backend API.

The browser starts login, but the backend exchanges the authorization code for tokens. This keeps `clientSecret` out of browser JavaScript.

### Frontend-only SPA

A pure browser-only app is not production-safe with the current provider because `/auth/token` requires `client_secret`.

To support browser-only clients later, add public clients with PKCE and allow token exchange without a client secret for those public clients.

## OIDC Flow Summary

1. Your app redirects the user to `/auth/authenticate`.
2. The user signs in on `my-oidc-auth`.
3. `my-oidc-auth` redirects back to your registered `redirect_uri` with `code` and optional `state`.
4. Your backend sends the `code`, `client_id`, and `client_secret` to `/auth/token`.
5. Your backend receives `access_token` and `id_token`.
6. Your backend creates its own app session or calls `/user/userinfo`.

## Request Examples

### Authorization URL

```text
https://autho.brewcodex.online/auth/authenticate?client_id=YOUR_CLIENT_ID&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback&response_type=code&scope=openid%20profile%20email&state=RANDOM_STATE
```

### Token Exchange

```http
POST /auth/token
Host: autho.brewcodex.online
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "code": "AUTHORIZATION_CODE_FROM_CALLBACK",
  "redirect_uri": "http://localhost:3000/auth/callback",
  "client_id": "YOUR_CLIENT_ID",
  "client_secret": "YOUR_CLIENT_SECRET"
}
```

Successful response:

```json
{
	"token_type": "Bearer",
	"expires_in": 3600,
	"access_token": "eyJ...",
	"id_token": "eyJ...",
	"refresh_token": "rt_..."
}
```

### Refresh Token Exchange

```http
POST /auth/token
Host: autho.brewcodex.online
Content-Type: application/json

{
  "grant_type": "refresh_token",
  "refresh_token": "rt_...",
  "client_id": "YOUR_CLIENT_ID",
  "client_secret": "YOUR_CLIENT_SECRET"
}
```

### Userinfo

```http
GET /user/userinfo
Host: autho.brewcodex.online
Authorization: Bearer ACCESS_TOKEN
```

Successful response:

```json
{
	"sub": "user-id",
	"email": "user@example.com",
	"email_verified": false,
	"given_name": "Subhrangsu",
	"family_name": "Example",
	"name": "Subhrangsu Example",
	"picture": null
}
```

## Integration 1: Only Server-side App

This example uses Express as the client application.

Install dependencies in your client app:

```bash
npm install express express-session dotenv
```

Create `.env` in your client app:

```env
PORT=3000
OIDC_ISSUER=https://autho.brewcodex.online
OIDC_CLIENT_ID=YOUR_CLIENT_ID
OIDC_CLIENT_SECRET=YOUR_CLIENT_SECRET
OIDC_REDIRECT_URI=http://localhost:3000/auth/callback
SESSION_SECRET=change-this-long-random-value
```

Create `server.js`:

```js
const crypto = require("node:crypto");
const express = require("express");
const session = require("express-session");
require("dotenv").config();

const app = express();

app.use(
	session({
		secret: process.env.SESSION_SECRET,
		resave: false,
		saveUninitialized: false,
		cookie: {
			httpOnly: true,
			sameSite: "lax",
			secure: false,
		},
	})
);

const issuer = process.env.OIDC_ISSUER;
const clientId = process.env.OIDC_CLIENT_ID;
const clientSecret = process.env.OIDC_CLIENT_SECRET;
const redirectUri = process.env.OIDC_REDIRECT_URI;

app.get("/", (req, res) => {
	if (!req.session.user) {
		return res.send('<a href="/login">Sign in with my-oidc-auth</a>');
	}

	res.send(`
    <h1>Hello ${req.session.user.name || req.session.user.email}</h1>
    <pre>${JSON.stringify(req.session.user, null, 2)}</pre>
    <a href="/logout">Logout</a>
  `);
});

app.get("/login", (req, res) => {
	const state = crypto.randomBytes(16).toString("hex");
	req.session.oidcState = state;

	const url = new URL(`${issuer}/auth/authenticate`);
	url.searchParams.set("client_id", clientId);
	url.searchParams.set("redirect_uri", redirectUri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", "openid profile email");
	url.searchParams.set("state", state);

	res.redirect(url.toString());
});

app.get("/auth/callback", async (req, res, next) => {
	try {
		const { code, state } = req.query;

		if (!code) {
			return res.status(400).send("Missing authorization code");
		}

		if (!state || state !== req.session.oidcState) {
			return res.status(400).send("Invalid state");
		}

		delete req.session.oidcState;

		const tokenResponse = await fetch(`${issuer}/auth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				grant_type: "authorization_code",
				code,
				redirect_uri: redirectUri,
				client_id: clientId,
				client_secret: clientSecret,
			}),
		});

		const tokens = await tokenResponse.json();

		if (!tokenResponse.ok) {
			return res.status(tokenResponse.status).json(tokens);
		}

		const userInfoResponse = await fetch(`${issuer}/user/userinfo`, {
			headers: {
				Authorization: `Bearer ${tokens.access_token}`,
			},
		});

		const user = await userInfoResponse.json();

		if (!userInfoResponse.ok) {
			return res.status(userInfoResponse.status).json(user);
		}

		req.session.user = user;
		req.session.tokens = tokens;

		res.redirect("/");
	} catch (error) {
		next(error);
	}
});

app.get("/logout", (req, res) => {
	req.session.destroy(() => {
		res.redirect("/");
	});
});

app.listen(process.env.PORT || 3000, () => {
	console.log(`Client app running on http://localhost:${process.env.PORT || 3000}`);
});
```

Run it:

```bash
node server.js
```

Open:

```text
http://localhost:3000
```

## Integration 2: SPA With Vanilla HTML/CSS/JS Plus Backend

In this setup:

- vanilla frontend calls your backend
- backend redirects to `my-oidc-auth`
- backend exchanges the code for tokens
- backend stores a secure session
- frontend checks `/api/me` to know whether the user is signed in

Install dependencies in your backend:

```bash
npm install express express-session dotenv
```

Create `.env`:

```env
PORT=3000
OIDC_ISSUER=https://autho.brewcodex.online
OIDC_CLIENT_ID=YOUR_CLIENT_ID
OIDC_CLIENT_SECRET=YOUR_CLIENT_SECRET
OIDC_REDIRECT_URI=http://localhost:3000/auth/callback
SESSION_SECRET=change-this-long-random-value
```

Create this structure:

```text
client-app/
  server.js
  public/
    index.html
    styles.css
    app.js
```

Create `server.js`:

```js
const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const session = require("express-session");
require("dotenv").config();

const app = express();

app.use(
	session({
		secret: process.env.SESSION_SECRET,
		resave: false,
		saveUninitialized: false,
		cookie: {
			httpOnly: true,
			sameSite: "lax",
			secure: false,
		},
	})
);

app.use(express.static(path.join(__dirname, "public")));

const issuer = process.env.OIDC_ISSUER;
const clientId = process.env.OIDC_CLIENT_ID;
const clientSecret = process.env.OIDC_CLIENT_SECRET;
const redirectUri = process.env.OIDC_REDIRECT_URI;

app.get("/auth/login", (req, res) => {
	const state = crypto.randomBytes(16).toString("hex");
	req.session.oidcState = state;

	const url = new URL(`${issuer}/auth/authenticate`);
	url.searchParams.set("client_id", clientId);
	url.searchParams.set("redirect_uri", redirectUri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", "openid profile email");
	url.searchParams.set("state", state);

	res.redirect(url.toString());
});

app.get("/auth/callback", async (req, res, next) => {
	try {
		const { code, state } = req.query;

		if (!code) {
			return res.status(400).send("Missing authorization code");
		}

		if (!state || state !== req.session.oidcState) {
			return res.status(400).send("Invalid state");
		}

		delete req.session.oidcState;

		const tokenResponse = await fetch(`${issuer}/auth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				grant_type: "authorization_code",
				code,
				redirect_uri: redirectUri,
				client_id: clientId,
				client_secret: clientSecret,
			}),
		});

		const tokens = await tokenResponse.json();

		if (!tokenResponse.ok) {
			return res.status(tokenResponse.status).json(tokens);
		}

		const userInfoResponse = await fetch(`${issuer}/user/userinfo`, {
			headers: {
				Authorization: `Bearer ${tokens.access_token}`,
			},
		});

		const user = await userInfoResponse.json();

		if (!userInfoResponse.ok) {
			return res.status(userInfoResponse.status).json(user);
		}

		req.session.user = user;
		req.session.tokens = tokens;

		res.redirect("/");
	} catch (error) {
		next(error);
	}
});

app.get("/api/me", (req, res) => {
	if (!req.session.user) {
		return res.status(401).json({ authenticated: false });
	}

	res.json({
		authenticated: true,
		user: req.session.user,
	});
});

app.post("/auth/logout", (req, res) => {
	req.session.destroy(() => {
		res.status(204).end();
	});
});

app.listen(process.env.PORT || 3000, () => {
	console.log(`SPA backend running on http://localhost:${process.env.PORT || 3000}`);
});
```

Create `public/index.html`:

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>OIDC SPA Client</title>
		<link rel="stylesheet" href="/styles.css" />
	</head>
	<body>
		<main class="shell">
			<section class="panel">
				<h1>OIDC SPA Client</h1>
				<p id="status">Checking session...</p>

				<div class="actions">
					<a id="login" class="button" href="/auth/login">Sign in</a>
					<button id="logout" class="button secondary" type="button" hidden>Logout</button>
				</div>

				<pre id="profile" hidden></pre>
			</section>
		</main>

		<script src="/app.js"></script>
	</body>
</html>
```

Create `public/styles.css`:

```css
* {
	box-sizing: border-box;
}

body {
	margin: 0;
	font-family: Arial, sans-serif;
	color: #1f2937;
	background: #f4f7fb;
}

.shell {
	min-height: 100vh;
	display: grid;
	place-items: center;
	padding: 24px;
}

.panel {
	width: min(100%, 560px);
	background: #ffffff;
	border: 1px solid #d7dde8;
	border-radius: 8px;
	padding: 24px;
}

.actions {
	display: flex;
	gap: 12px;
	margin: 20px 0;
}

.button {
	border: 0;
	border-radius: 6px;
	padding: 10px 14px;
	background: #2563eb;
	color: #ffffff;
	font: inherit;
	text-decoration: none;
	cursor: pointer;
}

.button.secondary {
	background: #475569;
}

pre {
	overflow: auto;
	padding: 16px;
	border-radius: 6px;
	background: #0f172a;
	color: #e2e8f0;
}
```

Create `public/app.js`:

```js
const statusEl = document.querySelector("#status");
const profileEl = document.querySelector("#profile");
const loginEl = document.querySelector("#login");
const logoutEl = document.querySelector("#logout");

async function loadSession() {
	const response = await fetch("/api/me");

	if (response.status === 401) {
		statusEl.textContent = "You are not signed in.";
		loginEl.hidden = false;
		logoutEl.hidden = true;
		profileEl.hidden = true;
		return;
	}

	const data = await response.json();

	statusEl.textContent = `Signed in as ${data.user.email}`;
	loginEl.hidden = true;
	logoutEl.hidden = false;
	profileEl.hidden = false;
	profileEl.textContent = JSON.stringify(data.user, null, 2);
}

logoutEl.addEventListener("click", async () => {
	await fetch("/auth/logout", { method: "POST" });
	await loadSession();
});

loadSession().catch(() => {
	statusEl.textContent = "Unable to load session.";
});
```

Run it:

```bash
node server.js
```

Open:

```text
http://localhost:3000
```

## Token Validation

If your client validates `id_token` directly, load the provider JWKS:

```text
https://autho.brewcodex.online/.well-known/jwks.json
```

Validate:

- signature algorithm is `RS256`
- token is not expired
- `iss` matches your provider issuer
- `sub` is present

Many server apps can use `/user/userinfo` first and add full JWT validation later.

## Common Errors

`Invalid redirect_uri.`

The callback URL in your request does not exactly match the registered redirect URI.

`response_type=code is required.`

Send `response_type=code` in the authorization URL.

`Invalid client credentials.`

The `client_id` or `client_secret` sent to `/auth/token` is wrong.

`Invalid, expired, or already used authorization code.`

Authorization codes expire after 5 minutes and can be used only once.

`Missing or invalid Authorization header.`

Call `/user/userinfo` with:

```http
Authorization: Bearer ACCESS_TOKEN
```

## Production Notes

- Never put `clientSecret` in browser JavaScript.
- Use HTTPS for production redirect URIs.
- Use secure, HTTP-only cookies for your app session.
- Generate and verify a random `state` value for every login.
- Store tokens on the backend when possible.
- Rotate `SESSION_SECRET` and client secrets if they are exposed.

## Local Test Client

See [`../oidc-test-client`](../oidc-test-client/README.md) for a backend client that demonstrates the supported authorization-code pattern.

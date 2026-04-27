# Auth Server Layer Guide

Use this guide when you want any website or app to use `my-oidc-auth` as the authentication system, while each client app keeps its own database, own APIs, and own business logic.

The main idea:

```text
User Browser
  -> Your Website / SPA
  -> Your Backend Auth Layer
  -> my-oidc-auth
```

`my-oidc-auth` owns identity:

- sign in
- sign up
- password check
- OIDC authorization code
- access token
- ID token
- user profile from `/user/userinfo`

Your client app owns product data:

- posts
- orders
- courses
- payments
- dashboards
- app-specific roles
- app-specific database records

The client app should never store the OIDC password and should never expose `clientSecret` in browser JavaScript.

## Recommended Architecture

Each website should have a small backend layer. This backend layer is the only place that talks to the OIDC token endpoint.

```text
Browser
  |
  | GET /auth/login
  v
Client Backend
  |
  | Redirect to /auth/authorize
  v
my-oidc-auth
  |
  | Redirect back with ?code=...
  v
Client Backend
  |
  | POST /auth/token with client_secret
  | GET /user/userinfo with access_token
  v
Client Backend Session
  |
  | Set app session cookie
  v
Browser
```

After login, the browser calls your own backend APIs:

```text
Browser -> GET /api/me
Browser -> GET /api/orders
Browser -> POST /api/posts
Browser -> GET /api/dashboard
```

Those APIs use the local app session. They do not ask the user to log in again.

## What Gets Stored Where?

### In `my-oidc-auth`

Store identity data:

```text
sub
email
email_verified
given_name
family_name
name
picture
password hash
```

### In Your Client App Database

Store app-specific data:

```text
id
oidc_sub
email
display_name
role
created_at
updated_at
```

Example app table:

```sql
CREATE TABLE app_users (
  id SERIAL PRIMARY KEY,
  oidc_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Use `oidc_sub` as the stable link between your app user and the OIDC user.

Do not use email as the primary identity key because email can change later. Use `sub`.

## Client App Environment

Every client app needs its own registered OIDC application.

```env
PORT=3000
APP_BASE_URL=http://localhost:3000

OIDC_ISSUER=https://autho.brewcodex.online
OIDC_CLIENT_ID=YOUR_CLIENT_ID
OIDC_CLIENT_SECRET=YOUR_CLIENT_SECRET
OIDC_REDIRECT_URI=http://localhost:3000/auth/callback

SESSION_SECRET=change-this-long-random-secret
```

Register this redirect URI in `my-oidc-auth`:

```text
http://localhost:3000/auth/callback
```

For production, use HTTPS:

```text
https://yourwebsite.com/auth/callback
```

## Reusable Express Auth Layer

Install:

```bash
npm install express express-session dotenv
```

Create `auth-layer.js`:

```js
const crypto = require("node:crypto");

function createAuthLayer(config, userStore) {
	function requireAuth(req, res, next) {
		if (!req.session.user) {
			return res.status(401).json({
				authenticated: false,
				message: "Login required",
			});
		}

		next();
	}

	function getCurrentUser(req) {
		return req.session.user || null;
	}

	function login(req, res) {
		const state = crypto.randomBytes(16).toString("hex");
		req.session.oidcState = state;

		const url = new URL(`${config.issuer}/auth/authorize`);
		url.searchParams.set("client_id", config.clientId);
		url.searchParams.set("redirect_uri", config.redirectUri);
		url.searchParams.set("response_type", "code");
		url.searchParams.set("scope", "openid profile email");
		url.searchParams.set("state", state);

		res.redirect(url.toString());
	}

	async function callback(req, res, next) {
		try {
			const { code, state } = req.query;

			if (!code) {
				return res.status(400).send("Missing authorization code");
			}

			if (!state || state !== req.session.oidcState) {
				return res.status(400).send("Invalid state");
			}

			delete req.session.oidcState;

			const tokenResponse = await fetch(`${config.issuer}/auth/token`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					grant_type: "authorization_code",
					code,
					redirect_uri: config.redirectUri,
					client_id: config.clientId,
					client_secret: config.clientSecret,
				}),
			});

			const tokens = await tokenResponse.json();

			if (!tokenResponse.ok) {
				return res.status(tokenResponse.status).json(tokens);
			}

			const userInfoResponse = await fetch(`${config.issuer}/user/userinfo`, {
				headers: {
					Authorization: `Bearer ${tokens.access_token}`,
				},
			});

			const oidcUser = await userInfoResponse.json();

			if (!userInfoResponse.ok) {
				return res.status(userInfoResponse.status).json(oidcUser);
			}

			const appUser = await userStore.findOrCreateFromOidc(oidcUser);

			req.session.user = {
				id: appUser.id,
				oidcSub: oidcUser.sub,
				email: oidcUser.email,
				name: oidcUser.name,
				role: appUser.role,
			};

			req.session.tokens = {
				accessToken: tokens.access_token,
				idToken: tokens.id_token,
				expiresIn: tokens.expires_in,
			};

			res.redirect(config.afterLoginPath || "/");
		} catch (error) {
			next(error);
		}
	}

	function me(req, res) {
		if (!req.session.user) {
			return res.status(401).json({
				authenticated: false,
			});
		}

		res.json({
			authenticated: true,
			user: req.session.user,
		});
	}

	function logout(req, res) {
		req.session.destroy(() => {
			res.status(204).end();
		});
	}

	return {
		callback,
		getCurrentUser,
		login,
		logout,
		me,
		requireAuth,
	};
}

module.exports = {
	createAuthLayer,
};
```

## Example Client Backend

Create `server.js`:

```js
const crypto = require("node:crypto");
const express = require("express");
const session = require("express-session");
require("dotenv").config();

const { createAuthLayer } = require("./auth-layer");

const app = express();

app.use(express.json());

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

const users = new Map();

const userStore = {
	async findOrCreateFromOidc(oidcUser) {
		const existingUser = users.get(oidcUser.sub);

		if (existingUser) {
			existingUser.email = oidcUser.email;
			existingUser.displayName = oidcUser.name;
			return existingUser;
		}

		const newUser = {
			id: crypto.randomUUID(),
			oidcSub: oidcUser.sub,
			email: oidcUser.email,
			displayName: oidcUser.name,
			role: "user",
		};

		users.set(oidcUser.sub, newUser);
		return newUser;
	},
};

const auth = createAuthLayer(
	{
		issuer: process.env.OIDC_ISSUER,
		clientId: process.env.OIDC_CLIENT_ID,
		clientSecret: process.env.OIDC_CLIENT_SECRET,
		redirectUri: process.env.OIDC_REDIRECT_URI,
		afterLoginPath: "/",
	},
	userStore
);

app.get("/auth/login", auth.login);
app.get("/auth/callback", auth.callback);
app.get("/api/me", auth.me);
app.post("/auth/logout", auth.logout);

app.get("/api/products", auth.requireAuth, (req, res) => {
	res.json({
		user: req.session.user,
		products: [
			{ id: 1, name: "Starter Plan" },
			{ id: 2, name: "Pro Plan" },
		],
	});
});

app.post("/api/orders", auth.requireAuth, (req, res) => {
	const order = {
		id: crypto.randomUUID(),
		userId: req.session.user.id,
		oidcSub: req.session.user.oidcSub,
		items: req.body.items || [],
	};

	res.status(201).json(order);
});

app.listen(process.env.PORT || 3000, () => {
	console.log(`Client app running on http://localhost:${process.env.PORT || 3000}`);
});
```

In a real app, replace the `Map` with PostgreSQL, MongoDB, MySQL, Prisma, Drizzle, Mongoose, or any database you use.

## Example With Real Database Logic

Your `findOrCreateFromOidc` function should do this:

```js
async function findOrCreateFromOidc(oidcUser) {
	let appUser = await db.users.findFirst({
		where: {
			oidcSub: oidcUser.sub,
		},
	});

	if (!appUser) {
		appUser = await db.users.create({
			data: {
				oidcSub: oidcUser.sub,
				email: oidcUser.email,
				displayName: oidcUser.name,
				role: "user",
			},
		});
	}

	if (appUser.email !== oidcUser.email || appUser.displayName !== oidcUser.name) {
		appUser = await db.users.update({
			where: {
				id: appUser.id,
			},
			data: {
				email: oidcUser.email,
				displayName: oidcUser.name,
			},
		});
	}

	return appUser;
}
```

The exact database syntax depends on your ORM, but the rule is always the same:

1. Find local app user by `oidcUser.sub`.
2. Create local app user if missing.
3. Update basic profile fields if they changed.
4. Use the local app user ID for your app tables.

## Vanilla Frontend Example

The frontend does not call `my-oidc-auth` directly for tokens. It calls your own backend.

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Website Using my-oidc-auth</title>
	</head>
	<body>
		<h1>Website</h1>
		<p id="status">Checking auth...</p>

		<a id="login" href="/auth/login" hidden>Login</a>
		<button id="logout" type="button" hidden>Logout</button>
		<button id="load-products" type="button" hidden>Load products</button>

		<pre id="output"></pre>

		<script>
			const statusEl = document.querySelector("#status");
			const loginEl = document.querySelector("#login");
			const logoutEl = document.querySelector("#logout");
			const loadProductsEl = document.querySelector("#load-products");
			const outputEl = document.querySelector("#output");

			async function loadMe() {
				const response = await fetch("/api/me");

				if (response.status === 401) {
					statusEl.textContent = "Not logged in";
					loginEl.hidden = false;
					logoutEl.hidden = true;
					loadProductsEl.hidden = true;
					return;
				}

				const data = await response.json();
				statusEl.textContent = `Logged in as ${data.user.email}`;
				outputEl.textContent = JSON.stringify(data.user, null, 2);
				loginEl.hidden = true;
				logoutEl.hidden = false;
				loadProductsEl.hidden = false;
			}

			logoutEl.addEventListener("click", async () => {
				await fetch("/auth/logout", { method: "POST" });
				outputEl.textContent = "";
				await loadMe();
			});

			loadProductsEl.addEventListener("click", async () => {
				const response = await fetch("/api/products");
				const data = await response.json();
				outputEl.textContent = JSON.stringify(data, null, 2);
			});

			loadMe();
		</script>
	</body>
</html>
```

## API Protection Pattern

Use `auth.requireAuth` on routes that need a logged-in user:

```js
app.get("/api/profile", auth.requireAuth, (req, res) => {
	res.json({
		user: req.session.user,
	});
});

app.get("/api/my-orders", auth.requireAuth, async (req, res) => {
	const orders = await db.orders.findMany({
		where: {
			userId: req.session.user.id,
		},
	});

	res.json({ orders });
});
```

Use roles for authorization:

```js
function requireRole(role) {
	return (req, res, next) => {
		if (!req.session.user) {
			return res.status(401).json({ message: "Login required" });
		}

		if (req.session.user.role !== role) {
			return res.status(403).json({ message: "Forbidden" });
		}

		next();
	};
}

app.get("/api/admin/users", requireRole("admin"), async (req, res) => {
	const users = await db.users.findMany();
	res.json({ users });
});
```

## How Any Website Can Use This Auth System

For each new website:

1. Register a new application in `my-oidc-auth`.
2. Add the website callback URL as a redirect URI.
3. Store `clientId` and `clientSecret` in the website backend `.env`.
4. Add `/auth/login`, `/auth/callback`, `/auth/logout`, and `/api/me`.
5. Use `auth.requireAuth` to protect the website APIs.
6. Create or update a local app user from `/user/userinfo`.
7. Store website-specific data in the website database using local `user.id`.

The same OIDC user can log in to many websites:

```text
my-oidc-auth user
  sub = user_123

Website A database
  app_user.id = 1
  app_user.oidc_sub = user_123

Website B database
  app_user.id = 50
  app_user.oidc_sub = user_123

Website C database
  app_user.id = 900
  app_user.oidc_sub = user_123
```

Each website can have different app roles and data, but the login identity is shared.

## Important Rules

- Keep `clientSecret` only on the backend.
- Do not call `/auth/token` from browser JavaScript.
- Use `state` to protect the callback.
- Use HTTPS in production.
- Use HTTP-only session cookies.
- Use `oidcUser.sub` to link users.
- Use your own database for app-specific user data.
- Use your own API authorization rules after login.

## Endpoint Contract

Your client backend talks to these `my-oidc-auth` endpoints:

```text
GET  https://autho.brewcodex.online/auth/authorize
POST https://autho.brewcodex.online/auth/token
GET  https://autho.brewcodex.online/user/userinfo
GET  https://autho.brewcodex.online/auth/jwks.json
```

Your website frontend talks only to your website backend:

```text
GET  /auth/login
GET  /api/me
POST /auth/logout
GET  /api/*
POST /api/*
PUT  /api/*
DELETE /api/*
```

This makes the auth system reusable for any website, while keeping every website free to design its own database and APIs.

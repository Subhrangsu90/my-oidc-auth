# my-oidc-auth

Minimal OpenID Connect provider built with Express, TypeScript, PostgreSQL, and Drizzle.

This project currently supports the Authorization Code flow and issues RS256-signed tokens.

## What Client Types Can Use This?

`my-oidc-auth` works best with clients that have a backend.

### 1. Server-side web app

Recommended and fully supported.

Examples:

- Express app
- NestJS app
- Next.js app using server routes
- Any backend-rendered application

Why it fits:

- the server can safely store `client_secret`
- the backend can exchange the authorization `code` for tokens
- tokens can stay on the server or inside an HTTP-only session

### 2. Frontend + backend

Recommended and fully supported.

Examples:

- React or Angular frontend with Node/Java/Spring/.NET backend
- SPA frontend with a BFF layer

Why it fits:

- the frontend only starts login and receives the redirect
- your backend handles `/token` exchange
- `client_secret` is never exposed to the browser

### 3. Frontend-only app

Not recommended for production with the current implementation.

Reason:

- `/auth/token` currently requires `client_id` and `client_secret`
- a browser-only app cannot keep `client_secret` private

So today, a pure SPA/mobile-web frontend should not call the token endpoint directly in production.

If you want true frontend-only support later, this provider should be extended to support public clients with PKCE and no client secret requirement for those clients.

## Current Support Matrix

- Server-side only: supported
- Frontend + backend: supported
- Frontend-only SPA: not production-safe yet

## Provider Endpoints

Base URL example:

```text
http://localhost:8000
```

Important endpoints:

- Discovery: `/.well-known/openid-configuration`
- Authorize: `/auth/authorize`
- Token: `/auth/token`
- Userinfo: `/user/userinfo`
- JWKS: `/auth/jwks.json`
- App registration UI: `/admin`

## Register A Client

Open:

```text
http://localhost:8000/admin
```

Create an application and keep:

- `clientId`
- `clientSecret`
- allowed redirect URL

## How To Use From A Server-side App

This is the simplest and safest integration.

### Flow

1. Redirect the user to `/auth/authorize`
2. User signs in on `my-oidc-auth`
3. Provider redirects back to your backend callback with `code`
4. Your backend calls `/auth/token`
5. Your backend stores tokens in session or secure server storage
6. Your backend may call `/user/userinfo`

### Authorize request

```text
GET /auth/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=YOUR_REDIRECT_URI&response_type=code&scope=openid%20profile%20email&state=YOUR_STATE
```

### Token exchange

```http
POST /auth/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "code": "AUTH_CODE",
  "redirect_uri": "YOUR_REDIRECT_URI",
  "client_id": "YOUR_CLIENT_ID",
  "client_secret": "YOUR_CLIENT_SECRET"
}
```

### Userinfo request

```http
GET /user/userinfo
Authorization: Bearer ACCESS_TOKEN
```

## How To Use From A Frontend + Backend App

This is the best choice for Angular, React, Vue, or any SPA with an API server.

### Recommended split

- Frontend:
  starts login, handles UI, sends user to your backend or receives the redirect first
- Backend:
  stores `client_secret`, exchanges code for tokens, creates your app session

### Recommended flow

1. Frontend sends the user to your backend login route
2. Backend redirects to `my-oidc-auth` authorize endpoint
3. Provider redirects back to your backend callback
4. Backend exchanges code at `/auth/token`
5. Backend creates its own session cookie for the frontend
6. Frontend calls your backend as an authenticated user

This keeps OIDC tokens and the client secret out of browser JavaScript.

## Can A Frontend Call The Provider Directly?

Yes for the browser redirect to `/auth/authorize`.

No for a secure production token exchange, because the frontend would need to send `client_secret`.

That means the browser can start login, but token exchange should happen on a backend you control.

## Example Architecture Choices

### Option A: Only server-side app

Use when your app renders pages on the server.

```text
Browser -> Your Server -> my-oidc-auth
```

### Option B: SPA + backend

Use when your UI is Angular/React/Vue but you also have an API or BFF.

```text
Browser SPA -> Your Backend -> my-oidc-auth
```

### Option C: SPA only

Use only for local testing if you knowingly accept exposing secrets. Not suitable for production with the current provider design.

```text
Browser SPA -> my-oidc-auth
```

## Local Test Client In This Repo

See [`oidc-test-client`](../oidc-test-client/README.md). It demonstrates the supported pattern where a backend client:

- redirects users to the authorize endpoint
- exchanges the code on the server
- stores its own local session

## Important Notes

- only `response_type=code` is supported
- only `grant_type=authorization_code` is supported
- scopes currently advertised: `openid profile email`
- tokens are signed with `RS256`
- `client_secret` is required by the token endpoint

## Future Improvement For Frontend-only Clients

To properly support frontend-only clients, add:

- public client registration
- PKCE verification
- token endpoint rules that do not require `client_secret` for public clients
- stricter client-type validation per application

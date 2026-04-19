import express from "express";
import type { Router } from "express";
import jose from "node-jose";
import { PRIVATE_KEY, PUBLIC_KEY } from "../utils/cert";
import path from "node:path";
import { db } from "../../db";
import { usersTable } from "../../db/schema";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { JWTClaims } from "../utils/user-token";
import JWT from "jsonwebtoken";

export const oidcRoute: Router = express.Router();

// OpenID Connect Discovery Endpoint
// 1. OpenID Connect Discovery Endpoint: This endpoint provides metadata about the OpenID Connect provider, including the issuer URL, authorization endpoint, token endpoint, userinfo endpoint, and JWKS URI. This allows clients to dynamically discover the necessary endpoints for authentication and token management.
oidcRoute.get("/.well-known/openid-configuration", (req, res) => {
	const ISSUER = `http://localhost:${process.env.PORT ?? 8000}`;

	return res.json({
		issuer: ISSUER,
		authorization_endpoint: `${ISSUER}/o/auth/authorize`,
		token_endpoint: `${ISSUER}/o/auth/token`,
		userinfo_endpoint: `${ISSUER}/o/user/userinfo`,
		jwks_uri: `${ISSUER}/o/auth/jwks.json`,
	});
});

// 2. JWKS Endpoint: This endpoint serves the JSON Web Key Set (JWKS) containing the public keys used to verify the signatures of JSON Web Tokens (JWTs) issued by the OpenID Connect provider. Clients can retrieve the JWKS to validate the authenticity of tokens received from the provider.
oidcRoute.get("/auth/jwks.json", async (req, res) => {
	const JWKS = await jose.JWK.asKey(PUBLIC_KEY, "pem");

	return res.json({
		keys: [JWKS.toJSON()],
	});
});

// 3. Authorization Endpoint: This endpoint is responsible for handling authentication requests from clients. It typically supports various authentication flows, such as the Authorization Code Flow, Implicit Flow, and Hybrid Flow. Clients redirect users to this endpoint to initiate the authentication process and obtain authorization codes or tokens.
oidcRoute.get("/auth/authorize", (req, res) => {
	return res.sendFile(path.resolve("public", "authorize.html"));
});

oidcRoute.post("/auth/authorize/sign-in", async (req, res) => {
	// Get email, password from user
	const { firstName, lastName, email, password } = req.body;

	// If email or password any one not get
	if (!firstName || !email || !password) {
		res.status(400).json({
			message: "First Name, Email and password are required.",
		});
		return;
	}

	//
	const [user] = await db
		.select()
		.from(usersTable)
		.where(eq(usersTable.email, email))
		.limit(1);

	if (!user || !user.password || !user.salt) {
		res.status(401).json({
			message: "Invalid email or password.",
		});
	}

	const hash = crypto
		.createHash("sha256")
		.update(password + user.salt)
		.digest("hex");

	if (hash !== user.password) {
		res.status(401).json({ message: "Invalid email or password." });
		return;
	}

	const ISSUER = `http://localhost:${process.env.PORT ?? 8000}`;
	const now = Math.floor(Date.now() / 1000);

	const claims: JWTClaims = {
		iss: ISSUER,
		sub: user.id,
		email: user.email,
		email_verified: String(user.emailVerified),
		exp: now + 3600,
		given_name: user.firstName ?? "",
		family_name: user.lastName ?? undefined,
		name: [user.firstName, user.lastName].filter(Boolean).join(" "),
		picture: user.profileImageURL ?? undefined,
	};

	const token = JWT.sign(claims, PRIVATE_KEY, {
		algorithm: "RS256",
	});

	res.json({ token });
});

// 4. Token Endpoint: This endpoint is used by clients to exchange authorization codes for access tokens, refresh tokens, or ID tokens. It handles token requests and issues the appropriate tokens based on the authentication flow being used.

// 5. Userinfo Endpoint: This endpoint allows clients to retrieve user profile information using an access token. Clients can make authenticated requests to this endpoint to obtain user attributes and claims associated with the authenticated user.

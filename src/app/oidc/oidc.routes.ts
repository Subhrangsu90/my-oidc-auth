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

/* **
 OpenID Connect Discovery Endpoint
 1. OpenID Connect Discovery Endpoint: This endpoint provides metadata about the OpenID Connect provider, 
 including the issuer URL, authorization endpoint, token endpoint, userinfo endpoint, and JWKS URI. 
 This allows clients to dynamically discover the necessary endpoints for authentication and token management.
 * **/
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

/* **
2. JWKS Endpoint: This endpoint serves the JSON Web Key Set (JWKS) containing the public keys used
to verify the signatures of JSON Web Tokens (JWTs) issued by the OpenID Connect provider.
Clients can retrieve the JWKS to validate the authenticity of tokens received from the provider.
* **/
oidcRoute.get("/auth/jwks.json", async (req, res) => {
	const JWKS = await jose.JWK.asKey(PUBLIC_KEY, "pem");

	return res.json({
		keys: [JWKS.toJSON()],
	});
});

/* **
 3. Authorization Endpoint: This endpoint is responsible for handling authentication
 requests from clients. It typically supports various authentication flows,
 such as the Authorization Code Flow, Implicit Flow, and Hybrid Flow.
 Clients redirect users to this endpoint to initiate the authentication process and obtain authorization codes or tokens.
** */
oidcRoute.get("/auth/authorize", (req, res) => {
	return res.sendFile(path.resolve("public", "authorize.html"));
});

oidcRoute.post("/auth/authorize/sign-in", async (req, res) => {
	try {
		// Extract email and password from request body
		const { email, password } = req.body;

		// Validate required credentials are provided
		if (!email || !password) {
			res.status(400).json({
				message: " Email and password are required.",
			});
			return;
		}

		// Query database for user by email (limit to 1 result)
		const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);

		// Reject if user not found or missing authentication fields
		if (!user || !user.password || !user.salt) {
			res.status(401).json({
				message: "Invalid email or password.",
			});
			return;
		}

		// Generate SHA-256 hash of password combined with stored salt
		const hash = crypto
			.createHash("sha256")
			.update(password + user.salt)
			.digest("hex");

		// Compare computed hash with stored password hash
		if (hash !== user.password) {
			res.status(401).json({ message: "Invalid email or password." });
			return;
		}

		const ISSUER = `http://localhost:${process.env.PORT ?? 8000}`;
		const now = Math.floor(Date.now() / 1000);

		// Construct JWT claims payload with user identity data
		const claims: JWTClaims = {
			iss: ISSUER,
			sub: user.id,
			email: user.email,
			email_verified: Boolean(user.emailVerified),
			exp: now + 3600,
			given_name: user.firstName ?? "",
			family_name: user.lastName ?? undefined,
			name: [user.firstName, user.lastName].filter(Boolean).join(" "),
			picture: user.profileImageURL ?? undefined,
		};

		// Sign JWT using private key with RS256 algorithm
		const token = JWT.sign(claims, PRIVATE_KEY, {
			algorithm: "RS256",
		});

		// Send generated token as response
		res.json({ token });
	} catch (error) {
		res.status(500).json({
			message: "Unable to sign in right now. Please try again later.",
		});
	}
});

oidcRoute.post("/auth/authorize/sign-up", async (req, res) => {
	try {
		// Extract user data from request body
		const { firstName, lastName, email, password } = req.body;

		// Validate that required data are provided
		if (!firstName || !email || !password) {
			res.status(400).json({
				message: "First name, email, password is required",
			});
		}

		// Query database for user by email, check existing or not
		const [exising] = await db
			.select({ id: usersTable.id })
			.from(usersTable)
			.where(eq(usersTable.email, email))
			.limit(1);

		// If exist then send error of duplication
		if (exising) {
			res.status(409).json({
				message: "An account with this email already exists.",
			});
			return;
		}

		// If user not exist then
		// hashed password with salt
		const salt = crypto.randomBytes(16).toString("hex");
		const hash = crypto
			.createHash("sha256")
			.update(password + salt)
			.digest("hex");

		// Insert user validate data to db
		await db.insert(usersTable).values({
			firstName,
			lastName: lastName ?? null,
			email,
			password: hash,
			salt,
		});

		// send reponse
		res.status(200).json({
			ok: true,
			message: "Account create Successfully!",
		});
	} catch (err) {
		res.status(500).json({
			message: "Unable to create account right now. Please try again later!",
		});
	}
});

// 4. Token Endpoint: This endpoint is used by clients to exchange authorization codes for access tokens, refresh tokens, or ID tokens. It handles token requests and issues the appropriate tokens based on the authentication flow being used.

// 5. Userinfo Endpoint: This endpoint allows clients to retrieve user profile information using an access token. Clients can make authenticated requests to this endpoint to obtain user attributes and claims associated with the authenticated user.
oidcRoute.get("/user/userinfo", async (req, res) => {
	const authHeader = req.headers.authorization;

	// check at header authorization token have or not

	// remove "Berrar " fron authheader

	//
});

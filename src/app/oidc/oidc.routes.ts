import express from "express";
import type { Router } from "express";
import jose from "node-jose";
import { PRIVATE_KEY, PUBLIC_KEY } from "../utils/cert";
import path from "node:path";
import { db } from "../../db";
import { applicationsTable, authorizationCodesTable, usersTable } from "../../db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import crypto from "node:crypto";
import { JWTClaims } from "../utils/user-token";
import JWT from "jsonwebtoken";

export const oidcRoute: Router = express.Router();

function createRandomToken(bytes = 32) {
	return crypto.randomBytes(bytes).toString("base64url");
}

function getIssuer(req?: express.Request) {
	if (req) {
		return `${req.protocol}://${req.get("host")}`;
	}

	return `http://localhost:${process.env.PORT ?? 8000}`;
}

function splitRedirectURIs(redirectURIs: string) {
	return redirectURIs
		.split(/[\n,]/)
		.map((uri) => uri.trim())
		.filter(Boolean);
}

function createUserJWT(user: typeof usersTable.$inferSelect) {
	const ISSUER = `http://localhost:${process.env.PORT ?? 8000}`;
	const now = Math.floor(Date.now() / 1000);

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

	return JWT.sign(claims, PRIVATE_KEY, {
		algorithm: "RS256",
	});
}

function logRouteError(context: string, error: unknown) {
	console.error(context, error instanceof Error ? error.stack : error);
}

async function findApplicationByClientId(clientId: string) {
	const [application] = await db
		.select()
		.from(applicationsTable)
		.where(eq(applicationsTable.clientId, clientId))
		.limit(1);

	return application;
}

function isAllowedRedirectURI(
	application: typeof applicationsTable.$inferSelect,
	redirectURI: string
) {
	return splitRedirectURIs(application.redirectURIs).includes(redirectURI);
}

async function resolveAuthorizationApplication(clientId: unknown, redirectUri: unknown) {
	if (typeof clientId !== "string" || !clientId) {
		return {
			error: "client_id is required.",
		} as const;
	}

	if (typeof redirectUri !== "string" || !redirectUri) {
		return {
			error: "redirect_uri is required.",
		} as const;
	}

	const application = await findApplicationByClientId(clientId);

	if (!application) {
		return {
			error: "Invalid client_id.",
		} as const;
	}

	if (!isAllowedRedirectURI(application, redirectUri)) {
		return {
			error: "Invalid redirect_uri.",
		} as const;
	}

	return {
		application,
		redirectUri,
	} as const;
}

function redirectToErrorPage(
	res: express.Response,
	message: string,
	statusCode = 400,
	title = "Authorization Error"
) {
	const errorPageUrl = new URL("/o/error", "http://localhost:8000");
	errorPageUrl.searchParams.set("title", title);
	errorPageUrl.searchParams.set("message", message);
	errorPageUrl.searchParams.set("status", String(statusCode));

	return res.redirect(errorPageUrl.pathname + errorPageUrl.search);
}

function getDiscoveryMetadata(req: express.Request) {
	const ISSUER = getIssuer(req);

	return {
		issuer: ISSUER,
		authorization_endpoint: `${ISSUER}/o/auth/authorize`,
		token_endpoint: `${ISSUER}/o/auth/token`,
		userinfo_endpoint: `${ISSUER}/o/user/userinfo`,
		jwks_uri: `${ISSUER}/o/auth/jwks.json`,
		response_types_supported: ["code"],
		grant_types_supported: ["authorization_code"],
		subject_types_supported: ["public"],
		id_token_signing_alg_values_supported: ["RS256"],
		scopes_supported: ["openid", "profile", "email"],
		claims_supported: [
			"sub",
			"email",
			"email_verified",
			"given_name",
			"family_name",
			"name",
			"picture",
		],
		code_challenge_methods_supported: ["plain", "S256"],
	};
}

/* **
 OpenID Connect Discovery Endpoint
 1. OpenID Connect Discovery Endpoint: This endpoint provides metadata about the OpenID Connect provider, 
 including the issuer URL, authorization endpoint, token endpoint, userinfo endpoint, and JWKS URI. 
 This allows clients to dynamically discover the necessary endpoints for authentication and token management.
 * **/
oidcRoute.get("/.well-known/openid-configuration", (req, res) => {
	return res.json(getDiscoveryMetadata(req));
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
oidcRoute.get("/auth/authorize", async (req, res) => {
	const authorizationRequest = await resolveAuthorizationApplication(
		req.query.client_id,
		req.query.redirect_uri
	);

	if ("error" in authorizationRequest) {
		return redirectToErrorPage(res, authorizationRequest.error);
	}

	if (req.query.response_type !== "code") {
		return redirectToErrorPage(res, "response_type=code is required.");
	}

	return res.sendFile(path.resolve("public", "authorize.html"));
});

oidcRoute.get("/sign-up", async (req, res) => {
	const authorizationRequest = await resolveAuthorizationApplication(
		req.query.client_id,
		req.query.redirect_uri
	);

	if ("error" in authorizationRequest) {
		return redirectToErrorPage(res, authorizationRequest.error, 400, "Sign Up Error");
	}

	return res.sendFile(path.resolve("public", "sign-up.html"));
});

oidcRoute.get("/error", (req, res) => {
	return res.sendFile(path.resolve("public", "error.html"));
});

// Endpoint to retrieve application details by client_id
oidcRoute.get("/auth/application", async (req, res) => {
	const clientId = req.query.client_id;

	if (typeof clientId !== "string" || !clientId) {
		res.status(400).json({
			message: "client_id is required.",
		});
		return;
	}

	const application = await findApplicationByClientId(clientId);

	if (!application) {
		res.status(404).json({
			message: "Application not found.",
		});
		return;
	}

	res.json({
		clientId: application.clientId,
		applicationName: application.applicationName,
		applicationURL: application.applicationURL,
		redirectURIs: splitRedirectURIs(application.redirectURIs),
	});
});

oidcRoute.post("/auth/application/register", async (req, res) => {
	try {
		const { displayName, applicationUrl, redirectUrl, description } = req.body;

		if (!displayName || !applicationUrl || !redirectUrl) {
			res.status(400).json({
				message: "Application display name, application URL, and redirect URL are required.",
			});
			return;
		}

		const clientId = `client_${createRandomToken(18)}`;
		const clientSecret = `secret_${createRandomToken(32)}`;

		const [application] = await db
			.insert(applicationsTable)
			.values({
				applicationName: displayName,
				applicationDescription: description || null,
				applicationURL: applicationUrl,
				redirectURIs: redirectUrl,
				clientId,
				clientSecret,
			})
			.returning();

		res.status(201).json({
			application: {
				id: application.id,
				applicationName: application.applicationName,
				applicationURL: application.applicationURL,
				redirectURIs: splitRedirectURIs(application.redirectURIs),
			},
			clientId: application.clientId,
			clientSecret: application.clientSecret,
		});
	} catch {
		res.status(500).json({
			message: "Unable to register application right now. Please try again later.",
		});
	}
});

oidcRoute.post("/auth/authorize/sign-in", async (req, res) => {
	try {
		// Extract email and password from request body
		const { email, password, clientId, redirectUri, state } = req.body;
		// Validate required credentials are provided
		if (!email || !password) {
			res.status(400).json({
				message: " Email and password are required.",
			});
			return;
		}

		const authorizationRequest = await resolveAuthorizationApplication(clientId, redirectUri);

		if ("error" in authorizationRequest) {
			res.status(400).json({ message: authorizationRequest.error });
			return;
		}

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

		const code = createRandomToken(24);
		const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

		await db.insert(authorizationCodesTable).values({
			code,
			applicationId: authorizationRequest.application.id,
			userId: user.id,
			redirectURI: authorizationRequest.redirectUri,
			expiresAt,
		});

		const redirectTo = new URL(authorizationRequest.redirectUri);
		redirectTo.searchParams.set("code", code);

		if (typeof state === "string" && state) {
			redirectTo.searchParams.set("state", state);
		}

		res.json({
			code,
			expiresAt: expiresAt.toISOString(),
			redirectTo: redirectTo.toString(),
		});
	} catch (error) {
		res.status(500).json({
			message: "Unable to sign in right now. Please try again later.",
		});
	}
});

oidcRoute.post("/auth/token", async (req, res) => {
	try {
		const { grant_type, code, redirect_uri, client_id, client_secret } = req.body;

		if (grant_type !== "authorization_code") {
			res.status(400).json({ message: "Only authorization_code grant_type is supported." });
			return;
		}

		if (!code || !redirect_uri || !client_id || !client_secret) {
			res.status(400).json({
				message: "code, redirect_uri, client_id, and client_secret are required.",
			});
			return;
		}

		const application = await findApplicationByClientId(client_id);

		if (!application || application.clientSecret !== client_secret) {
			res.status(401).json({ message: "Invalid client credentials." });
			return;
		}

		const [authorizationCode] = await db
			.select()
			.from(authorizationCodesTable)
			.where(
				and(
					eq(authorizationCodesTable.code, code),
					eq(authorizationCodesTable.applicationId, application.id),
					eq(authorizationCodesTable.redirectURI, redirect_uri),
					gt(authorizationCodesTable.expiresAt, new Date()),
					isNull(authorizationCodesTable.usedAt)
				)
			)
			.limit(1);

		if (!authorizationCode) {
			res.status(400).json({ message: "Invalid, expired, or already used authorization code." });
			return;
		}

		const [user] = await db
			.select()
			.from(usersTable)
			.where(eq(usersTable.id, authorizationCode.userId))
			.limit(1);

		if (!user) {
			res.status(404).json({ message: "User not found." });
			return;
		}

		const token = createUserJWT(user);

		await db
			.update(authorizationCodesTable)
			.set({ usedAt: new Date() })
			.where(eq(authorizationCodesTable.id, authorizationCode.id));

		res.json({
			token_type: "Bearer",
			expires_in: 3600,
			access_token: token,
			id_token: token,
		});
	} catch (error) {
		logRouteError("Token exchange failed", error);

		res.status(500).json({
			message: "Unable to issue token right now. Please try again later.",
		});
	}
});

oidcRoute.post("/auth/authorize/sign-up", async (req, res) => {
	try {
		// Extract user data from request body
		const { firstName, lastName, email, password, clientId, redirectUri } = req.body;
		// Validate that required data are provided
		if (!firstName || !email || !password) {
			res.status(400).json({
				message: "First name, email, password is required",
			});
			return;
		}
		// Query database for user by email, check existing or not
		const authorizationRequest = await resolveAuthorizationApplication(clientId, redirectUri);

		if ("error" in authorizationRequest) {
			res.status(400).json({ message: authorizationRequest.error });
			return;
		}

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
		// send response
		res.status(200).json({
			ok: true,
			message: "Account created successfully!",
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
	if (!authHeader?.startsWith("Bearer ")) {
		res.status(401).json({
			message: "Missing or invalid Authorization header.",
		});
		return;
	}

	// remove "Berrar " fron authheader
	const token = authHeader.slice(7);

	let claims: JWTClaims;
	try {
		claims = JWT.verify(token, PUBLIC_KEY, {
			algorithms: ["RS256"],
		}) as JWTClaims;
	} catch {
		res.status(401).json({
			message: "Invalid or expired token.",
		});
		return;
	}

	const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.sub)).limit(1);

	if (!user) {
		res.status(404).json({ message: "User not found." });
		return;
	}

	res.json({
		sub: user.id,
		email: user.email,
		email_verified: user.emailVerified,
		given_name: user.firstName,
		family_name: user.lastName,
		name: [user.firstName, user.lastName].filter(Boolean).join(" "),
		picture: user.profileImageURL,
	});
});

oidcRoute.get("/admin", (req, res) => {
	return res.sendFile(path.resolve("public", "application.html"));
});

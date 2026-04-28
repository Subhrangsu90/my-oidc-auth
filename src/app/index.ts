import express from "express";
import path from "node:path";
import cookieParser from "cookie-parser";
import { oidcRoute } from "./oidc/oidc.routes";

export function createOIDCAuthServer() {
	const app = express();
	app.use(express.json());
	app.use(express.urlencoded({ extended: false }));
	app.use(cookieParser());
	app.use(express.static(path.resolve("public")));

	// Middleware

	// Routes
	app.get("/", (req, res) => {
		return res.sendFile(path.resolve("public", "index.html"));
	});

	app.get("/health", (req, res) => {
		res.json({
			status: "OK",
			timestamp: new Date().toISOString(),
			healthy: true,
			uptime: process.uptime(),
			version: "1.0.0",
			environment: process.env.NODE_ENV || "development",
			message: "Server is healthy and running smoothly.",
		});
	});

	// OIDC Authentication routes
	app.use("/", oidcRoute);

	return app;
}

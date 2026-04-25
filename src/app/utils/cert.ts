import { readFileSync } from "node:fs";
import { createPrivateKey, createPublicKey } from "node:crypto";
import path from "node:path";

function readKeyFromEnvOrFile(envName: string, filePath: string) {
	const value = process.env[envName];

	if (value) {
		return value
			.trim()
			.replace(/^['"]|['"]$/g, "")
			.replace(/\\n/g, "\n");
	}

	return readFileSync(path.resolve(filePath), "utf-8");
}
// Read keys from environment variables or fallback to files
export const PRIVATE_KEY = readKeyFromEnvOrFile("OIDC_PRIVATE_KEY", "cert/private-key.pem");

export const PUBLIC_KEY = readKeyFromEnvOrFile("OIDC_PUBLIC_KEY", "cert/public-key.pub");

try {
	createPrivateKey(PRIVATE_KEY);
	createPublicKey(PUBLIC_KEY);
} catch (error) {
	console.error("OIDC signing key validation failed", error instanceof Error ? error.stack : error);
	throw error;
}

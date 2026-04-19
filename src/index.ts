import { createServer } from "node:http";
import { createOIDCAuthServer } from "./app";

async function main() {
	try {
		const server = createServer(createOIDCAuthServer());
		const PORT = process.env.PORT ?? 8000;

		server.listen(PORT, () => {
			console.log(`HTTP server running on http://localhost:${PORT}`);
		});
	} catch (error) {
		console.error("Error starting server");
	}
}

main();

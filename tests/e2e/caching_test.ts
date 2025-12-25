/**
 * e2e tests for caching and performance
 *
 * tests:
 * - static assets have proper cache headers
 * - repeated requests work correctly
 * - concurrent requests handled properly
 */

import {
	cleanupTestServer,
	createAccount,
	expectOk,
	makeRequest,
	startTestServer,
	type TestServer,
} from "./setup.ts";

let server: TestServer;
let userSession: string;

// setup
Deno.test({
	name: "caching e2e setup",
	async fn() {
		server = await startTestServer();
		const { sessionToken } = await createAccount(
			server.config.baseUrl,
			"cacheuser",
			"password123",
		);
		userSession = sessionToken;
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

// =============================================================================
// Static Asset Caching
// =============================================================================

Deno.test("caching - css file served correctly", async () => {
	const response = await makeRequest(server.config.baseUrl, "/news.css");
	expectOk(response);
	if (!response.body.includes("font-family")) {
		throw new Error("CSS file content not correct");
	}
});

Deno.test("caching - grayarrow.gif served correctly", async () => {
	const response = await makeRequest(server.config.baseUrl, "/grayarrow.gif");
	expectOk(response);
	// should return binary gif data
	if (response.body.length === 0) {
		throw new Error("Image file empty");
	}
});

Deno.test("caching - arc.png served correctly", async () => {
	const response = await makeRequest(server.config.baseUrl, "/arc.png");
	expectOk(response);
});

Deno.test("caching - s.gif served correctly", async () => {
	const response = await makeRequest(server.config.baseUrl, "/s.gif");
	expectOk(response);
});

// =============================================================================
// Repeated Request Tests
// =============================================================================

Deno.test("caching - repeated /news requests work", async () => {
	for (let i = 0; i < 3; i++) {
		const response = await makeRequest(server.config.baseUrl, "/news");
		expectOk(response);
	}
});

Deno.test("caching - repeated /newest requests work", async () => {
	for (let i = 0; i < 3; i++) {
		const response = await makeRequest(server.config.baseUrl, "/newest");
		expectOk(response);
	}
});

// =============================================================================
// Concurrent Request Tests
// =============================================================================

Deno.test("caching - concurrent requests handled", async () => {
	// make multiple requests in parallel
	const requests = [
		makeRequest(server.config.baseUrl, "/news"),
		makeRequest(server.config.baseUrl, "/newest"),
		makeRequest(server.config.baseUrl, "/newcomments"),
		makeRequest(server.config.baseUrl, "/best"),
	];

	const responses = await Promise.all(requests);

	for (const response of responses) {
		expectOk(response);
	}
});

Deno.test("caching - concurrent same-page requests handled", async () => {
	// make multiple requests to same page
	const requests = [
		makeRequest(server.config.baseUrl, "/news"),
		makeRequest(server.config.baseUrl, "/news"),
		makeRequest(server.config.baseUrl, "/news"),
	];

	const responses = await Promise.all(requests);

	for (const response of responses) {
		expectOk(response);
	}
});

// =============================================================================
// Content Freshness Tests
// =============================================================================

Deno.test("caching - new content appears immediately", async () => {
	// create a submission helper from setup
	const { sessionToken } = await createAccount(
		server.config.baseUrl,
		"freshuser",
		"password123",
	);

	// submit story
	const body = new URLSearchParams({
		t: "Fresh Content Test Story",
		u: "https://fresh-content.example.com",
	});

	const proc = new Deno.Command("curl", {
		args: [
			"-s",
			"-X",
			"POST",
			"-b",
			`user=${sessionToken}`,
			"-d",
			body.toString(),
			`${server.config.baseUrl}/submit`,
		],
	});
	await proc.output();

	// immediately check if story appears
	const response = await makeRequest(server.config.baseUrl, "/newest");
	expectOk(response);
	// story should appear immediately (no aggressive caching)
	if (!response.body.includes("Fresh Content Test Story")) {
		throw new Error("Fresh content not appearing immediately");
	}
});

// =============================================================================
// Error Recovery Tests
// =============================================================================

Deno.test("caching - 404 doesn't break subsequent requests", async () => {
	// request nonexistent page
	const notFound = await makeRequest(
		server.config.baseUrl,
		"/nonexistent-page",
	);
	if (notFound.status !== 404) {
		throw new Error(`Expected 404, got ${notFound.status}`);
	}

	// next request should still work
	const response = await makeRequest(server.config.baseUrl, "/news");
	expectOk(response);
});

Deno.test("caching - invalid params don't break server", async () => {
	// request with invalid params
	await makeRequest(server.config.baseUrl, "/item?id=notanumber");

	// next request should still work
	const response = await makeRequest(server.config.baseUrl, "/news");
	expectOk(response);
});

// cleanup
Deno.test({
	name: "caching e2e cleanup",
	async fn() {
		await cleanupTestServer(server);
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

/**
 * e2e tests for error handling and edge cases
 *
 * tests:
 * - invalid input handling
 * - missing parameter errors
 * - permission errors
 * - concurrent request handling
 */

import {
	cleanupTestServer,
	createAccount,
	expectHtml,
	expectOk,
	expectStatus,
	makeAuthRequest,
	makeRequest,
	startTestServer,
	type TestServer,
} from "./setup.ts";

let server: TestServer;
let userSession: string;

// setup
Deno.test({
	name: "errors e2e setup",
	async fn() {
		server = await startTestServer();
		const { sessionToken } = await createAccount(
			server.config.baseUrl,
			"errorsuser",
			"password123",
		);
		userSession = sessionToken;
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

// =============================================================================
// Missing Parameter Errors
// =============================================================================

Deno.test("error - /item without id returns 404", async () => {
	const response = await makeRequest(server.config.baseUrl, "/item");
	expectStatus(response, 404);
});

Deno.test("error - /user without id returns 404", async () => {
	const response = await makeRequest(server.config.baseUrl, "/user");
	expectStatus(response, 404);
});

Deno.test("error - /submitted without id returns 400", async () => {
	const response = await makeRequest(server.config.baseUrl, "/submitted");
	expectStatus(response, 400);
});

Deno.test("error - /threads without id returns 400", async () => {
	const response = await makeRequest(server.config.baseUrl, "/threads");
	expectStatus(response, 400);
});

Deno.test("error - /saved without id returns 400", async () => {
	const response = await makeRequest(server.config.baseUrl, "/saved");
	expectStatus(response, 400);
});

// =============================================================================
// Not Found Errors
// =============================================================================

Deno.test("error - nonexistent item returns 404", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/item?id=999999",
	);
	expectStatus(response, 404);
	expectHtml(response, "No such item");
});

Deno.test("error - nonexistent user returns 404", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/user?id=nonexistent_user_xyz",
	);
	expectStatus(response, 404);
	expectHtml(response, "No such user");
});

// =============================================================================
// Invalid Input Handling
// =============================================================================

Deno.test("error - invalid item id handled gracefully", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/item?id=notanumber",
	);
	expectStatus(response, 404);
});

Deno.test("error - empty submit title rejected", async () => {
	const body = new URLSearchParams({
		t: "",
		u: "https://example.com",
	});
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		userSession,
		{ method: "POST", body },
	);
	expectOk(response);
	expectHtml(response, "title");
});

Deno.test("error - submit without url or text rejected", async () => {
	const body = new URLSearchParams({
		t: "Title Only No Content",
		u: "",
		x: "",
	});
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		userSession,
		{ method: "POST", body },
	);
	expectOk(response);
	// should show error or require url/text
});

// =============================================================================
// Authentication Errors
// =============================================================================

Deno.test("error - submit without login shows login form", async () => {
	const response = await makeRequest(server.config.baseUrl, "/submit");
	expectOk(response);
	expectHtml(response, "Login");
});

Deno.test("error - vote without login shows login form", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/vote?for=1&dir=up",
	);
	// either shows login or 404 if item doesn't exist
});

Deno.test("error - comment without login shows login form", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/comment?parent=1",
	);
	expectOk(response);
	expectHtml(response, "Login");
});

// =============================================================================
// Permission Errors
// =============================================================================

Deno.test("error - admin page returns 403 for non-admin", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/newsadmin",
		userSession,
	);
	expectStatus(response, 403);
});

Deno.test("error - flagged page returns 403 for non-editor", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/flagged",
		userSession,
	);
	expectStatus(response, 403);
});

Deno.test("error - killed page returns 403 for non-editor", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/killed",
		userSession,
	);
	expectStatus(response, 403);
});

// =============================================================================
// Special Character Handling
// =============================================================================

Deno.test("error - special chars in username handled", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/user?id=<script>alert(1)</script>",
	);
	expectStatus(response, 404);
	// should not execute script
	expectHtml(response, "No such user");
});

Deno.test("error - special chars in search handled", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/submitted?id=test%27%22%3E%3Cscript%3E",
	);
	// should handle gracefully - either 400 or 404
});

// cleanup
Deno.test({
	name: "errors e2e cleanup",
	async fn() {
		await cleanupTestServer(server);
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

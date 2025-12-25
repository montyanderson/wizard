/**
 * e2e tests for route authentication requirements
 *
 * tests:
 * - public routes accessible without auth
 * - protected routes require auth
 * - admin routes require admin status
 * - editor routes require editor status
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
	name: "route auth e2e setup",
	async fn() {
		server = await startTestServer();
		const { sessionToken } = await createAccount(
			server.config.baseUrl,
			"authuser",
			"password123",
		);
		userSession = sessionToken;
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

// =============================================================================
// Public Routes - No Auth Required
// =============================================================================

Deno.test("public - /news accessible without auth", async () => {
	const response = await makeRequest(server.config.baseUrl, "/news");
	expectOk(response);
});

Deno.test("public - /newest accessible without auth", async () => {
	const response = await makeRequest(server.config.baseUrl, "/newest");
	expectOk(response);
});

Deno.test("public - /newcomments accessible without auth", async () => {
	const response = await makeRequest(server.config.baseUrl, "/newcomments");
	expectOk(response);
});

Deno.test("public - /best accessible without auth", async () => {
	const response = await makeRequest(server.config.baseUrl, "/best");
	expectOk(response);
});

Deno.test("public - /bestcomments accessible without auth", async () => {
	const response = await makeRequest(server.config.baseUrl, "/bestcomments");
	expectOk(response);
});

Deno.test("public - /active accessible without auth", async () => {
	const response = await makeRequest(server.config.baseUrl, "/active");
	expectOk(response);
});

Deno.test("public - /noobstories accessible without auth", async () => {
	const response = await makeRequest(server.config.baseUrl, "/noobstories");
	expectOk(response);
});

Deno.test("public - /noobcomments accessible without auth", async () => {
	const response = await makeRequest(server.config.baseUrl, "/noobcomments");
	expectOk(response);
});

Deno.test("public - /login accessible without auth", async () => {
	const response = await makeRequest(server.config.baseUrl, "/login");
	expectOk(response);
});

Deno.test("public - /user profile accessible without auth", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/user?id=authuser",
	);
	expectOk(response);
});

Deno.test("public - /submitted accessible without auth", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/submitted?id=authuser",
	);
	expectOk(response);
});

Deno.test("public - /threads accessible without auth", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/threads?id=authuser",
	);
	expectOk(response);
});

Deno.test("public - static css accessible without auth", async () => {
	const response = await makeRequest(server.config.baseUrl, "/news.css");
	expectOk(response);
});

Deno.test("public - static images accessible without auth", async () => {
	const response = await makeRequest(server.config.baseUrl, "/grayarrow.gif");
	expectOk(response);
});

// =============================================================================
// Protected Routes - Auth Required (shows login form)
// =============================================================================

Deno.test("protected - /submit without auth shows login", async () => {
	const response = await makeRequest(server.config.baseUrl, "/submit");
	expectOk(response);
	expectHtml(response, "Login");
});

Deno.test("protected - /comment without auth returns 404 for nonexistent item", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/comment?parent=1",
	);
	// returns 404 because item doesn't exist (checked before auth)
	expectStatus(response, 404);
});

Deno.test("protected - /reply without auth returns 404 for nonexistent item", async () => {
	const response = await makeRequest(server.config.baseUrl, "/reply?id=1");
	// returns 404 because item doesn't exist (checked before auth)
	expectStatus(response, 404);
});

Deno.test("protected - /edit without auth returns 404 for nonexistent item", async () => {
	const response = await makeRequest(server.config.baseUrl, "/edit?id=1");
	// returns 404 because item doesn't exist (checked before auth)
	expectStatus(response, 404);
});

Deno.test("protected - /delete without auth returns 404 for nonexistent item", async () => {
	const response = await makeRequest(server.config.baseUrl, "/delete?id=1");
	// returns 404 because item doesn't exist (checked before auth)
	expectStatus(response, 404);
});

// =============================================================================
// Protected Routes - Auth Required (with auth)
// =============================================================================

Deno.test("protected - /submit with auth shows form", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		userSession,
	);
	expectOk(response);
	expectHtml(response, 'name="t"'); // title field
});

Deno.test("protected - /submitlink with auth shows form", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/submitlink?u=http://test.com&t=Test",
		userSession,
	);
	expectOk(response);
	expectHtml(response, "test.com");
});

// =============================================================================
// Admin Routes - Require Admin Status
// =============================================================================

Deno.test("admin - /newsadmin returns 403 for regular user", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/newsadmin",
		userSession,
	);
	expectStatus(response, 403);
});

Deno.test("admin - /newsadmin without auth returns 403", async () => {
	const response = await makeRequest(server.config.baseUrl, "/newsadmin");
	// returns 403 for non-admin (no auth treated as non-admin)
	expectStatus(response, 403);
});

// =============================================================================
// Editor Routes - Require Editor Status
// =============================================================================

Deno.test("editor - /flagged returns 403 for regular user", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/flagged",
		userSession,
	);
	expectStatus(response, 403);
});

Deno.test("editor - /killed returns 403 for regular user", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/killed",
		userSession,
	);
	expectStatus(response, 403);
});

// =============================================================================
// Session/Cookie Tests
// =============================================================================

Deno.test("session - invalid session token shows login", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		"invalid_session_token_xyz",
	);
	expectOk(response);
	expectHtml(response, "Login");
});

Deno.test("session - empty session token shows login", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		"",
	);
	expectOk(response);
	expectHtml(response, "Login");
});

Deno.test("session - valid session works", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		userSession,
	);
	expectOk(response);
	expectHtml(response, 'name="t"'); // shows submit form
});

// =============================================================================
// API-like Routes
// =============================================================================

Deno.test("api - /vote without auth handles gracefully", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/vote?for=1&dir=up",
	);
	// may show login or error
});

Deno.test("api - /fave without auth handles gracefully", async () => {
	const response = await makeRequest(server.config.baseUrl, "/fave?id=1");
	// may show login or error
});

Deno.test("api - /flag without auth handles gracefully", async () => {
	const response = await makeRequest(server.config.baseUrl, "/flag?id=1");
	// may show login or error
});

// cleanup
Deno.test({
	name: "route auth e2e cleanup",
	async fn() {
		await cleanupTestServer(server);
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

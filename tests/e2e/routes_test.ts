/**
 * e2e tests for all routes
 *
 * tests every route with all parameters to ensure:
 * - correct status codes
 * - expected content
 * - proper error handling
 */

import { assertEquals } from "@std/assert";
import {
	cleanupTestServer,
	createAccount,
	expectHtml,
	expectOk,
	expectRedirect,
	expectStatus,
	makeAuthRequest,
	makeRequest,
	startTestServer,
	type TestServer,
} from "./setup.ts";

let server: TestServer;
let userSession: string;
let adminSession: string;

// setup: start server and create test users
Deno.test({
	name: "routes e2e setup",
	async fn() {
		server = await startTestServer();

		// create regular user
		const { sessionToken } = await createAccount(
			server.config.baseUrl,
			"routeuser",
			"password123",
		);
		userSession = sessionToken;

		// note: admin user would need special setup via data seeding
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

// =============================================================================
// Public Routes
// =============================================================================

Deno.test("GET / - news page", async () => {
	const response = await makeRequest(server.config.baseUrl, "/news");
	expectOk(response);
	expectHtml(response, "news.css"); // verify basic page structure
});

Deno.test("GET /news - news page with pagination", async () => {
	const response = await makeRequest(server.config.baseUrl, "/news?p=1");
	expectOk(response);
});

Deno.test("GET /newest - newest stories", async () => {
	const response = await makeRequest(server.config.baseUrl, "/newest");
	expectOk(response);
});

Deno.test("GET /best - best stories", async () => {
	const response = await makeRequest(server.config.baseUrl, "/best");
	expectOk(response);
});

Deno.test("GET /bestcomments - best comments", async () => {
	const response = await makeRequest(server.config.baseUrl, "/bestcomments");
	expectOk(response);
});

Deno.test("GET /active - active stories", async () => {
	const response = await makeRequest(server.config.baseUrl, "/active");
	expectOk(response);
});

Deno.test("GET /newcomments - new comments", async () => {
	const response = await makeRequest(server.config.baseUrl, "/newcomments");
	expectOk(response);
});

Deno.test("GET /noobstories - new user stories", async () => {
	const response = await makeRequest(server.config.baseUrl, "/noobstories");
	expectOk(response);
});

Deno.test("GET /noobcomments - new user comments", async () => {
	const response = await makeRequest(server.config.baseUrl, "/noobcomments");
	expectOk(response);
});

Deno.test("GET /leaders - leaderboard", async () => {
	const response = await makeRequest(server.config.baseUrl, "/leaders");
	expectOk(response);
	expectHtml(response, "Leaders");
});

Deno.test("GET /lists - list index", async () => {
	const response = await makeRequest(server.config.baseUrl, "/lists");
	expectOk(response);
	expectHtml(response, "Lists");
});

Deno.test("GET /rss - rss feed", async () => {
	const response = await makeRequest(server.config.baseUrl, "/rss");
	expectOk(response);
	expectHtml(response, "rss");
	assertEquals(
		response.headers.get("Content-Type")?.includes("xml"),
		true,
	);
});

Deno.test("GET /news.css - stylesheet", async () => {
	const response = await makeRequest(server.config.baseUrl, "/news.css");
	expectOk(response);
	assertEquals(
		response.headers.get("Content-Type")?.includes("css"),
		true,
	);
});

Deno.test("GET /formatdoc - formatting help", async () => {
	const response = await makeRequest(server.config.baseUrl, "/formatdoc");
	expectOk(response);
	expectHtml(response, "Formatting");
});

Deno.test("GET /whoami - shows ip when not logged in", async () => {
	const response = await makeRequest(server.config.baseUrl, "/whoami");
	expectOk(response);
});

Deno.test("GET /topcolors - top colors list", async () => {
	const response = await makeRequest(server.config.baseUrl, "/topcolors");
	expectOk(response);
});

// =============================================================================
// Item Routes
// =============================================================================

Deno.test("GET /item - missing id returns error", async () => {
	const response = await makeRequest(server.config.baseUrl, "/item");
	// without id, parses as 0, item 0 doesn't exist -> 404
	expectStatus(response, 404);
});

Deno.test("GET /item - nonexistent id returns 404", async () => {
	const response = await makeRequest(server.config.baseUrl, "/item?id=99999");
	expectStatus(response, 404);
});

// =============================================================================
// User Routes
// =============================================================================

Deno.test("GET /user - missing id returns error", async () => {
	const response = await makeRequest(server.config.baseUrl, "/user");
	// empty string user doesn't exist -> 404
	expectStatus(response, 404);
});

Deno.test("GET /user - nonexistent user returns 404", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/user?id=nonexistent",
	);
	expectStatus(response, 404);
});

Deno.test("GET /user - existing user shows profile", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/user?id=routeuser",
	);
	expectOk(response);
	expectHtml(response, "routeuser");
});

Deno.test("GET /submitted - missing id returns error", async () => {
	const response = await makeRequest(server.config.baseUrl, "/submitted");
	expectStatus(response, 400);
});

Deno.test("GET /submitted - shows user submissions", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/submitted?id=routeuser",
	);
	expectOk(response);
	expectHtml(response, "routeuser");
});

Deno.test("GET /threads - missing id returns error", async () => {
	const response = await makeRequest(server.config.baseUrl, "/threads");
	expectStatus(response, 400);
});

Deno.test("GET /threads - shows user threads", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/threads?id=routeuser",
	);
	expectOk(response);
});

Deno.test("GET /saved - requires id parameter", async () => {
	const response = await makeRequest(server.config.baseUrl, "/saved");
	// /saved requires an id parameter
	expectStatus(response, 400);
});

// =============================================================================
// Authentication Routes
// =============================================================================

Deno.test("GET /login - shows login form", async () => {
	const response = await makeRequest(server.config.baseUrl, "/login");
	expectOk(response);
	expectHtml(response, "Login");
});

Deno.test("GET /logout - redirects", async () => {
	const response = await makeRequest(server.config.baseUrl, "/logout", {
		followRedirects: false,
	});
	expectRedirect(response);
});

Deno.test("GET /resetpw - shows reset form", async () => {
	const response = await makeRequest(server.config.baseUrl, "/resetpw");
	expectOk(response);
});

// =============================================================================
// Authenticated User Routes
// =============================================================================

Deno.test("GET /submit - shows submit form when logged in", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		userSession,
	);
	expectOk(response);
	expectHtml(response, "title");
});

Deno.test("GET /submitlink - prefills form", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/submitlink?u=https://example.com&t=Test",
		userSession,
	);
	expectOk(response);
	expectHtml(response, "https://example.com");
});

Deno.test("GET /welcome - shows welcome page", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/welcome",
		userSession,
	);
	expectOk(response);
});

// =============================================================================
// Story Submission
// =============================================================================

Deno.test("POST /submit - requires title", async () => {
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

Deno.test("POST /submit - creates story", async () => {
	const body = new URLSearchParams({
		t: "Test Story Title",
		u: "https://example.com/test",
	});
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		userSession,
		{ method: "POST", body, followRedirects: false },
	);
	// should redirect to the new item
	expectRedirect(response);
});

// =============================================================================
// Vote Routes
// =============================================================================

Deno.test("GET /vote - requires login", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/vote?for=1&dir=up",
	);
	expectOk(response);
	expectHtml(response, "Login");
});

// =============================================================================
// Comment/Reply Routes
// =============================================================================

Deno.test("GET /comment - requires login", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/comment?parent=1",
	);
	expectOk(response);
	expectHtml(response, "Login");
});

Deno.test("GET /reply - requires login", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/reply?id=1",
	);
	expectOk(response);
	expectHtml(response, "Login");
});

// =============================================================================
// Edit/Flag Routes
// =============================================================================

Deno.test("GET /edit - requires login", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/edit?id=1",
	);
	expectOk(response);
	expectHtml(response, "Login");
});

Deno.test("GET /flag - requires login", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/flag?id=1",
	);
	expectOk(response);
	expectHtml(response, "Login");
});

// =============================================================================
// Poll Routes
// =============================================================================

Deno.test("GET /newpoll - requires login", async () => {
	const response = await makeRequest(server.config.baseUrl, "/newpoll");
	expectOk(response);
	expectHtml(response, "Login");
});

// =============================================================================
// Admin Routes (should reject non-admins)
// =============================================================================

Deno.test("GET /flagged - requires editor", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/flagged",
		userSession,
	);
	// non-editor should be rejected
	expectStatus(response, 403);
});

Deno.test("GET /killed - requires editor", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/killed",
		userSession,
	);
	expectStatus(response, 403);
});

Deno.test("GET /newsadmin - requires admin", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/newsadmin",
		userSession,
	);
	expectStatus(response, 403);
});

Deno.test("GET /badsites - requires admin", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/badsites",
		userSession,
	);
	expectStatus(response, 403);
});

Deno.test("GET /badips - requires admin", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/badips",
		userSession,
	);
	expectStatus(response, 403);
});

Deno.test("GET /editors - requires admin", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/editors",
		userSession,
	);
	expectStatus(response, 403);
});

Deno.test("GET /badguys - requires admin", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/badguys",
		userSession,
	);
	expectStatus(response, 403);
});

Deno.test("GET /scrubrules - requires admin", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/scrubrules",
		userSession,
	);
	expectStatus(response, 403);
});

// cleanup: stop server
Deno.test({
	name: "routes e2e cleanup",
	async fn() {
		await cleanupTestServer(server);
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

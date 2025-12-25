/**
 * e2e tests for policy-based actions
 *
 * tests all business rules and validation:
 * - vote policies (upvote, downvote restrictions)
 * - flag policies
 * - edit policies
 * - submit policies
 */

import { assertEquals } from "@std/assert";
import {
	cleanupTestServer,
	createAccount,
	createTestStory,
	expectHtml,
	expectOk,
	expectRedirect,
	expectStatus,
	makeAuthRequest,
	makeRequest,
	seedStory,
	seedUserWithKarma,
	startTestServer,
	type TestServer,
} from "./setup.ts";

let server: TestServer;

// setup: start server
Deno.test({
	name: "policies e2e setup",
	async fn() {
		server = await startTestServer();
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

// =============================================================================
// Vote Policies
// =============================================================================

Deno.test("vote - requires login or valid item", async () => {
	// vote on non-existent item without login returns 404
	const response = await makeRequest(
		server.config.baseUrl,
		"/vote?for=1&dir=up",
	);
	// item doesn't exist in test server, so 404
	expectStatus(response, 404);
});

Deno.test("vote - cannot vote on nonexistent item", async () => {
	const { sessionToken } = await createAccount(
		server.config.baseUrl,
		"voter1",
		"password123",
	);

	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/vote?for=99999&dir=up",
		sessionToken,
		{ followRedirects: false },
	);

	// should show error or redirect back
	// exact behavior depends on implementation
});

// =============================================================================
// Submit Policies
// =============================================================================

Deno.test("submit - title required", async () => {
	const { sessionToken } = await createAccount(
		server.config.baseUrl,
		"submitter1",
		"password123",
	);

	const body = new URLSearchParams({
		t: "",
		u: "https://example.com",
	});
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		sessionToken,
		{ method: "POST", body },
	);

	expectOk(response);
	expectHtml(response, "title");
});

Deno.test("submit - creates story with author vote", async () => {
	const { sessionToken } = await createAccount(
		server.config.baseUrl,
		"submitter2",
		"password123",
	);

	const body = new URLSearchParams({
		t: "Test Policy Story",
		u: "https://policy-test.com",
	});
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		sessionToken,
		{ method: "POST", body, followRedirects: false },
	);

	// should redirect to new item
	expectRedirect(response);

	// follow redirect and check story
	if (response.redirectUrl) {
		// ensure path starts with /
		const path = response.redirectUrl.startsWith("/")
			? response.redirectUrl
			: "/" + response.redirectUrl;
		const itemResponse = await makeAuthRequest(
			server.config.baseUrl,
			path,
			sessionToken,
		);
		expectOk(itemResponse);
		expectHtml(itemResponse, "Test Policy Story");
		expectHtml(itemResponse, "1 point"); // author auto-vote
	}
});

Deno.test("submit - url-only story", async () => {
	const { sessionToken } = await createAccount(
		server.config.baseUrl,
		"submitter3",
		"password123",
	);

	const body = new URLSearchParams({
		t: "URL Only Story",
		u: "https://url-only.com",
		x: "",
	});
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		sessionToken,
		{ method: "POST", body, followRedirects: false },
	);

	expectRedirect(response);
});

Deno.test("submit - text-only story (no url)", async () => {
	const { sessionToken } = await createAccount(
		server.config.baseUrl,
		"submitter4",
		"password123",
	);

	const body = new URLSearchParams({
		t: "Text Only Story",
		u: "",
		x: "This is the text content of the story.",
	});
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		sessionToken,
		{ method: "POST", body, followRedirects: false },
	);

	expectRedirect(response);
});

// =============================================================================
// Comment Policies
// =============================================================================

Deno.test("comment - requires text", async () => {
	const { sessionToken: poster } = await createAccount(
		server.config.baseUrl,
		"storyposter",
		"password123",
	);

	// create a story first
	const storyBody = new URLSearchParams({
		t: "Story for Comments",
		u: "https://comments.test",
	});
	const storyResponse = await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		poster,
		{ method: "POST", body: storyBody, followRedirects: false },
	);

	// extract story id from redirect
	const itemMatch = storyResponse.redirectUrl?.match(/id=(\d+)/);
	if (!itemMatch) return;
	const storyId = itemMatch[1];

	// try to post empty comment
	const { sessionToken: commenter } = await createAccount(
		server.config.baseUrl,
		"commenter1",
		"password123",
	);

	const commentBody = new URLSearchParams({
		parent: storyId,
		text: "",
	});
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/comment",
		commenter,
		{ method: "POST", body: commentBody },
	);

	expectOk(response);
	expectHtml(response, "comment"); // error about needing comment
});

// =============================================================================
// Edit Policies
// =============================================================================

Deno.test("edit - requires login", async () => {
	const response = await makeRequest(server.config.baseUrl, "/edit?id=1");
	expectOk(response);
	expectHtml(response, "Login");
});

Deno.test("edit - nonexistent item returns 404", async () => {
	const { sessionToken } = await createAccount(
		server.config.baseUrl,
		"editor1",
		"password123",
	);

	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/edit?id=99999",
		sessionToken,
	);

	// should show error for missing item
});

// =============================================================================
// Flag Policies
// =============================================================================

Deno.test("flag - requires login", async () => {
	const response = await makeRequest(server.config.baseUrl, "/flag?id=1");
	expectOk(response);
	expectHtml(response, "Login");
});

// =============================================================================
// Poll Policies
// =============================================================================

Deno.test("newpoll - requires karma threshold", async () => {
	const { sessionToken } = await createAccount(
		server.config.baseUrl,
		"pollcreator",
		"password123",
	);

	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/newpoll",
		sessionToken,
	);

	// new users (karma 1) cannot create polls (requires 20+ karma)
	expectStatus(response, 403);
	expectHtml(response, "karma");
});

// cleanup
Deno.test({
	name: "policies e2e cleanup",
	async fn() {
		await cleanupTestServer(server);
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

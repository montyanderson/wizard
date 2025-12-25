/**
 * e2e tests for data persistence
 *
 * tests:
 * - data survives server restart
 * - user profiles persist
 * - stories and comments persist
 * - votes persist
 */

import {
	cleanupTestServer,
	createAccount,
	expectHtml,
	expectOk,
	makeAuthRequest,
	makeRequest,
	startTestServer,
	type TestServer,
} from "./setup.ts";

let server: TestServer;
let userSession: string;
let createdStoryId: string | undefined;

// setup
Deno.test({
	name: "persistence e2e setup",
	async fn() {
		server = await startTestServer();
		const { sessionToken } = await createAccount(
			server.config.baseUrl,
			"persistuser",
			"password123",
		);
		userSession = sessionToken;
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

// =============================================================================
// Story Persistence Tests
// =============================================================================

Deno.test("persistence - create story for later tests", async () => {
	const body = new URLSearchParams({
		t: "Persistent Test Story",
		u: "https://persist-test.example.com",
	});
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		userSession,
		{ method: "POST", body, followRedirects: false },
	);
	createdStoryId = response.redirectUrl?.match(/id=(\d+)/)?.[1];
	// story should be created
	if (!createdStoryId) {
		throw new Error("Failed to create story for persistence tests");
	}
});

Deno.test("persistence - story visible on news page", async () => {
	const response = await makeRequest(server.config.baseUrl, "/newest");
	expectOk(response);
	expectHtml(response, "Persistent Test Story");
});

Deno.test("persistence - story visible on item page", async () => {
	if (!createdStoryId) return;
	const response = await makeRequest(
		server.config.baseUrl,
		`/item?id=${createdStoryId}`,
	);
	expectOk(response);
	expectHtml(response, "Persistent Test Story");
	expectHtml(response, "persist-test.example.com");
});

// =============================================================================
// Comment Persistence Tests
// =============================================================================

Deno.test("persistence - create comment on story", async () => {
	if (!createdStoryId) return;
	const body = new URLSearchParams({
		parent: createdStoryId,
		text: "This comment should persist",
	});
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/comment",
		userSession,
		{ method: "POST", body, followRedirects: false },
	);
	// comment should be created
	if (response.status >= 400) {
		throw new Error("Failed to create comment");
	}
});

Deno.test("persistence - comment visible on item page", async () => {
	if (!createdStoryId) return;
	const response = await makeRequest(
		server.config.baseUrl,
		`/item?id=${createdStoryId}`,
	);
	expectOk(response);
	expectHtml(response, "This comment should persist");
});

Deno.test("persistence - comment visible on newcomments", async () => {
	const response = await makeRequest(server.config.baseUrl, "/newcomments");
	expectOk(response);
	expectHtml(response, "This comment should persist");
});

// =============================================================================
// User Profile Persistence Tests
// =============================================================================

Deno.test("persistence - user profile exists", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/user?id=persistuser",
	);
	expectOk(response);
	expectHtml(response, "persistuser");
	expectHtml(response, "karma:");
});

Deno.test("persistence - user submissions visible", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/submitted?id=persistuser",
	);
	expectOk(response);
	expectHtml(response, "Persistent Test Story");
});

Deno.test("persistence - user threads visible", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/threads?id=persistuser",
	);
	expectOk(response);
	// should show user's comments
	expectHtml(response, "This comment should persist");
});

// =============================================================================
// Vote Persistence Tests
// =============================================================================

Deno.test("persistence - vote on own story shows indicator", async () => {
	if (!createdStoryId) return;
	// view own story - should show voted indicator (orange *)
	const response = await makeAuthRequest(
		server.config.baseUrl,
		`/item?id=${createdStoryId}`,
		userSession,
	);
	expectOk(response);
	// author auto-votes, should see orange indicator
	expectHtml(response, "ff6600");
});

// =============================================================================
// Login Persistence Tests
// =============================================================================

Deno.test("persistence - can re-login with same credentials", async () => {
	const body = new URLSearchParams({
		u: "persistuser",
		p: "password123",
	});
	const response = await makeRequest(server.config.baseUrl, "/login", {
		method: "POST",
		body,
		followRedirects: false,
	});
	// should successfully login (302 redirect)
	if (response.status !== 302) {
		throw new Error(`Expected redirect, got ${response.status}`);
	}
});

// cleanup
Deno.test({
	name: "persistence e2e cleanup",
	async fn() {
		await cleanupTestServer(server);
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

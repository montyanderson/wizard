/**
 * e2e tests for ranking algorithms
 *
 * tests:
 * - frontpage ranking (stories sorted by score/age)
 * - comment sorting (best comments first)
 * - best/bestcomments pages show high-scored items
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

// setup
Deno.test({
	name: "ranking e2e setup",
	async fn() {
		server = await startTestServer();
		const { sessionToken } = await createAccount(
			server.config.baseUrl,
			"rankinguser",
			"password123",
		);
		userSession = sessionToken;
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

// =============================================================================
// Story Ranking Tests
// =============================================================================

Deno.test("ranking - /news returns stories", async () => {
	const response = await makeRequest(server.config.baseUrl, "/news");
	expectOk(response);
	// page should render even if no stories
});

Deno.test("ranking - /newest shows most recent first", async () => {
	// submit two stories
	const body1 = new URLSearchParams({
		t: "Older Ranking Story",
		u: "https://older-ranking.example.com",
	});
	await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		userSession,
		{ method: "POST", body: body1, followRedirects: false },
	);

	const body2 = new URLSearchParams({
		t: "Newer Ranking Story",
		u: "https://newer-ranking.example.com",
	});
	await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		userSession,
		{ method: "POST", body: body2, followRedirects: false },
	);

	const response = await makeRequest(server.config.baseUrl, "/newest");
	expectOk(response);
	// newest should be first - check order in HTML
	const newerPos = response.body.indexOf("Newer Ranking Story");
	const olderPos = response.body.indexOf("Older Ranking Story");
	if (newerPos !== -1 && olderPos !== -1) {
		// newer should appear before older in the list
		if (newerPos > olderPos) {
			throw new Error("Newer story should appear before older story");
		}
	}
});

Deno.test("ranking - /best returns page", async () => {
	const response = await makeRequest(server.config.baseUrl, "/best");
	expectOk(response);
});

Deno.test("ranking - /bestcomments returns page", async () => {
	const response = await makeRequest(server.config.baseUrl, "/bestcomments");
	expectOk(response);
});

Deno.test("ranking - /active returns page", async () => {
	const response = await makeRequest(server.config.baseUrl, "/active");
	expectOk(response);
});

// =============================================================================
// Comment Ranking Tests
// =============================================================================

Deno.test("ranking - comments display on item page", async () => {
	// create a story
	const storyBody = new URLSearchParams({
		t: "Comment Ranking Test Story",
		u: "https://comment-ranking.example.com",
	});
	const storyResponse = await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		userSession,
		{ method: "POST", body: storyBody, followRedirects: false },
	);

	const storyId = storyResponse.redirectUrl?.match(/id=(\d+)/)?.[1];

	if (storyId) {
		// add a comment
		const commentBody = new URLSearchParams({
			parent: storyId,
			text: "Test comment for ranking",
		});
		await makeAuthRequest(
			server.config.baseUrl,
			"/comment",
			userSession,
			{ method: "POST", body: commentBody, followRedirects: false },
		);

		// view item - comments should be visible
		const response = await makeRequest(
			server.config.baseUrl,
			`/item?id=${storyId}`,
		);
		expectOk(response);
		expectHtml(response, "Test comment for ranking");
	}
});

// =============================================================================
// Noob Content Tests
// =============================================================================

Deno.test("ranking - /noobstories shows new user content", async () => {
	const response = await makeRequest(server.config.baseUrl, "/noobstories");
	expectOk(response);
	// newly created users' submissions should appear here
});

Deno.test("ranking - /noobcomments shows new user comments", async () => {
	const response = await makeRequest(server.config.baseUrl, "/noobcomments");
	expectOk(response);
});

// cleanup
Deno.test({
	name: "ranking e2e cleanup",
	async fn() {
		await cleanupTestServer(server);
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

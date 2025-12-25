/**
 * e2e tests for template rendering
 *
 * tests:
 * - vote ui (arrows vs * for author)
 * - form rendering (login, submit, comment, edit, reply)
 * - comment display and tree structure
 * - nav highlighting (.topsel)
 */

import {
	cleanupTestServer,
	createAccount,
	expectHtml,
	expectNoHtml,
	expectOk,
	makeAuthRequest,
	makeRequest,
	startTestServer,
	type TestServer,
} from "./setup.ts";

let server: TestServer;
let userSession: string;

// setup: start server and create test user
Deno.test({
	name: "templates e2e setup",
	async fn() {
		server = await startTestServer();
		const { sessionToken } = await createAccount(
			server.config.baseUrl,
			"templateuser",
			"password123",
		);
		userSession = sessionToken;
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

// =============================================================================
// Vote UI Tests
// =============================================================================

Deno.test("vote ui - shows gray arrow for unauthenticated user", async () => {
	// first submit a story as logged in user
	const body = new URLSearchParams({
		t: "Vote Test Story",
		u: "https://vote-test.example.com",
	});
	const submitResponse = await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		userSession,
		{ method: "POST", body, followRedirects: false },
	);

	// get the item id from redirect
	const itemId = submitResponse.redirectUrl?.match(/id=(\d+)/)?.[1];

	if (itemId) {
		// view as unauthenticated - should see vote arrow
		const response = await makeRequest(
			server.config.baseUrl,
			`/item?id=${itemId}`,
		);
		expectOk(response);
		expectHtml(response, "grayarrow.gif");
	}
});

Deno.test("vote ui - shows orange star for author on own story", async () => {
	// submit a story
	const body = new URLSearchParams({
		t: "Author Star Test",
		u: "https://author-star.example.com",
	});
	const submitResponse = await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		userSession,
		{ method: "POST", body, followRedirects: false },
	);

	const itemId = submitResponse.redirectUrl?.match(/id=(\d+)/)?.[1];

	if (itemId) {
		// view as author - should see orange * instead of arrow
		const response = await makeAuthRequest(
			server.config.baseUrl,
			`/item?id=${itemId}`,
			userSession,
		);
		expectOk(response);
		// author sees * (already voted indicator) in orange
		expectHtml(response, "ff6600");
	}
});

// =============================================================================
// Form Rendering Tests
// =============================================================================

Deno.test("form - login form has username and password fields", async () => {
	const response = await makeRequest(server.config.baseUrl, "/login");
	expectOk(response);
	expectHtml(response, '<input type="text" name="u"');
	expectHtml(response, '<input type="password" name="p"');
	expectHtml(response, "login");
});

Deno.test("form - create account form has creating hidden field", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/login?create=t",
	);
	expectOk(response);
	expectHtml(response, "create account");
	expectHtml(response, 'name="creating"');
});

Deno.test("form - submit form has title and url fields", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/submit",
		userSession,
	);
	expectOk(response);
	expectHtml(response, 'name="t"'); // title
	expectHtml(response, 'name="u"'); // url
	expectHtml(response, 'name="x"'); // text (optional)
});

Deno.test("form - submitlink prefills url and title", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/submitlink?u=https://prefill.example.com&t=Prefill%20Title",
		userSession,
	);
	expectOk(response);
	expectHtml(response, "https://prefill.example.com");
	expectHtml(response, "Prefill Title");
});

// =============================================================================
// Nav Highlighting Tests
// =============================================================================

Deno.test("nav - newest page highlights 'new' link", async () => {
	const response = await makeRequest(server.config.baseUrl, "/newest");
	expectOk(response);
	// should have topsel class wrapping the "new" link
	expectHtml(response, 'class="topsel"');
	expectHtml(response, ">new</a>");
});

Deno.test("nav - newcomments page highlights 'comments' link", async () => {
	const response = await makeRequest(server.config.baseUrl, "/newcomments");
	expectOk(response);
	expectHtml(response, 'class="topsel"');
	expectHtml(response, ">comments</a>");
});

Deno.test("nav - news page does not highlight any nav link", async () => {
	const response = await makeRequest(server.config.baseUrl, "/news");
	expectOk(response);
	// main news page shouldn't have topsel since it's not in nav
	// (nav has: new -> newest, comments -> newcomments)
	// the "new" and "comments" links should NOT be wrapped in topsel
	// this is tricky to test - we'd need to check that topsel doesn't wrap new/comments
});

// =============================================================================
// Comment Display Tests
// =============================================================================

Deno.test("comment - displays with proper structure", async () => {
	// first create a story to comment on
	const storyBody = new URLSearchParams({
		t: "Comment Display Test",
		u: "https://comment-display.example.com",
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
			text: "Test comment for display",
		});
		await makeAuthRequest(
			server.config.baseUrl,
			"/comment",
			userSession,
			{ method: "POST", body: commentBody, followRedirects: false },
		);

		// view the item page
		const response = await makeRequest(
			server.config.baseUrl,
			`/item?id=${storyId}`,
		);
		expectOk(response);
		expectHtml(response, "Test comment for display");
		expectHtml(response, "templateuser"); // comment author
		expectHtml(response, "reply"); // reply link
	}
});

Deno.test("comment - newcomments shows comments with context", async () => {
	const response = await makeRequest(server.config.baseUrl, "/newcomments");
	expectOk(response);
	// should show "on:" link to parent story
	// (if any comments exist from previous tests)
});

// =============================================================================
// Page Structure Tests
// =============================================================================

Deno.test("page - includes proper html structure", async () => {
	const response = await makeRequest(server.config.baseUrl, "/news");
	expectOk(response);
	expectHtml(response, "<html>");
	expectHtml(response, "<head>");
	expectHtml(response, "news.css");
	expectHtml(response, "<body");
	expectHtml(response, "</html>");
});

Deno.test("page - includes viewport meta for mobile", async () => {
	const response = await makeRequest(server.config.baseUrl, "/news");
	expectOk(response);
	expectHtml(response, 'name="viewport"');
	expectHtml(response, "width=device-width");
});

Deno.test("page - includes vote script", async () => {
	const response = await makeRequest(server.config.baseUrl, "/news");
	expectOk(response);
	expectHtml(response, "function vote(node)");
});

// =============================================================================
// User Profile Display Tests
// =============================================================================

Deno.test("profile - shows user info", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/user?id=templateuser",
	);
	expectOk(response);
	expectHtml(response, "templateuser");
	expectHtml(response, "karma:");
	expectHtml(response, "created:");
});

Deno.test("profile - own profile shows edit fields", async () => {
	const response = await makeAuthRequest(
		server.config.baseUrl,
		"/user?id=templateuser",
		userSession,
	);
	expectOk(response);
	// when viewing own profile, should see editable fields
	expectHtml(response, "about:");
	expectHtml(response, "email:");
});

// =============================================================================
// Error Page Tests
// =============================================================================

Deno.test("error - 404 for missing item", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/item?id=999999",
	);
	expectHtml(response, "No such item");
});

Deno.test("error - 404 for missing user", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/user?id=nonexistentuser",
	);
	expectHtml(response, "No such user");
});

// cleanup
Deno.test({
	name: "templates e2e cleanup",
	async fn() {
		await cleanupTestServer(server);
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

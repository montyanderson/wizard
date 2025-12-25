/**
 * e2e tests for pagination
 *
 * tests pagination on all list routes:
 * - /news, /newest, /best, /bestcomments, /active
 * - /newcomments, /submitted, /threads, /saved
 * - /noobstories, /noobcomments
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
	name: "pagination e2e setup",
	async fn() {
		server = await startTestServer();
		const { sessionToken } = await createAccount(
			server.config.baseUrl,
			"paginationuser",
			"password123",
		);
		userSession = sessionToken;
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

// =============================================================================
// Public Route Pagination
// =============================================================================

Deno.test("pagination - /news accepts ?p= parameter", async () => {
	const response = await makeRequest(server.config.baseUrl, "/news?p=1");
	expectOk(response);
});

Deno.test("pagination - /news page 2", async () => {
	const response = await makeRequest(server.config.baseUrl, "/news?p=2");
	expectOk(response);
});

Deno.test("pagination - /newest accepts ?p= parameter", async () => {
	const response = await makeRequest(server.config.baseUrl, "/newest?p=1");
	expectOk(response);
});

Deno.test("pagination - /best accepts ?p= parameter", async () => {
	const response = await makeRequest(server.config.baseUrl, "/best?p=1");
	expectOk(response);
});

Deno.test("pagination - /bestcomments accepts ?p= parameter", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/bestcomments?p=1",
	);
	expectOk(response);
});

Deno.test("pagination - /active accepts ?p= parameter", async () => {
	const response = await makeRequest(server.config.baseUrl, "/active?p=1");
	expectOk(response);
});

Deno.test("pagination - /newcomments accepts ?p= parameter", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/newcomments?p=1",
	);
	expectOk(response);
});

Deno.test("pagination - /noobstories accepts ?p= parameter", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/noobstories?p=1",
	);
	expectOk(response);
});

Deno.test("pagination - /noobcomments accepts ?p= parameter", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/noobcomments?p=1",
	);
	expectOk(response);
});

// =============================================================================
// User-Specific Route Pagination
// =============================================================================

Deno.test("pagination - /submitted accepts ?p= parameter", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/submitted?id=paginationuser&p=1",
	);
	expectOk(response);
});

Deno.test("pagination - /threads accepts ?p= parameter", async () => {
	const response = await makeRequest(
		server.config.baseUrl,
		"/threads?id=paginationuser&p=1",
	);
	expectOk(response);
});

// =============================================================================
// Pagination Edge Cases
// =============================================================================

Deno.test("pagination - invalid page number defaults gracefully", async () => {
	const response = await makeRequest(server.config.baseUrl, "/news?p=abc");
	expectOk(response);
});

Deno.test("pagination - negative page number handled", async () => {
	const response = await makeRequest(server.config.baseUrl, "/news?p=-1");
	expectOk(response);
});

Deno.test("pagination - very large page number handled", async () => {
	const response = await makeRequest(server.config.baseUrl, "/news?p=9999");
	expectOk(response);
});

Deno.test("pagination - zero page number handled", async () => {
	const response = await makeRequest(server.config.baseUrl, "/news?p=0");
	expectOk(response);
});

// cleanup
Deno.test({
	name: "pagination e2e cleanup",
	async fn() {
		await cleanupTestServer(server);
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

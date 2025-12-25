/**
 * e2e tests for authentication flows
 *
 * tests:
 * - login flow (valid/invalid credentials)
 * - account creation with validation
 * - logout flow
 * - session persistence
 * - password reset
 */

import { assertEquals } from "@std/assert";
import {
	cleanupTestServer,
	createAccount,
	expectHtml,
	expectOk,
	expectRedirect,
	login,
	makeAuthRequest,
	makeRequest,
	startTestServer,
	type TestServer,
} from "./setup.ts";

Deno.test({
	name: "auth e2e tests",
	async fn(t) {
		// start server
		const server = await startTestServer();

		try {
			// =================================================================
			// Login Flow
			// =================================================================

			await t.step("login - shows login form on GET", async () => {
				const response = await makeRequest(
					server.config.baseUrl,
					"/login",
				);
				expectOk(response);
				expectHtml(response, "Login");
				expectHtml(response, '<input type="text" name="u"');
				expectHtml(response, '<input type="password" name="p"');
			});

			await t.step("login - rejects empty username", async () => {
				const body = new URLSearchParams({ u: "", p: "password" });
				const response = await makeRequest(
					server.config.baseUrl,
					"/login",
					{
						method: "POST",
						body,
					},
				);
				expectOk(response);
				expectHtml(response, "bad login");
			});

			await t.step("login - rejects empty password", async () => {
				const body = new URLSearchParams({ u: "testuser", p: "" });
				const response = await makeRequest(
					server.config.baseUrl,
					"/login",
					{
						method: "POST",
						body,
					},
				);
				expectOk(response);
				expectHtml(response, "bad login");
			});

			await t.step("login - rejects invalid credentials", async () => {
				const body = new URLSearchParams({
					u: "nonexistent",
					p: "wrongpass",
				});
				const response = await makeRequest(
					server.config.baseUrl,
					"/login",
					{
						method: "POST",
						body,
					},
				);
				expectOk(response);
				expectHtml(response, "bad login");
			});

			// =================================================================
			// Account Creation
			// =================================================================

			await t.step("create account - creates new user", async () => {
				const { sessionToken, response } = await createAccount(
					server.config.baseUrl,
					"newuser1",
					"password123",
				);
				expectRedirect(response);
				assertEquals(sessionToken.length > 0, true);
			});

			await t.step(
				"create account - rejects short username",
				async () => {
					const body = new URLSearchParams({
						u: "a",
						p: "password123",
						creating: "t",
					});
					const response = await makeRequest(
						server.config.baseUrl,
						"/login",
						{
							method: "POST",
							body,
						},
					);
					expectOk(response);
					expectHtml(response, "username");
				},
			);

			await t.step("create account - rejects long username", async () => {
				const body = new URLSearchParams({
					u: "a".repeat(20),
					p: "password123",
					creating: "t",
				});
				const response = await makeRequest(
					server.config.baseUrl,
					"/login",
					{
						method: "POST",
						body,
					},
				);
				expectOk(response);
				expectHtml(response, "username");
			});

			await t.step(
				"create account - rejects short password",
				async () => {
					const body = new URLSearchParams({
						u: "testuser2",
						p: "abc",
						creating: "t",
					});
					const response = await makeRequest(
						server.config.baseUrl,
						"/login",
						{
							method: "POST",
							body,
						},
					);
					expectOk(response);
					expectHtml(response, "password");
				},
			);

			await t.step(
				"create account - rejects duplicate username",
				async () => {
					// first create succeeds
					await createAccount(
						server.config.baseUrl,
						"dupuser",
						"password123",
					);

					// second create with same name fails
					const body = new URLSearchParams({
						u: "dupuser",
						p: "password456",
						creating: "t",
					});
					const response = await makeRequest(
						server.config.baseUrl,
						"/login",
						{
							method: "POST",
							body,
						},
					);
					expectOk(response);
					expectHtml(response, "taken");
				},
			);

			// =================================================================
			// Login After Account Creation
			// =================================================================

			await t.step(
				"login - valid credentials after account creation",
				async () => {
					await createAccount(
						server.config.baseUrl,
						"logintest",
						"testpass123",
					);
					const { sessionToken, response } = await login(
						server.config.baseUrl,
						"logintest",
						"testpass123",
					);
					expectRedirect(response);
					assertEquals(sessionToken.length > 0, true);
				},
			);

			await t.step(
				"login - wrong password after account creation",
				async () => {
					await createAccount(
						server.config.baseUrl,
						"wrongpass",
						"correct",
					);
					const body = new URLSearchParams({
						u: "wrongpass",
						p: "incorrect",
					});
					const response = await makeRequest(
						server.config.baseUrl,
						"/login",
						{
							method: "POST",
							body,
						},
					);
					expectOk(response);
					expectHtml(response, "bad login");
				},
			);

			// =================================================================
			// Session Persistence
			// =================================================================

			await t.step("session - authenticated request works", async () => {
				const { sessionToken } = await createAccount(
					server.config.baseUrl,
					"sessionuser",
					"password123",
				);
				const response = await makeAuthRequest(
					server.config.baseUrl,
					"/whoami",
					sessionToken,
				);
				expectOk(response);
				expectHtml(response, "sessionuser");
			});

			await t.step(
				"session - unauthenticated request shows login",
				async () => {
					const response = await makeRequest(
						server.config.baseUrl,
						"/submit",
					);
					expectOk(response);
					expectHtml(response, "Login");
				},
			);

			// =================================================================
			// Logout
			// =================================================================

			await t.step("logout - clears session and redirects", async () => {
				const { sessionToken } = await createAccount(
					server.config.baseUrl,
					"logoutuser",
					"password123",
				);
				const response = await makeAuthRequest(
					server.config.baseUrl,
					"/logout",
					sessionToken,
					{ followRedirects: false },
				);
				expectRedirect(response);
			});

			// =================================================================
			// Password Reset
			// =================================================================

			await t.step("resetpw - shows form on GET", async () => {
				const response = await makeRequest(
					server.config.baseUrl,
					"/resetpw",
				);
				expectOk(response);
				expectHtml(response, "password");
			});

			// =================================================================
			// Public Routes Access
			// =================================================================

			await t.step(
				"public route - /news accessible without login",
				async () => {
					const response = await makeRequest(
						server.config.baseUrl,
						"/news",
					);
					expectOk(response);
				},
			);

			await t.step(
				"public route - /newest accessible without login",
				async () => {
					const response = await makeRequest(
						server.config.baseUrl,
						"/newest",
					);
					expectOk(response);
				},
			);

			await t.step(
				"public route - /leaders accessible without login",
				async () => {
					const response = await makeRequest(
						server.config.baseUrl,
						"/leaders",
					);
					expectOk(response);
					expectHtml(response, "Leaders");
				},
			);

			await t.step(
				"public route - /rss accessible without login",
				async () => {
					const response = await makeRequest(
						server.config.baseUrl,
						"/rss",
					);
					expectOk(response);
					expectHtml(response, "rss");
				},
			);

			// =================================================================
			// Protected Routes
			// =================================================================

			await t.step(
				"protected route - /submit requires login",
				async () => {
					const response = await makeRequest(
						server.config.baseUrl,
						"/submit",
					);
					expectOk(response);
					expectHtml(response, "Login");
				},
			);

			await t.step(
				"protected route - /submit accessible after login",
				async () => {
					const { sessionToken } = await createAccount(
						server.config.baseUrl,
						"submituser",
						"password123",
					);
					const response = await makeAuthRequest(
						server.config.baseUrl,
						"/submit",
						sessionToken,
					);
					expectOk(response);
					expectHtml(response, "title");
				},
			);
		} finally {
			// cleanup
			await cleanupTestServer(server);
		}
	},
	sanitizeResources: false,
	sanitizeOps: false,
});

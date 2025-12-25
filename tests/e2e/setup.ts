/**
 * e2e test infrastructure for wizard
 *
 * provides:
 * - test server harness with isolated data directories
 * - test data factories for users, stories, comments, votes, profiles
 * - helper functions for making authenticated requests
 * - cleanup utilities for test isolation
 */

import type { Item, Profile } from "../../src/lib/schemas.ts";
import { seconds } from "../../src/lib/ranking.ts";

// =============================================================================
// Test Server Configuration
// =============================================================================

export interface TestServerConfig {
	port: number;
	dataDir: string;
	baseUrl: string;
}

export interface TestServer {
	config: TestServerConfig;
	process: Deno.ChildProcess;
	cleanup: () => Promise<void>;
}

/**
 * start a test server instance with isolated data directory
 */
export async function startTestServer(
	port?: number,
): Promise<TestServer> {
	// find an available port if not specified
	const actualPort = port ?? await findAvailablePort();

	// create temporary data directory
	const dataDir = await Deno.makeTempDir({ prefix: "wizard_e2e_" });

	// create required subdirectories
	await Deno.mkdir(`${dataDir}/story`, { recursive: true });
	await Deno.mkdir(`${dataDir}/profile`, { recursive: true });
	await Deno.mkdir(`${dataDir}/vote`, { recursive: true });
	await Deno.mkdir(`${dataDir}/password`, { recursive: true });
	await Deno.mkdir(`${dataDir}/session`, { recursive: true });

	// create default config
	await Deno.writeTextFile(
		`${dataDir}/config.json`,
		JSON.stringify({
			thisSite: "Test News",
			siteUrl: `http://localhost:${actualPort}/`,
			parentUrl: "",
			faviconUrl: "/favicon.ico",
			logoUrl: "/logo.gif",
			siteDesc: "Test news site",
			siteColour: "ff6600",
			borderColour: "ff6600",
		}),
	);

	// start the server process with environment variables
	const command = new Deno.Command("deno", {
		args: [
			"run",
			"--allow-all",
			"src/main.ts",
		],
		cwd: Deno.cwd(),
		stdout: "piped",
		stderr: "piped",
		env: {
			...Deno.env.toObject(),
			NEWS_PORT: String(actualPort),
			NEWS_DATA_DIR: dataDir,
		},
	});

	const process = command.spawn();

	// wait for server to be ready
	await waitForServer(`http://localhost:${actualPort}/news`, 5000);

	const config: TestServerConfig = {
		port: actualPort,
		dataDir,
		baseUrl: `http://localhost:${actualPort}`,
	};

	const cleanup = async () => {
		try {
			process.kill("SIGTERM");
			await process.status;
		} catch {
			// process may already be dead
		}
		try {
			await Deno.remove(dataDir, { recursive: true });
		} catch {
			// directory may already be removed
		}
	};

	return { config, process, cleanup };
}

/**
 * find an available port
 */
async function findAvailablePort(): Promise<number> {
	const listener = Deno.listen({ port: 0 });
	const { port } = listener.addr as Deno.NetAddr;
	listener.close();
	return port;
}

/**
 * wait for server to respond
 */
async function waitForServer(url: string, timeoutMs: number): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const response = await fetch(url);
			await response.body?.cancel();
			if (response.ok) return;
		} catch {
			// server not ready yet
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`Server did not start within ${timeoutMs}ms`);
}

// =============================================================================
// Data Factories
// =============================================================================

let testIdCounter = 1;

/**
 * create a test user profile
 */
export function createTestProfile(overrides: Partial<Profile> = {}): Profile {
	const id = overrides.id ?? `testuser${testIdCounter++}`;
	return {
		id,
		name: null,
		created: seconds(),
		auth: 0,
		member: true,
		submitted: [],
		votes: [],
		karma: 1,
		avg: null,
		weight: 1.0,
		ignore: false,
		email: null,
		about: null,
		showdead: false,
		noprocrast: false,
		firstview: null,
		lastview: null,
		maxvisit: 20,
		minaway: 180,
		topcolor: null,
		keys: [],
		delay: 0,
		...overrides,
	};
}

/**
 * create a test story item
 */
export function createTestStory(overrides: Partial<Item> = {}): Item {
	const id = overrides.id ?? testIdCounter++;
	const by = overrides.by ?? `testuser${testIdCounter}`;
	const now = seconds();
	return {
		id,
		type: "story",
		by,
		ip: "127.0.0.1",
		time: now,
		url: overrides.url ?? "https://example.com",
		title: overrides.title ?? `Test Story ${id}`,
		text: overrides.text ?? null,
		votes: [{ time: now, ip: "127.0.0.1", user: by, dir: "up", score: 1 }],
		score: 1,
		sockvotes: 0,
		flags: [],
		dead: false,
		deleted: false,
		parts: [],
		parent: null,
		kids: [],
		keys: [],
		...overrides,
	};
}

/**
 * create a test comment item
 */
export function createTestComment(overrides: Partial<Item> = {}): Item {
	const id = overrides.id ?? testIdCounter++;
	const by = overrides.by ?? `testuser${testIdCounter}`;
	const now = seconds();
	return {
		id,
		type: "comment",
		by,
		ip: "127.0.0.1",
		time: now,
		url: null,
		title: null,
		text: overrides.text ?? `Test comment ${id}`,
		votes: [{ time: now, ip: "127.0.0.1", user: by, dir: "up", score: 1 }],
		score: 1,
		sockvotes: 0,
		flags: [],
		dead: false,
		deleted: false,
		parts: [],
		parent: overrides.parent ?? null,
		kids: [],
		keys: [],
		...overrides,
	};
}

/**
 * create a test poll item
 */
export function createTestPoll(overrides: Partial<Item> = {}): Item {
	const id = overrides.id ?? testIdCounter++;
	const by = overrides.by ?? `testuser${testIdCounter}`;
	const now = seconds();
	return {
		id,
		type: "poll",
		by,
		ip: "127.0.0.1",
		time: now,
		url: null,
		title: overrides.title ?? `Test Poll ${id}`,
		text: overrides.text ?? null,
		votes: [{ time: now, ip: "127.0.0.1", user: by, dir: "up", score: 1 }],
		score: 1,
		sockvotes: 0,
		flags: [],
		dead: false,
		deleted: false,
		parts: [],
		parent: null,
		kids: [],
		keys: [],
		...overrides,
	};
}

// =============================================================================
// Request Helpers
// =============================================================================

export interface RequestOptions {
	method?: "GET" | "POST";
	body?: URLSearchParams | FormData | string;
	cookies?: Map<string, string>;
	headers?: Record<string, string>;
	followRedirects?: boolean;
}

export interface TestResponse {
	status: number;
	headers: Headers;
	body: string;
	cookies: Map<string, string>;
	redirectUrl?: string;
}

/**
 * make an http request to the test server
 */
export async function makeRequest(
	baseUrl: string,
	path: string,
	options: RequestOptions = {},
): Promise<TestResponse> {
	const url = `${baseUrl}${path}`;
	const method = options.method ?? "GET";

	const headers: Record<string, string> = {
		...options.headers,
	};

	// add cookies to request
	if (options.cookies && options.cookies.size > 0) {
		const cookieStr = Array.from(options.cookies.entries())
			.map(([k, v]) => `${k}=${v}`)
			.join("; ");
		headers["Cookie"] = cookieStr;
	}

	// set content type for POST with body
	if (method === "POST" && options.body) {
		if (options.body instanceof URLSearchParams) {
			headers["Content-Type"] = "application/x-www-form-urlencoded";
		}
	}

	const fetchOptions: RequestInit = {
		method,
		headers,
		redirect: options.followRedirects === false ? "manual" : "follow",
	};

	if (options.body) {
		fetchOptions.body = options.body.toString();
	}

	const response = await fetch(url, fetchOptions);
	const body = await response.text();

	// parse response cookies
	const cookies = new Map<string, string>();
	const setCookieHeaders = response.headers.getSetCookie();
	for (const header of setCookieHeaders) {
		const match = header.match(/^([^=]+)=([^;]*)/);
		if (match) {
			cookies.set(match[1], match[2]);
		}
	}

	// check for redirect
	let redirectUrl: string | undefined;
	if (response.status >= 300 && response.status < 400) {
		redirectUrl = response.headers.get("Location") ?? undefined;
	}

	return {
		status: response.status,
		headers: response.headers,
		body,
		cookies,
		redirectUrl,
	};
}

/**
 * make an authenticated request with user session
 */
export async function makeAuthRequest(
	baseUrl: string,
	path: string,
	sessionToken: string,
	options: RequestOptions = {},
): Promise<TestResponse> {
	const cookies = options.cookies ?? new Map();
	cookies.set("user", sessionToken);
	return makeRequest(baseUrl, path, { ...options, cookies });
}

/**
 * login as a user and return session token
 */
export async function login(
	baseUrl: string,
	username: string,
	password: string,
): Promise<{ sessionToken: string; response: TestResponse }> {
	const body = new URLSearchParams({
		u: username,
		p: password,
	});

	const response = await makeRequest(baseUrl, "/login", {
		method: "POST",
		body,
		followRedirects: false,
	});

	const sessionToken = response.cookies.get("user") ?? "";
	return { sessionToken, response };
}

/**
 * create a new account
 */
export async function createAccount(
	baseUrl: string,
	username: string,
	password: string,
): Promise<{ sessionToken: string; response: TestResponse }> {
	const body = new URLSearchParams({
		u: username,
		p: password,
		creating: "t",
	});

	const response = await makeRequest(baseUrl, "/login", {
		method: "POST",
		body,
		followRedirects: false,
	});

	const sessionToken = response.cookies.get("user") ?? "";
	return { sessionToken, response };
}

// =============================================================================
// Assertion Helpers
// =============================================================================

/**
 * assert response contains html substring
 */
export function expectHtml(response: TestResponse, substring: string): void {
	if (!response.body.includes(substring)) {
		throw new Error(
			`Expected response to contain "${substring}" but got:\n${
				response.body.slice(0, 500)
			}...`,
		);
	}
}

/**
 * assert response does not contain html substring
 */
export function expectNoHtml(response: TestResponse, substring: string): void {
	if (response.body.includes(substring)) {
		throw new Error(
			`Expected response NOT to contain "${substring}" but it did`,
		);
	}
}

/**
 * assert response is a redirect
 */
export function expectRedirect(
	response: TestResponse,
	expectedLocation?: string,
): void {
	if (response.status < 300 || response.status >= 400) {
		throw new Error(
			`Expected redirect but got status ${response.status}`,
		);
	}
	if (expectedLocation && response.redirectUrl !== expectedLocation) {
		throw new Error(
			`Expected redirect to "${expectedLocation}" but got "${response.redirectUrl}"`,
		);
	}
}

/**
 * assert response status
 */
export function expectStatus(response: TestResponse, status: number): void {
	if (response.status !== status) {
		throw new Error(
			`Expected status ${status} but got ${response.status}`,
		);
	}
}

/**
 * assert response is ok (2xx)
 */
export function expectOk(response: TestResponse): void {
	if (response.status < 200 || response.status >= 300) {
		throw new Error(
			`Expected 2xx status but got ${response.status}`,
		);
	}
}

// =============================================================================
// Data Seeding Helpers
// =============================================================================

/**
 * seed a user with specific karma
 */
export async function seedUserWithKarma(
	dataDir: string,
	username: string,
	karma: number,
	password: string = "test1234",
): Promise<void> {
	const profile = createTestProfile({
		id: username,
		karma,
	});

	await Deno.writeTextFile(
		`${dataDir}/profile/${username}.json`,
		JSON.stringify(profile),
	);

	// create password file (sha256 hash of "test1234")
	// note: actual password hashing would be done by the auth module
	await Deno.writeTextFile(
		`${dataDir}/password/${username}`,
		password,
	);
}

/**
 * seed a story item
 */
export async function seedStory(
	dataDir: string,
	story: Item,
): Promise<void> {
	await Deno.writeTextFile(
		`${dataDir}/story/${story.id}.json`,
		JSON.stringify(story),
	);
}

/**
 * seed a comment item
 */
export async function seedComment(
	dataDir: string,
	comment: Item,
): Promise<void> {
	await Deno.writeTextFile(
		`${dataDir}/story/${comment.id}.json`,
		JSON.stringify(comment),
	);
}

// =============================================================================
// Cleanup
// =============================================================================

/**
 * reset test id counter between test suites
 */
export function resetTestIds(): void {
	testIdCounter = 1;
}

/**
 * cleanup test server and data
 */
export async function cleanupTestServer(server: TestServer): Promise<void> {
	await server.cleanup();
}

// =============================================================================
// Exports
// =============================================================================

export { seconds };

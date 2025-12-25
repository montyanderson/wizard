/**
 * tests for http server
 */

import { assertEquals, assertExists } from "@std/assert";
import {
	arg,
	clearCookie,
	CONTENT_TYPES,
	cookie,
	createServerConfig,
	errorResponse,
	getClientIp,
	htmlResponse,
	notFoundResponse,
	parseArgs,
	parseCookies,
	parseRequest,
	redirectResponse,
	type Request,
	Router,
	serveStatic,
	setCookie,
	toDenoResponse,
} from "../src/lib/server.ts";

// =============================================================================
// Config
// =============================================================================

Deno.test("createServerConfig - default values", () => {
	const config = createServerConfig();
	assertEquals(config.port, 8080);
	assertEquals(config.staticDir, "static");
	assertEquals(config.threadLifeMs, 30000);
});

Deno.test("createServerConfig - with overrides", () => {
	const config = createServerConfig({ port: 3000, staticDir: "public" });
	assertEquals(config.port, 3000);
	assertEquals(config.staticDir, "public");
	assertEquals(config.threadLifeMs, 30000);
});

// =============================================================================
// Content types
// =============================================================================

Deno.test("CONTENT_TYPES - has expected types", () => {
	assertEquals(CONTENT_TYPES[".gif"], "image/gif");
	assertEquals(CONTENT_TYPES[".jpg"], "image/jpeg");
	assertEquals(CONTENT_TYPES[".png"], "image/png");
	assertEquals(CONTENT_TYPES[".css"], "text/css; charset=utf-8");
	assertEquals(CONTENT_TYPES[".html"], "text/html; charset=utf-8");
});

// =============================================================================
// Parsing
// =============================================================================

Deno.test("parseArgs - parses query string", () => {
	const args = parseArgs("foo=bar&baz=qux");
	assertEquals(args.get("foo"), "bar");
	assertEquals(args.get("baz"), "qux");
});

Deno.test("parseArgs - handles url encoding", () => {
	const args = parseArgs("name=hello%20world&val=%26%3D");
	assertEquals(args.get("name"), "hello world");
	assertEquals(args.get("val"), "&=");
});

Deno.test("parseArgs - handles empty values", () => {
	const args = parseArgs("foo=&bar=value");
	assertEquals(args.get("foo"), "");
	assertEquals(args.get("bar"), "value");
});

Deno.test("parseArgs - handles missing values", () => {
	const args = parseArgs("foo&bar=value");
	assertEquals(args.get("foo"), "");
	assertEquals(args.get("bar"), "value");
});

Deno.test("parseArgs - empty string", () => {
	const args = parseArgs("");
	assertEquals(args.size, 0);
});

Deno.test("parseCookies - parses cookie header", () => {
	const cookies = parseCookies("user=abc123; session=xyz789");
	assertEquals(cookies.get("user"), "abc123");
	assertEquals(cookies.get("session"), "xyz789");
});

Deno.test("parseCookies - handles spaces", () => {
	const cookies = parseCookies("  user = abc123 ;  session=xyz789  ");
	assertEquals(cookies.get("user"), "abc123");
	assertEquals(cookies.get("session"), "xyz789");
});

Deno.test("parseCookies - handles values with equals", () => {
	const cookies = parseCookies("token=abc=def=ghi");
	assertEquals(cookies.get("token"), "abc=def=ghi");
});

Deno.test("parseCookies - null header", () => {
	const cookies = parseCookies(null);
	assertEquals(cookies.size, 0);
});

// =============================================================================
// Responses
// =============================================================================

Deno.test("htmlResponse - creates html response", () => {
	const response = htmlResponse("<html></html>");
	assertEquals(response.status, 200);
	assertEquals(
		response.headers.get("Content-Type"),
		"text/html; charset=utf-8",
	);
	assertEquals(response.body, "<html></html>");
});

Deno.test("htmlResponse - with custom status", () => {
	const response = htmlResponse("<html></html>", 404);
	assertEquals(response.status, 404);
});

Deno.test("htmlResponse - with custom headers", () => {
	const response = htmlResponse("<html></html>", 200, {
		"X-Custom": "value",
	});
	assertEquals(response.headers.get("X-Custom"), "value");
});

Deno.test("redirectResponse - creates redirect", () => {
	const response = redirectResponse("/new-location");
	assertEquals(response.status, 302);
	assertEquals(response.headers.get("Location"), "/new-location");
});

Deno.test("errorResponse - creates error response", () => {
	const response = errorResponse("Something went wrong", 500);
	assertEquals(response.status, 500);
	assertEquals(
		typeof response.body === "string" &&
			response.body.includes("Something went wrong"),
		true,
	);
});

Deno.test("notFoundResponse - creates 404", () => {
	const response = notFoundResponse();
	assertEquals(response.status, 404);
	assertEquals(
		typeof response.body === "string" && response.body.includes("Unknown"),
		true,
	);
});

// =============================================================================
// Static files
// =============================================================================

Deno.test("serveStatic - rejects directory traversal", async () => {
	const result = await serveStatic("static", "../etc/passwd");
	assertEquals(result, null);
});

Deno.test("serveStatic - rejects double slash", async () => {
	const result = await serveStatic("static", "foo//bar.txt");
	assertEquals(result, null);
});

Deno.test("serveStatic - rejects unknown extension", async () => {
	const result = await serveStatic("static", "file.xyz");
	assertEquals(result, null);
});

Deno.test("serveStatic - serves existing file", async () => {
	// create temp file
	const tempDir = await Deno.makeTempDir();
	await Deno.writeTextFile(`${tempDir}/test.txt`, "hello world");

	const result = await serveStatic(tempDir, "test.txt", 3600);

	assertExists(result);
	assertEquals(result.status, 200);
	assertEquals(
		result.headers.get("Content-Type"),
		"text/plain; charset=utf-8",
	);
	assertEquals(result.headers.get("Cache-Control"), "max-age=3600");

	await Deno.remove(tempDir, { recursive: true });
});

Deno.test("serveStatic - returns null for missing file", async () => {
	const result = await serveStatic("static", "nonexistent.txt");
	assertEquals(result, null);
});

// =============================================================================
// Router
// =============================================================================

Deno.test("Router - defop registers handler", async () => {
	const router = new Router();
	router.defop("test", () => htmlResponse("test page"));

	const req = createMockRequest("test");
	const response = await router.handle(req);

	assertEquals(response.status, 200);
	assertEquals(response.body, "test page");
});

Deno.test("Router - defop with cache", async () => {
	const router = new Router();
	router.defop("cached", () => htmlResponse("cached page"), 3600);

	const req = createMockRequest("cached");
	const response = await router.handle(req);

	assertEquals(response.headers.get("Cache-Control"), "max-age=3600");
});

Deno.test("Router - defopr registers redirect", async () => {
	const router = new Router();
	router.defopr("old", () => "/new");

	const req = createMockRequest("old");
	const response = await router.handle(req);

	assertEquals(response.status, 302);
	assertEquals(response.headers.get("Location"), "/new");
});

Deno.test("Router - returns 404 for unknown route", async () => {
	const router = new Router();

	const req = createMockRequest("unknown");
	const response = await router.handle(req);

	assertEquals(response.status, 404);
});

Deno.test("Router - listRoutes returns all routes", () => {
	const router = new Router();
	router.defop("foo", () => htmlResponse("foo"));
	router.defop("bar", () => htmlResponse("bar"));
	router.defopr("baz", () => "/redirect");

	const routes = router.listRoutes();
	assertEquals(routes.includes("foo"), true);
	assertEquals(routes.includes("bar"), true);
	assertEquals(routes.includes("baz"), true);
});

Deno.test("Router - async handlers", async () => {
	const router = new Router();
	router.defop("async", async () => {
		await new Promise((resolve) => setTimeout(resolve, 10));
		return htmlResponse("async result");
	});

	const req = createMockRequest("async");
	const response = await router.handle(req);

	assertEquals(response.body, "async result");
});

// =============================================================================
// Request helpers
// =============================================================================

Deno.test("arg - gets argument", () => {
	const req = createMockRequest("test", { id: "123", name: "foo" });
	assertEquals(arg(req, "id"), "123");
	assertEquals(arg(req, "name"), "foo");
	assertEquals(arg(req, "missing"), undefined);
});

Deno.test("cookie - gets cookie", () => {
	const req = createMockRequest("test", {}, { user: "abc" });
	assertEquals(cookie(req, "user"), "abc");
	assertEquals(cookie(req, "missing"), undefined);
});

// =============================================================================
// Cookie helpers
// =============================================================================

Deno.test("setCookie - basic", () => {
	const value = setCookie("user", "abc123");
	assertEquals(value, "user=abc123");
});

Deno.test("setCookie - with options", () => {
	const value = setCookie("user", "abc123", {
		path: "/",
		maxAge: 3600,
		httpOnly: true,
		secure: true,
		sameSite: "Strict",
	});

	assertEquals(value.includes("user=abc123"), true);
	assertEquals(value.includes("Path=/"), true);
	assertEquals(value.includes("Max-Age=3600"), true);
	assertEquals(value.includes("HttpOnly"), true);
	assertEquals(value.includes("Secure"), true);
	assertEquals(value.includes("SameSite=Strict"), true);
});

Deno.test("setCookie - encodes value", () => {
	const value = setCookie("name", "hello world");
	assertEquals(value, "name=hello%20world");
});

Deno.test("clearCookie - creates expired cookie", () => {
	const value = clearCookie("user");
	assertEquals(value, "user=; Path=/; Max-Age=0");
});

Deno.test("clearCookie - with custom path", () => {
	const value = clearCookie("user", "/admin");
	assertEquals(value, "user=; Path=/admin; Max-Age=0");
});

// =============================================================================
// Response conversion
// =============================================================================

Deno.test("toDenoResponse - converts response", () => {
	const response = htmlResponse("<html></html>", 200, {
		"X-Custom": "value",
	});
	const denoResponse = toDenoResponse(response);

	assertEquals(denoResponse.status, 200);
	assertEquals(
		denoResponse.headers.get("Content-Type"),
		"text/html; charset=utf-8",
	);
	assertEquals(denoResponse.headers.get("X-Custom"), "value");
});

// =============================================================================
// Client IP tests
// =============================================================================

Deno.test("getClientIp - from x-forwarded-for", () => {
	const req = new globalThis.Request("http://localhost/test", {
		headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
	});
	const connInfo = {
		remoteAddr: { hostname: "127.0.0.1", port: 12345, transport: "tcp" },
	} as Deno.ServeHandlerInfo;
	const ip = getClientIp(req, connInfo);
	assertEquals(ip, "1.2.3.4");
});

Deno.test("getClientIp - from x-real-ip", () => {
	const req = new globalThis.Request("http://localhost/test", {
		headers: { "x-real-ip": "9.8.7.6" },
	});
	const connInfo = {
		remoteAddr: { hostname: "127.0.0.1", port: 12345, transport: "tcp" },
	} as Deno.ServeHandlerInfo;
	const ip = getClientIp(req, connInfo);
	assertEquals(ip, "9.8.7.6");
});

Deno.test("getClientIp - from connection info", () => {
	const req = new globalThis.Request("http://localhost/test");
	const connInfo = {
		remoteAddr: { hostname: "192.168.1.1", port: 12345, transport: "tcp" },
	} as Deno.ServeHandlerInfo;
	const ip = getClientIp(req, connInfo);
	assertEquals(ip, "192.168.1.1");
});

// =============================================================================
// Request parsing tests
// =============================================================================

Deno.test("parseRequest - GET request", async () => {
	const raw = new globalThis.Request("http://localhost/test?foo=bar");
	const connInfo = {
		remoteAddr: { hostname: "127.0.0.1", port: 12345, transport: "tcp" },
	} as Deno.ServeHandlerInfo;
	const req = await parseRequest(raw, connInfo);
	assertEquals(req.method, "GET");
	assertEquals(req.op, "test");
	assertEquals(req.args.get("foo"), "bar");
	assertEquals(req.ip, "127.0.0.1");
});

Deno.test("parseRequest - POST with form data", async () => {
	const raw = new globalThis.Request("http://localhost/submit", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: "title=Test&url=http://example.com",
	});
	const connInfo = {
		remoteAddr: { hostname: "127.0.0.1", port: 12345, transport: "tcp" },
	} as Deno.ServeHandlerInfo;
	const req = await parseRequest(raw, connInfo);
	assertEquals(req.method, "POST");
	assertEquals(req.args.get("title"), "Test");
	assertEquals(req.args.get("url"), "http://example.com");
});

Deno.test("parseRequest - POST with non-form body", async () => {
	const raw = new globalThis.Request("http://localhost/api", {
		method: "POST",
		headers: { "content-type": "text/plain" },
		body: "raw text body",
	});
	const connInfo = {
		remoteAddr: { hostname: "127.0.0.1", port: 12345, transport: "tcp" },
	} as Deno.ServeHandlerInfo;
	const req = await parseRequest(raw, connInfo);
	assertEquals(req.method, "POST");
	assertEquals(req.body, "raw text body");
});

Deno.test("parseRequest - default op is news", async () => {
	const raw = new globalThis.Request("http://localhost/");
	const connInfo = {
		remoteAddr: { hostname: "127.0.0.1", port: 12345, transport: "tcp" },
	} as Deno.ServeHandlerInfo;
	const req = await parseRequest(raw, connInfo);
	assertEquals(req.op, "news");
});

// =============================================================================
// Helpers
// =============================================================================

function createMockRequest(
	op: string,
	args: Record<string, string> = {},
	cookies: Record<string, string> = {},
): Request {
	const argsMap = new Map<string, string>();
	for (const [k, v] of Object.entries(args)) {
		argsMap.set(k, v);
	}

	const cookiesMap = new Map<string, string>();
	for (const [k, v] of Object.entries(cookies)) {
		cookiesMap.set(k, v);
	}

	return {
		method: "GET",
		path: `/${op}`,
		op,
		args: argsMap,
		cookies: cookiesMap,
		ip: "127.0.0.1",
		body: null,
		raw: new globalThis.Request(`http://localhost/${op}`),
	};
}

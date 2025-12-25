/**
 * http server for arc news clone
 *
 * based on arc3.2/srv.arc
 * uses deno's built-in http server (no frameworks)
 */

import { join } from "@std/path";

/**
 * parsed request from client
 *
 * arc: (deftem request
 *        args  nil
 *        cooks nil
 *        ip    nil)
 */
export interface Request {
	method: "GET" | "POST";
	path: string;
	op: string;
	args: Map<string, string>;
	cookies: Map<string, string>;
	ip: string;
	body: string | null;
	raw: globalThis.Request;
}

/**
 * response to send to client
 */
export interface Response {
	status: number;
	headers: Map<string, string>;
	body: string | Uint8Array;
}

/**
 * route handler function
 */
export type RouteHandler = (req: Request) => Promise<Response> | Response;

/**
 * redirect handler function (returns redirect url)
 */
export type RedirectHandler = (req: Request) => Promise<string> | string;

/**
 * server configuration
 */
export interface ServerConfig {
	port: number;
	staticDir: string;
	threadLifeMs: number;
}

export function createServerConfig(
	overrides: Partial<ServerConfig> = {},
): ServerConfig {
	return {
		port: 8080,
		staticDir: "static",
		threadLifeMs: 30000,
		...overrides,
	};
}

/**
 * content type headers for static files
 *
 * arc: (map (fn ((k v)) (= (type-header* k) (gen-type-header v)))
 *          '((gif "image/gif") (jpg "image/jpeg") (png "image/png")
 *            (text/html "text/html; charset=utf-8")))
 */
export const CONTENT_TYPES: Record<string, string> = {
	".gif": "image/gif",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".css": "text/css; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".ico": "image/x-icon",
};

/**
 * parse query string args
 *
 * arc: (def parseargs (s)
 *        (map (fn ((k v)) (list k (urldecode v)))
 *             (map [tokens _ #\=] (tokens s #\&))))
 */
export function parseArgs(queryString: string): Map<string, string> {
	// arc: (def parseargs (s)
	//        (map (fn ((k v)) (list k (urldecode v)))
	//             (map [tokens _ #\=] (tokens s #\&))))
	// note: + is used for spaces in application/x-www-form-urlencoded
	const args = new Map<string, string>();
	if (!queryString) return args;

	const pairs = queryString.split("&");
	for (const pair of pairs) {
		const [key, value] = pair.split("=");
		if (key) {
			// replace + with space before decoding (form encoding)
			const decoded = decodeURIComponent(
				(value || "").replace(/\+/g, " "),
			);
			args.set(key, decoded);
		}
	}
	return args;
}

/**
 * parse cookies from cookie header
 *
 * arc: (def parsecookies (s)
 *        (map [tokens _ #\=]
 *             (cdr (tokens s [or (whitec _) (is _ #\;)]))))
 */
export function parseCookies(cookieHeader: string | null): Map<string, string> {
	const cookies = new Map<string, string>();
	if (!cookieHeader) return cookies;

	const pairs = cookieHeader.split(";");
	for (const pair of pairs) {
		const [key, ...valueParts] = pair.trim().split("=");
		if (key) {
			cookies.set(key.trim(), valueParts.join("=").trim());
		}
	}
	return cookies;
}

/**
 * get client ip from request
 */
export function getClientIp(
	req: globalThis.Request,
	connInfo: Deno.ServeHandlerInfo,
): string {
	// check forwarded headers first (for proxies)
	const forwarded = req.headers.get("x-forwarded-for");
	if (forwarded) {
		const ips = forwarded.split(",");
		return ips[0].trim();
	}

	const realIp = req.headers.get("x-real-ip");
	if (realIp) return realIp;

	// fall back to connection info
	const addr = connInfo.remoteAddr as Deno.NetAddr;
	return addr.hostname;
}

/**
 * parse incoming request
 */
export async function parseRequest(
	raw: globalThis.Request,
	connInfo: Deno.ServeHandlerInfo,
): Promise<Request> {
	const url = new URL(raw.url);
	const method = raw.method.toUpperCase() as "GET" | "POST";

	// arc: (sym (cut base 1)) - strips leading /
	const path = url.pathname;
	const op = path.slice(1) || "news"; // default to "news" like arc

	// parse query args
	const args = parseArgs(url.search.slice(1));

	// for POST, also parse body as form data
	let body: string | null = null;
	if (method === "POST") {
		const contentType = raw.headers.get("content-type") || "";
		if (contentType.includes("application/x-www-form-urlencoded")) {
			body = await raw.text();
			const bodyArgs = parseArgs(body);
			for (const [key, value] of bodyArgs) {
				args.set(key, value);
			}
		} else {
			body = await raw.text();
		}
	}

	return {
		method,
		path,
		op,
		args,
		cookies: parseCookies(raw.headers.get("cookie")),
		ip: getClientIp(raw, connInfo),
		body,
		raw,
	};
}

/**
 * create html response
 */
export function htmlResponse(
	body: string,
	status: number = 200,
	headers: Record<string, string> = {},
): Response {
	const responseHeaders = new Map<string, string>();
	responseHeaders.set("Content-Type", "text/html; charset=utf-8");
	responseHeaders.set("Connection", "close");

	for (const [key, value] of Object.entries(headers)) {
		responseHeaders.set(key, value);
	}

	return { status, headers: responseHeaders, body };
}

/**
 * create redirect response
 *
 * arc: (= rdheader* "HTTP/1.0 302 Moved")
 */
export function redirectResponse(location: string): Response {
	const headers = new Map<string, string>();
	headers.set("Location", location);
	return { status: 302, headers, body: "" };
}

/**
 * create error response
 */
export function errorResponse(message: string, status: number = 500): Response {
	return htmlResponse(`<html><body>${message}</body></html>`, status);
}

/**
 * create not found response
 */
export function notFoundResponse(): Response {
	return htmlResponse("<html><body>Unknown.</body></html>", 404);
}

/**
 * serve static file
 *
 * arc: respond with static file logic (lines 221-230)
 */
export async function serveStatic(
	staticDir: string,
	filename: string,
	maxAge?: number,
): Promise<Response | null> {
	// security: prevent directory traversal
	if (filename.includes("..") || filename.includes("//")) {
		return null;
	}

	const ext = "." + filename.split(".").pop()?.toLowerCase();
	const contentType = CONTENT_TYPES[ext];
	if (!contentType) return null;

	const filepath = join(staticDir, filename);

	try {
		const data = await Deno.readFile(filepath);
		const headers = new Map<string, string>();
		headers.set("Content-Type", contentType);
		headers.set("Connection", "close");

		if (maxAge !== undefined) {
			headers.set("Cache-Control", `max-age=${maxAge}`);
		}

		return { status: 200, headers, body: data };
	} catch {
		return null;
	}
}

/**
 * simple router
 */
export class Router {
	private routes = new Map<string, RouteHandler>();
	private redirects = new Map<string, RedirectHandler>();
	private maxAge = new Map<string, number>();

	/**
	 * register a route handler
	 *
	 * arc: (mac defop (name parm . body) ...)
	 */
	defop(name: string, handler: RouteHandler, cacheSeconds?: number): void {
		this.routes.set(name, handler);
		if (cacheSeconds !== undefined) {
			this.maxAge.set(name, cacheSeconds);
		}
	}

	/**
	 * register a redirect handler
	 *
	 * arc: (mac defopr (name parm . body) ...)
	 */
	defopr(name: string, handler: RedirectHandler): void {
		this.redirects.set(name, handler);
	}

	/**
	 * handle a request
	 */
	async handle(req: Request): Promise<Response> {
		const op = req.op;

		// check for redirect handler
		const redirectHandler = this.redirects.get(op);
		if (redirectHandler) {
			const location = await redirectHandler(req);
			return redirectResponse(location);
		}

		// check for regular handler
		const handler = this.routes.get(op);
		if (handler) {
			const response = await handler(req);

			// add cache header if configured
			const maxAge = this.maxAge.get(op);
			if (
				maxAge !== undefined && !response.headers.has("Cache-Control")
			) {
				response.headers.set("Cache-Control", `max-age=${maxAge}`);
			}

			return response;
		}

		return notFoundResponse();
	}

	/**
	 * list all registered routes
	 */
	listRoutes(): string[] {
		return [...this.routes.keys(), ...this.redirects.keys()];
	}
}

/**
 * convert our response to deno's response
 */
export function toDenoResponse(response: Response): globalThis.Response {
	const headers = new Headers();
	for (const [key, value] of response.headers) {
		headers.set(key, value);
	}

	// handle both string and Uint8Array bodies
	const body = typeof response.body === "string"
		? response.body
		: response.body as BodyInit;

	return new globalThis.Response(body, {
		status: response.status,
		headers,
	});
}

/**
 * create and run the server
 *
 * arc: (def serve ((o port 8080)) ...)
 */
/**
 * simple request queue to ensure serial processing
 * avoids data races when multiple requests modify the same data
 */
class RequestQueue {
	private queue: Promise<void> = Promise.resolve();

	async enqueue<T>(fn: () => Promise<T>): Promise<T> {
		let result: T;
		this.queue = this.queue.then(async () => {
			result = await fn();
		});
		await this.queue;
		return result!;
	}
}

export function createServer(
	config: ServerConfig,
	router: Router,
	staticMaxAge?: number,
): Deno.HttpServer<Deno.NetAddr> {
	// request queue ensures only one request is processed at a time
	// this prevents data races when multiple requests modify state
	const requestQueue = new RequestQueue();

	const handler = async (
		raw: globalThis.Request,
		connInfo: Deno.ServeHandlerInfo,
	): Promise<globalThis.Response> => {
		// parse request outside queue (read-only)
		const req = await parseRequest(raw, connInfo);

		// try static file first (read-only, no queue needed)
		const staticResponse = await serveStatic(
			config.staticDir,
			req.op,
			staticMaxAge,
		);
		if (staticResponse) {
			return toDenoResponse(staticResponse);
		}

		// queue non-static requests for serial processing
		return requestQueue.enqueue(async () => {
			try {
				const response = await router.handle(req);
				return toDenoResponse(response);
			} catch (error) {
				console.error("Request error:", error);
				return toDenoResponse(errorResponse("Internal server error"));
			}
		});
	};

	return Deno.serve({ port: config.port }, handler);
}

/**
 * get arg from request (helper)
 *
 * arc: (def arg (req key) (alref req!args key))
 */
export function arg(req: Request, key: string): string | undefined {
	return req.args.get(key);
}

/**
 * get cookie from request (helper)
 */
export function cookie(req: Request, key: string): string | undefined {
	return req.cookies.get(key);
}

/**
 * create set-cookie header value
 */
export function setCookie(
	name: string,
	value: string,
	options: {
		path?: string;
		maxAge?: number;
		httpOnly?: boolean;
		secure?: boolean;
		sameSite?: "Strict" | "Lax" | "None";
	} = {},
): string {
	let cookie = `${name}=${encodeURIComponent(value)}`;

	if (options.path) cookie += `; Path=${options.path}`;
	if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
	if (options.httpOnly) cookie += "; HttpOnly";
	if (options.secure) cookie += "; Secure";
	if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;

	return cookie;
}

/**
 * create clear cookie header value
 */
export function clearCookie(name: string, path: string = "/"): string {
	return `${name}=; Path=${path}; Max-Age=0`;
}

/**
 * authentication system for arc news clone
 *
 * based on arc3.2/app.arc lines 1-268
 */

import { encodeHex } from "@std/encoding/hex";
import type {
	PasswordEntry,
	PasswordTable,
	Profile,
	Session,
	SessionsTable,
} from "./schemas.ts";
import { seconds } from "./ranking.ts";

/**
 * generate a sha256 hash of a string
 *
 * arc: (def shash (str) ...)
 */
export async function shash(str: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(str);
	const hash = await crypto.subtle.digest("SHA-256", data);
	return encodeHex(new Uint8Array(hash));
}

/**
 * generate a sha512 hash of a string (for anarki compatibility)
 *
 * arc: (system (+ "echo -n '" password "' | sha512sum"))
 */
export async function sha512(str: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(str);
	const hash = await crypto.subtle.digest("SHA-512", data);
	return encodeHex(new Uint8Array(hash));
}

/**
 * generate a random string for session tokens
 *
 * arc: (def new-user-cookie () (let id (unique-id) ...))
 */
export function generateToken(length: number = 32): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return encodeHex(bytes);
}

/**
 * generate a random salt for password hashing
 */
export function generateSalt(length: number = 16): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return encodeHex(bytes);
}

/**
 * hash a password with salt
 */
export async function hashPassword(
	password: string,
	salt: string,
): Promise<string> {
	return await shash(salt + password);
}

/**
 * create a password entry (hash + salt)
 */
export async function createPasswordEntry(
	password: string,
): Promise<PasswordEntry> {
	const salt = generateSalt();
	const hash = await hashPassword(password, salt);
	return { hash, salt, type: "sha256-salted" };
}

/**
 * verify a password against stored entry
 *
 * arc: (aand (shash pw) (is it (hpasswords* user)))
 *
 * supports both new (sha256-salted) and legacy (sha512-unsalted) formats
 */
export async function verifyPassword(
	password: string,
	entry: PasswordEntry,
): Promise<boolean> {
	if (entry.type === "sha512-unsalted") {
		// anarki format: unsalted sha512
		const hash = await sha512(password);
		return hash === entry.hash;
	}
	// default: sha256 with salt
	const hash = await hashPassword(password, entry.salt);
	return hash === entry.hash;
}

/**
 * check if username is valid
 *
 * arc: (def goodname (str (o min 1) (o max nil))
 *        (and (isa str 'string)
 *             (>= (len str) min)
 *             (~find (fn (c) (no (or (alphadig c) (in c #\- #\_)))) str)
 *             (isnt (str 0) #\-)
 *             (or (no max) (<= (len str) max))
 *             str))
 */
export function isGoodName(
	str: string,
	minLength: number = 2,
	maxLength: number = 15,
): boolean {
	if (typeof str !== "string") return false;
	if (str.length < minLength) return false;
	if (str.length > maxLength) return false;

	// can only contain letters, digits, dashes, underscores
	if (!/^[a-zA-Z0-9_-]+$/.test(str)) return false;

	// cannot start with dash
	if (str[0] === "-") return false;

	return true;
}

/**
 * validate new account creation
 *
 * arc: (def bad-newacct (user pw) ...)
 */
export function validateNewAccount(
	username: string,
	password: string,
	existingUsernames: Set<string>,
): string | null {
	// check username format
	if (!isGoodName(username, 2, 15)) {
		return "usernames can only contain letters, digits, dashes and underscores, and should be between 2 and 15 characters long. please choose another.";
	}

	// check if username is taken (case insensitive)
	if (existingUsernames.has(username.toLowerCase())) {
		return "that username is taken. please choose another.";
	}

	// check password length
	if (!password || password.length < 4) {
		return "passwords should be at least 4 characters long. please choose another.";
	}

	return null;
}

/**
 * create a new session for a user
 *
 * arc: (def cook-user (user) ...)
 */
export function createSession(
	username: string,
	ip: string,
): Session {
	return {
		token: generateToken(),
		user: username,
		ip,
		created: seconds(),
	};
}

/**
 * auth state manager
 */
export class AuthManager {
	private passwords: PasswordTable;
	private sessions: SessionsTable;
	private userToToken: Map<string, string>;
	private tokenToUser: Map<string, string>;
	private logins: Map<string, string>; // user -> ip
	private admins: Set<string>;
	private dcUsernames: Set<string>; // lowercase usernames

	constructor(
		passwords: PasswordTable,
		sessions: SessionsTable,
		admins: string[],
	) {
		this.passwords = passwords;
		this.sessions = sessions;
		this.admins = new Set(admins);
		this.dcUsernames = new Set();
		this.userToToken = new Map();
		this.tokenToUser = new Map();
		this.logins = new Map();

		// build reverse mappings
		// arc: (maptable (fn (k v) (= (user->cookie* v) k)) cookie->user*)
		for (const [token, session] of Object.entries(sessions)) {
			this.tokenToUser.set(token, session.user);
			this.userToToken.set(session.user, token);
		}

		// build lowercase username set
		for (const username of Object.keys(passwords)) {
			this.dcUsernames.add(username.toLowerCase());
		}
	}

	/**
	 * check if user exists
	 *
	 * arc: (def user-exists (u) (and u (hpasswords* u) u))
	 */
	userExists(username: string): boolean {
		return username in this.passwords;
	}

	/**
	 * check if user is admin
	 *
	 * arc: (def admin (u) (and u (mem u admins*)))
	 */
	isAdmin(username: string | null): boolean {
		return username !== null && this.admins.has(username);
	}

	/**
	 * get user from session token (cookie value)
	 *
	 * arc: (def get-user (req)
	 *        (let u (aand (alref req!cooks "user") (cookie->user* (sym it)))
	 *          (when u (= (logins* u) req!ip))
	 *          u))
	 */
	getUserFromToken(token: string | undefined, ip: string): string | null {
		if (!token) return null;

		const session = this.sessions[token];
		if (!session) return null;

		// update login ip
		this.logins.set(session.user, ip);

		return session.user;
	}

	/**
	 * get current ip for a user
	 */
	getUserIp(username: string): string | undefined {
		return this.logins.get(username);
	}

	/**
	 * attempt login
	 *
	 * arc: (def good-login (user pw ip) ...)
	 */
	async login(
		username: string,
		password: string,
		ip: string,
	): Promise<
		{ success: true; token: string; user: string } | {
			success: false;
			error: string;
		}
	> {
		// check if user exists
		const entry = this.passwords[username];
		if (!entry) {
			return { success: false, error: "bad login" };
		}

		// verify password
		const valid = await verifyPassword(password, entry);
		if (!valid) {
			return { success: false, error: "bad login" };
		}

		// get or create session token
		let token = this.userToToken.get(username);
		if (!token) {
			const session = createSession(username, ip);
			token = session.token;

			this.sessions[token] = session;
			this.tokenToUser.set(token, username);
			this.userToToken.set(username, token);
		}

		// update login ip
		this.logins.set(username, ip);

		return { success: true, token, user: username };
	}

	/**
	 * logout user
	 *
	 * arc: (def logout-user (user)
	 *        (wipe (logins* user))
	 *        (wipe (cookie->user* (user->cookie* user)) (user->cookie* user))
	 *        (save-table cookie->user* cookfile*))
	 */
	logout(username: string): void {
		// remove login
		this.logins.delete(username);

		// remove session
		const token = this.userToToken.get(username);
		if (token) {
			delete this.sessions[token];
			this.tokenToUser.delete(token);
			this.userToToken.delete(username);
		}
	}

	/**
	 * create new account
	 *
	 * arc: (def create-acct (user pw) ...)
	 */
	async createAccount(
		username: string,
		password: string,
	): Promise<{ success: true } | { success: false; error: string }> {
		// validate
		const error = validateNewAccount(username, password, this.dcUsernames);
		if (error) {
			return { success: false, error };
		}

		// create password entry
		const entry = await createPasswordEntry(password);
		this.passwords[username] = entry;
		this.dcUsernames.add(username.toLowerCase());

		return { success: true };
	}

	/**
	 * change password
	 *
	 * arc: (def set-pw (user pw) ...)
	 */
	async setPassword(
		username: string,
		password: string | null,
	): Promise<void> {
		if (password === null) {
			delete this.passwords[username];
		} else {
			const entry = await createPasswordEntry(password);
			this.passwords[username] = entry;
		}
	}

	/**
	 * disable account (random password + logout)
	 *
	 * arc: (def disable-acct (user)
	 *        (set-pw user (rand-string 20))
	 *        (logout-user user))
	 */
	async disableAccount(username: string): Promise<void> {
		await this.setPassword(username, generateToken(20));
		this.logout(username);
	}

	/**
	 * check if user matches request user (for csrf protection)
	 *
	 * arc: (mac when-umatch (user req . body)
	 *        `(if (is ,user (get-user ,req)) ...))
	 */
	verifyUserMatch(
		expectedUser: string,
		token: string | undefined,
		ip: string,
	): boolean {
		const requestUser = this.getUserFromToken(token, ip);
		return requestUser === expectedUser;
	}

	/**
	 * get all sessions (for persistence)
	 */
	getSessions(): SessionsTable {
		return this.sessions;
	}

	/**
	 * get all passwords (for persistence)
	 */
	getPasswords(): PasswordTable {
		return this.passwords;
	}

	/**
	 * add admin
	 */
	addAdmin(username: string): void {
		this.admins.add(username);
	}

	/**
	 * remove admin
	 */
	removeAdmin(username: string): void {
		this.admins.delete(username);
	}

	/**
	 * get admin list
	 */
	getAdmins(): string[] {
		return [...this.admins];
	}

	/**
	 * get all usernames
	 */
	getUsernames(): string[] {
		return Object.keys(this.passwords);
	}
}

/**
 * cookie name for user session
 */
export const USER_COOKIE = "user";

/**
 * cookie expiry date (far future)
 *
 * arc: "expires=Sun, 17-Jan-2038 19:14:07 GMT"
 */
export const COOKIE_EXPIRY = "Sun, 17-Jan-2038 19:14:07 GMT";

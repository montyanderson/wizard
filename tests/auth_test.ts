/**
 * tests for authentication system
 */

import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import {
	AuthManager,
	COOKIE_EXPIRY,
	createPasswordEntry,
	createSession,
	generateSalt,
	generateToken,
	hashPassword,
	isGoodName,
	sha512,
	shash,
	USER_COOKIE,
	validateNewAccount,
	verifyPassword,
} from "../src/lib/auth.ts";
import type { PasswordTable, SessionsTable } from "../src/lib/schemas.ts";

// =============================================================================
// Hashing
// =============================================================================

Deno.test("shash - generates consistent hash", async () => {
	const hash1 = await shash("test");
	const hash2 = await shash("test");
	assertEquals(hash1, hash2);
});

Deno.test("shash - different inputs produce different hashes", async () => {
	const hash1 = await shash("test1");
	const hash2 = await shash("test2");
	assertNotEquals(hash1, hash2);
});

Deno.test("shash - returns hex string", async () => {
	const hash = await shash("test");
	assertEquals(/^[0-9a-f]+$/.test(hash), true);
	assertEquals(hash.length, 64); // sha256 = 32 bytes = 64 hex chars
});

// =============================================================================
// Token generation
// =============================================================================

Deno.test("generateToken - generates unique tokens", () => {
	const token1 = generateToken();
	const token2 = generateToken();
	assertNotEquals(token1, token2);
});

Deno.test("generateToken - respects length", () => {
	const token = generateToken(16);
	assertEquals(token.length, 32); // 16 bytes = 32 hex chars
});

Deno.test("generateSalt - generates unique salts", () => {
	const salt1 = generateSalt();
	const salt2 = generateSalt();
	assertNotEquals(salt1, salt2);
});

// =============================================================================
// Password hashing
// =============================================================================

Deno.test("hashPassword - produces consistent results", async () => {
	const salt = "testsalt";
	const hash1 = await hashPassword("password", salt);
	const hash2 = await hashPassword("password", salt);
	assertEquals(hash1, hash2);
});

Deno.test("hashPassword - different salts produce different hashes", async () => {
	const hash1 = await hashPassword("password", "salt1");
	const hash2 = await hashPassword("password", "salt2");
	assertNotEquals(hash1, hash2);
});

Deno.test("createPasswordEntry - creates entry with hash and salt", async () => {
	const entry = await createPasswordEntry("password123");
	assertExists(entry.hash);
	assertExists(entry.salt);
	assertEquals(entry.hash.length, 64);
	assertEquals(entry.salt.length, 32);
});

Deno.test("verifyPassword - returns true for correct password", async () => {
	const entry = await createPasswordEntry("correctpassword");
	const result = await verifyPassword("correctpassword", entry);
	assertEquals(result, true);
});

Deno.test("verifyPassword - returns false for wrong password", async () => {
	const entry = await createPasswordEntry("correctpassword");
	const result = await verifyPassword("wrongpassword", entry);
	assertEquals(result, false);
});

// =============================================================================
// SHA512 (anarki compatibility)
// =============================================================================

Deno.test("sha512 - generates consistent hash", async () => {
	const hash1 = await sha512("test");
	const hash2 = await sha512("test");
	assertEquals(hash1, hash2);
});

Deno.test("sha512 - returns 128 char hex string", async () => {
	const hash = await sha512("test");
	assertEquals(/^[0-9a-f]+$/.test(hash), true);
	assertEquals(hash.length, 128); // sha512 = 64 bytes = 128 hex chars
});

Deno.test("verifyPassword - works with sha512-unsalted (anarki format)", async () => {
	// simulate a migrated anarki password
	const password = "testpassword";
	const hash = await sha512(password);
	const entry = {
		hash,
		salt: "",
		type: "sha512-unsalted" as const,
	};

	const result = await verifyPassword(password, entry);
	assertEquals(result, true);

	const wrongResult = await verifyPassword("wrongpassword", entry);
	assertEquals(wrongResult, false);
});

// =============================================================================
// Username validation
// =============================================================================

Deno.test("isGoodName - accepts valid usernames", () => {
	assertEquals(isGoodName("alice"), true);
	assertEquals(isGoodName("bob123"), true);
	assertEquals(isGoodName("user_name"), true);
	assertEquals(isGoodName("user-name"), true);
	assertEquals(isGoodName("ABC123"), true);
});

Deno.test("isGoodName - rejects too short", () => {
	assertEquals(isGoodName("a"), false);
	assertEquals(isGoodName("ab", 3), false);
});

Deno.test("isGoodName - rejects too long", () => {
	assertEquals(isGoodName("abcdefghijklmnop", 2, 15), false);
});

Deno.test("isGoodName - rejects invalid characters", () => {
	assertEquals(isGoodName("user name"), false);
	assertEquals(isGoodName("user@name"), false);
	assertEquals(isGoodName("user.name"), false);
	assertEquals(isGoodName("user!name"), false);
});

Deno.test("isGoodName - rejects starting with dash", () => {
	assertEquals(isGoodName("-username"), false);
});

Deno.test("isGoodName - rejects non-string", () => {
	assertEquals(isGoodName(123 as unknown as string), false);
	assertEquals(isGoodName(null as unknown as string), false);
	assertEquals(isGoodName(undefined as unknown as string), false);
});

// =============================================================================
// New account validation
// =============================================================================

Deno.test("validateNewAccount - accepts valid account", () => {
	const existing = new Set<string>();
	const error = validateNewAccount("newuser", "password123", existing);
	assertEquals(error, null);
});

Deno.test("validateNewAccount - rejects invalid username", () => {
	const existing = new Set<string>();
	const error = validateNewAccount("a", "password123", existing);
	assertExists(error);
	assertEquals(error?.includes("username"), true);
});

Deno.test("validateNewAccount - rejects taken username", () => {
	const existing = new Set(["existinguser"]);
	const error = validateNewAccount("existinguser", "password123", existing);
	assertExists(error);
	assertEquals(error?.includes("taken"), true);
});

Deno.test("validateNewAccount - case insensitive username check", () => {
	const existing = new Set(["existinguser"]);
	const error = validateNewAccount("ExistingUser", "password123", existing);
	assertExists(error);
	assertEquals(error?.includes("taken"), true);
});

Deno.test("validateNewAccount - rejects short password", () => {
	const existing = new Set<string>();
	const error = validateNewAccount("newuser", "abc", existing);
	assertExists(error);
	assertEquals(error?.includes("password"), true);
});

// =============================================================================
// Session creation
// =============================================================================

Deno.test("createSession - creates session with token", () => {
	const session = createSession("testuser", "192.168.1.1");
	assertEquals(session.user, "testuser");
	assertEquals(session.ip, "192.168.1.1");
	assertExists(session.token);
	assertExists(session.created);
});

// =============================================================================
// AuthManager
// =============================================================================

async function createTestAuthManager(): Promise<AuthManager> {
	const entry = await createPasswordEntry("password123");
	const passwords: PasswordTable = {
		alice: entry,
		bob: await createPasswordEntry("bobpassword"),
	};

	const sessions: SessionsTable = {
		token123: {
			token: "token123",
			user: "alice",
			ip: "192.168.1.1",
			created: 1700000000,
		},
	};

	const admins = ["alice"];

	return new AuthManager(passwords, sessions, admins);
}

Deno.test("AuthManager - userExists", async () => {
	const auth = await createTestAuthManager();
	assertEquals(auth.userExists("alice"), true);
	assertEquals(auth.userExists("bob"), true);
	assertEquals(auth.userExists("nonexistent"), false);
});

Deno.test("AuthManager - isAdmin", async () => {
	const auth = await createTestAuthManager();
	assertEquals(auth.isAdmin("alice"), true);
	assertEquals(auth.isAdmin("bob"), false);
	assertEquals(auth.isAdmin(null), false);
});

Deno.test("AuthManager - getUserFromToken", async () => {
	const auth = await createTestAuthManager();
	assertEquals(auth.getUserFromToken("token123", "10.0.0.1"), "alice");
	assertEquals(auth.getUserFromToken("badtoken", "10.0.0.1"), null);
	assertEquals(auth.getUserFromToken(undefined, "10.0.0.1"), null);
});

Deno.test("AuthManager - getUserFromToken updates login ip", async () => {
	const auth = await createTestAuthManager();
	auth.getUserFromToken("token123", "10.0.0.1");
	assertEquals(auth.getUserIp("alice"), "10.0.0.1");
});

Deno.test("AuthManager - login success", async () => {
	const auth = await createTestAuthManager();
	const result = await auth.login("alice", "password123", "10.0.0.1");

	assertEquals(result.success, true);
	if (result.success) {
		assertEquals(result.user, "alice");
		assertExists(result.token);
	}
});

Deno.test("AuthManager - login failure wrong password", async () => {
	const auth = await createTestAuthManager();
	const result = await auth.login("alice", "wrongpassword", "10.0.0.1");

	assertEquals(result.success, false);
	if (!result.success) {
		assertEquals(result.error, "bad login");
	}
});

Deno.test("AuthManager - login failure wrong username", async () => {
	const auth = await createTestAuthManager();
	const result = await auth.login("nonexistent", "password123", "10.0.0.1");

	assertEquals(result.success, false);
	if (!result.success) {
		assertEquals(result.error, "bad login");
	}
});

Deno.test("AuthManager - logout", async () => {
	const auth = await createTestAuthManager();

	// verify user is logged in
	assertEquals(auth.getUserFromToken("token123", "10.0.0.1"), "alice");

	// logout
	auth.logout("alice");

	// verify user is logged out
	assertEquals(auth.getUserFromToken("token123", "10.0.0.1"), null);
});

Deno.test("AuthManager - createAccount success", async () => {
	const auth = await createTestAuthManager();
	const result = await auth.createAccount("newuser", "password123");

	assertEquals(result.success, true);
	assertEquals(auth.userExists("newuser"), true);
});

Deno.test("AuthManager - createAccount rejects taken username", async () => {
	const auth = await createTestAuthManager();
	const result = await auth.createAccount("alice", "password123");

	assertEquals(result.success, false);
	if (!result.success) {
		assertEquals(result.error.includes("taken"), true);
	}
});

Deno.test("AuthManager - login creates new session when none exists", async () => {
	const passwords: PasswordTable = {
		newuser: await createPasswordEntry("password123"),
	};
	const sessions: SessionsTable = {}; // no existing session
	const auth = new AuthManager(passwords, sessions, []);

	const result = await auth.login("newuser", "password123", "10.0.0.1");

	assertEquals(result.success, true);
	if (result.success) {
		assertEquals(result.user, "newuser");
		assertExists(result.token);
	}
});

Deno.test("AuthManager - setPassword", async () => {
	const auth = await createTestAuthManager();

	// change password
	await auth.setPassword("alice", "newpassword");

	// verify old password doesn't work
	const result1 = await auth.login("alice", "password123", "10.0.0.1");
	assertEquals(result1.success, false);

	// verify new password works
	const result2 = await auth.login("alice", "newpassword", "10.0.0.1");
	assertEquals(result2.success, true);
});

Deno.test("AuthManager - disableAccount", async () => {
	const auth = await createTestAuthManager();

	// disable account
	await auth.disableAccount("alice");

	// verify can't login
	const result = await auth.login("alice", "password123", "10.0.0.1");
	assertEquals(result.success, false);
});

Deno.test("AuthManager - verifyUserMatch", async () => {
	const auth = await createTestAuthManager();

	assertEquals(auth.verifyUserMatch("alice", "token123", "10.0.0.1"), true);
	assertEquals(auth.verifyUserMatch("bob", "token123", "10.0.0.1"), false);
	assertEquals(auth.verifyUserMatch("alice", "badtoken", "10.0.0.1"), false);
});

Deno.test("AuthManager - admin management", async () => {
	const auth = await createTestAuthManager();

	assertEquals(auth.isAdmin("bob"), false);
	auth.addAdmin("bob");
	assertEquals(auth.isAdmin("bob"), true);

	auth.removeAdmin("bob");
	assertEquals(auth.isAdmin("bob"), false);
});

Deno.test("AuthManager - getUsernames", async () => {
	const auth = await createTestAuthManager();
	const usernames = auth.getUsernames();
	assertEquals(usernames.includes("alice"), true);
	assertEquals(usernames.includes("bob"), true);
});

Deno.test("AuthManager - getAdmins", async () => {
	const auth = await createTestAuthManager();
	const admins = auth.getAdmins();
	assertEquals(admins.includes("alice"), true);
	assertEquals(admins.length, 1);
});

Deno.test("AuthManager - setPassword with null deletes password", async () => {
	const auth = await createTestAuthManager();

	// delete password
	await auth.setPassword("alice", null);

	// verify can't login
	const result = await auth.login("alice", "password123", "10.0.0.1");
	assertEquals(result.success, false);
});

Deno.test("AuthManager - getSessions", async () => {
	const auth = await createTestAuthManager();
	const sessions = auth.getSessions();
	assertEquals("token123" in sessions, true);
});

Deno.test("AuthManager - getPasswords", async () => {
	const auth = await createTestAuthManager();
	const passwords = auth.getPasswords();
	assertEquals("alice" in passwords, true);
	assertEquals("bob" in passwords, true);
});

// =============================================================================
// Constants
// =============================================================================

Deno.test("constants are correct", () => {
	assertEquals(USER_COOKIE, "user");
	assertEquals(COOKIE_EXPIRY, "Sun, 17-Jan-2038 19:14:07 GMT");
});

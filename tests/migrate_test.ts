/**
 * tests for migration script
 */

import { assertEquals, assertExists } from "@std/assert";
import {
	alistToRecord,
	extractUserVotes,
	listFiles,
	migrate,
	migrateBannedIps,
	migrateBannedSites,
	migrateItem,
	migratePasswords,
	migrateProfile,
	migrateSessions,
	parseSExpr,
	parseTokens,
	readSExprFile,
	tokenise,
} from "../src/migrate.ts";
import { createStorageConfig, ensureStorageDirs } from "../src/lib/storage.ts";

// =============================================================================
// Tokeniser tests
// =============================================================================

Deno.test("tokenise - empty string", () => {
	const tokens = tokenise("");
	assertEquals(tokens, []);
});

Deno.test("tokenise - whitespace only", () => {
	const tokens = tokenise("   \n\t  ");
	assertEquals(tokens, []);
});

Deno.test("tokenise - parentheses", () => {
	const tokens = tokenise("()");
	assertEquals(tokens, ["(", ")"]);
});

Deno.test("tokenise - nested parentheses", () => {
	const tokens = tokenise("(())");
	assertEquals(tokens, ["(", "(", ")", ")"]);
});

Deno.test("tokenise - symbols", () => {
	const tokens = tokenise("foo bar baz");
	assertEquals(tokens, ["foo", "bar", "baz"]);
});

Deno.test("tokenise - numbers", () => {
	const tokens = tokenise("123 456.789 -42");
	assertEquals(tokens, ["123", "456.789", "-42"]);
});

Deno.test("tokenise - nil", () => {
	const tokens = tokenise("nil");
	assertEquals(tokens, ["nil"]);
});

Deno.test("tokenise - quoted string", () => {
	const tokens = tokenise('"hello world"');
	assertEquals(tokens, ['"hello world"']);
});

Deno.test("tokenise - string with escaped quote", () => {
	const tokens = tokenise('"say \\"hello\\""');
	assertEquals(tokens, ['"say "hello""']);
});

Deno.test("tokenise - string with escape sequences", () => {
	const tokens = tokenise('"line1\\nline2\\ttab\\\\slash"');
	assertEquals(tokens, ['"line1\nline2\ttab\\slash"']);
});

Deno.test("tokenise - complex expression", () => {
	const tokens = tokenise('((id "user") (karma 10))');
	assertEquals(tokens, [
		"(",
		"(",
		"id",
		'"user"',
		")",
		"(",
		"karma",
		"10",
		")",
		")",
	]);
});

// =============================================================================
// Parser tests
// =============================================================================

Deno.test("parseTokens - nil", () => {
	const result = parseTokens(["nil"]);
	assertEquals(result, null);
});

Deno.test("parseTokens - number", () => {
	const result = parseTokens(["42"]);
	assertEquals(result, 42);
});

Deno.test("parseTokens - negative number", () => {
	const result = parseTokens(["-123"]);
	assertEquals(result, -123);
});

Deno.test("parseTokens - float", () => {
	const result = parseTokens(["3.14"]);
	assertEquals(result, 3.14);
});

Deno.test("parseTokens - string", () => {
	const result = parseTokens(['"hello"']);
	assertEquals(result, "hello");
});

Deno.test("parseTokens - symbol", () => {
	const result = parseTokens(["foo"]);
	assertEquals(result, "foo");
});

Deno.test("parseTokens - empty list", () => {
	const result = parseTokens(["(", ")"]);
	assertEquals(result, []);
});

Deno.test("parseTokens - simple list", () => {
	const result = parseTokens(["(", "1", "2", "3", ")"]);
	assertEquals(result, [1, 2, 3]);
});

Deno.test("parseTokens - nested list", () => {
	const result = parseTokens(["(", "(", "1", ")", "(", "2", ")", ")"]);
	assertEquals(result, [[1], [2]]);
});

Deno.test("parseTokens - throws on unexpected end", () => {
	let threw = false;
	try {
		parseTokens([]);
	} catch (e) {
		threw = true;
		assertEquals((e as Error).message.includes("end of input"), true);
	}
	assertEquals(threw, true);
});

Deno.test("parseTokens - throws on missing close paren", () => {
	let threw = false;
	try {
		parseTokens(["(", "1", "2"]);
	} catch (e) {
		threw = true;
		assertEquals((e as Error).message.includes("missing closing"), true);
	}
	assertEquals(threw, true);
});

Deno.test("parseTokens - throws on unexpected close paren", () => {
	let threw = false;
	try {
		parseTokens([")"]);
	} catch (e) {
		threw = true;
		assertEquals((e as Error).message.includes("unexpected closing"), true);
	}
	assertEquals(threw, true);
});

// =============================================================================
// parseSExpr integration tests
// =============================================================================

Deno.test("parseSExpr - empty string", () => {
	const result = parseSExpr("");
	assertEquals(result, null);
});

Deno.test("parseSExpr - profile format", () => {
	const input = '((id "monty") (karma 28) (created 1716124987))';
	const result = parseSExpr(input);
	assertEquals(result, [
		["id", "monty"],
		["karma", 28],
		["created", 1716124987],
	]);
});

Deno.test("parseSExpr - story format", () => {
	const input = '((id 1) (type story) (by "user") (title "Test"))';
	const result = parseSExpr(input);
	assertEquals(result, [
		["id", 1],
		["type", "story"],
		["by", "user"],
		["title", "Test"],
	]);
});

Deno.test("parseSExpr - with nil values", () => {
	const input = "((foo nil) (bar 123))";
	const result = parseSExpr(input);
	assertEquals(result, [
		["foo", null],
		["bar", 123],
	]);
});

Deno.test("parseSExpr - nested votes array", () => {
	const input = "((votes ((1234 user1 up) (5678 user2 down))))";
	const result = parseSExpr(input);
	assertEquals(result, [
		["votes", [
			[1234, "user1", "up"],
			[5678, "user2", "down"],
		]],
	]);
});

// =============================================================================
// alistToRecord tests
// =============================================================================

Deno.test("alistToRecord - empty", () => {
	const result = alistToRecord([]);
	assertEquals(result, {});
});

Deno.test("alistToRecord - non-array", () => {
	const result = alistToRecord("not an array");
	assertEquals(result, {});
});

Deno.test("alistToRecord - simple", () => {
	const result = alistToRecord([
		["foo", "bar"],
		["baz", 123],
	]);
	assertEquals(result, { foo: "bar", baz: 123 });
});

Deno.test("alistToRecord - skips invalid entries", () => {
	const result = alistToRecord([
		["valid", "entry"],
		["single"],
		["also", "valid"],
	]);
	assertEquals(result, { valid: "entry", also: "valid" });
});

// =============================================================================
// migratePasswords tests
// =============================================================================

Deno.test("migratePasswords - empty", () => {
	const result = migratePasswords([]);
	assertEquals(result, {});
});

Deno.test("migratePasswords - non-array", () => {
	const result = migratePasswords("not an array");
	assertEquals(result, {});
});

Deno.test("migratePasswords - valid entries", () => {
	const input = [
		["user1", "(stdin)= abc123def456"],
		["user2", "(stdin)= 789abc000def"],
	];
	const result = migratePasswords(input);

	assertEquals(result["user1"].hash, "abc123def456");
	assertEquals(result["user1"].salt, "");
	assertEquals(result["user1"].type, "sha512-unsalted");
	assertEquals(result["user2"].hash, "789abc000def");
});

Deno.test("migratePasswords - skips invalid format", () => {
	const input = [
		["user1", "(stdin)= abc123"],
		["user2", "invalid format"],
	];
	const result = migratePasswords(input);

	assertEquals(Object.keys(result).length, 1);
	assertEquals(result["user1"].hash, "abc123");
});

// =============================================================================
// migrateSessions tests
// =============================================================================

Deno.test("migrateSessions - empty", () => {
	const result = migrateSessions([]);
	assertEquals(result, {});
});

Deno.test("migrateSessions - non-array", () => {
	const result = migrateSessions(null);
	assertEquals(result, {});
});

Deno.test("migrateSessions - valid entries", () => {
	const input = [
		["token123", "user1"],
		["token456", "user2"],
	];
	const result = migrateSessions(input);

	assertEquals(result["token123"].token, "token123");
	assertEquals(result["token123"].user, "user1");
	assertEquals(result["token123"].ip, "0.0.0.0");
	assertExists(result["token123"].created);

	assertEquals(result["token456"].user, "user2");
});

// =============================================================================
// migrateProfile tests
// =============================================================================

Deno.test("migrateProfile - minimal", () => {
	const input = [["id", "testuser"]];
	const result = migrateProfile(input);

	assertEquals(result.id, "testuser");
	assertEquals(result.karma, 1);
	assertEquals(result.weight, 0.5);
	assertEquals(result.delay, 0);
});

Deno.test("migrateProfile - full profile", () => {
	const input = [
		["id", "monty"],
		["karma", 28],
		["created", 1716124987],
		["email", "test@example.com"],
		["about", "about me"],
		["weight", 0.8],
		["auth", 1],
		["delay", 5],
		["maxvisit", 30],
		["minaway", 240],
		["showdead", "t"],
		["noprocrast", null],
		["submitted", [1, 2, 3]],
	];
	const result = migrateProfile(input);

	assertEquals(result.id, "monty");
	assertEquals(result.karma, 28);
	assertEquals(result.created, 1716124987);
	assertEquals(result.email, "test@example.com");
	assertEquals(result.about, "about me");
	assertEquals(result.weight, 0.8);
	assertEquals(result.auth, 1);
	assertEquals(result.delay, 5);
	assertEquals(result.maxvisit, 30);
	assertEquals(result.minaway, 240);
	assertEquals(result.showdead, true);
	assertEquals(result.noprocrast, null);
	assertEquals(result.submitted, [1, 2, 3]);
});

// =============================================================================
// extractUserVotes tests
// =============================================================================

Deno.test("extractUserVotes - no votes", () => {
	const input = [["id", "user"]];
	const result = extractUserVotes(input);
	assertEquals(result, {});
});

Deno.test("extractUserVotes - with votes", () => {
	const input = [
		["id", "user"],
		["votes", [
			[1234567890, 1, "user", "example.com", "up"],
			[1234567891, 2, "user", "test.com", "down"],
		]],
	];
	const result = extractUserVotes(input);

	assertEquals(result["1"].dir, "up");
	assertEquals(result["1"].time, 1234567890);
	assertEquals(result["2"].dir, "down");
	assertEquals(result["2"].time, 1234567891);
});

Deno.test("extractUserVotes - invalid votes skipped", () => {
	const input = [
		["votes", [
			[1234567890, 1, "user", "example.com", "up"],
			[1234567891, 2], // too short
		]],
	];
	const result = extractUserVotes(input);

	assertEquals(Object.keys(result).length, 1);
	assertEquals(result["1"].dir, "up");
});

// =============================================================================
// migrateItem tests
// =============================================================================

Deno.test("migrateItem - story", () => {
	const input = [
		["id", 1],
		["type", "story"],
		["by", "testuser"],
		["ip", "192.168.1.1"],
		["time", 1700000000],
		["title", "Test Story"],
		["url", "https://example.com"],
		["score", 5],
		["kids", [2, 3]],
	];
	const result = migrateItem(input);

	assertEquals(result.id, 1);
	assertEquals(result.type, "story");
	assertEquals(result.by, "testuser");
	assertEquals(result.ip, "192.168.1.1");
	assertEquals(result.time, 1700000000);
	assertEquals(result.title, "Test Story");
	assertEquals(result.url, "https://example.com");
	assertEquals(result.score, 5);
	assertEquals(result.kids, [2, 3]);
});

Deno.test("migrateItem - comment", () => {
	const input = [
		["id", 2],
		["type", "comment"],
		["by", "commenter"],
		["time", 1700001000],
		["text", "A comment"],
		["parent", 1],
	];
	const result = migrateItem(input);

	assertEquals(result.id, 2);
	assertEquals(result.type, "comment");
	assertEquals(result.by, "commenter");
	assertEquals(result.text, "A comment");
	assertEquals(result.parent, 1);
});

Deno.test("migrateItem - with votes", () => {
	const input = [
		["id", 1],
		["type", "story"],
		["by", "user"],
		["title", "Test"],
		["votes", [
			[1234, "1.2.3.4", "voter1", "up", 1],
			[5678, "5.6.7.8", "voter2", "up", 2],
		]],
	];
	const result = migrateItem(input);

	assertExists(result.votes);
	assertEquals(result.votes!.length, 2);
	assertEquals(result.votes![0].user, "voter1");
	assertEquals(result.votes![0].ip, "1.2.3.4");
	assertEquals(result.votes![0].dir, "up");
	assertEquals(result.votes![0].time, 1234);
	assertEquals(result.votes![0].score, 1);
	assertEquals(result.votes![1].user, "voter2");
});

Deno.test("migrateItem - poll", () => {
	const input = [
		["id", 10],
		["type", "poll"],
		["by", "user"],
		["title", "Poll Question"],
		["parts", [11, 12, 13]],
	];
	const result = migrateItem(input);

	assertEquals(result.type, "poll");
	assertEquals(result.parts, [11, 12, 13]);
});

Deno.test("migrateItem - pollopt", () => {
	const input = [
		["id", 11],
		["type", "pollopt"],
		["by", "user"],
		["text", "Option 1"],
		["parent", 10],
		["score", 5],
	];
	const result = migrateItem(input);

	assertEquals(result.type, "pollopt");
	assertEquals(result.text, "Option 1");
	assertEquals(result.parent, 10);
});

Deno.test("migrateItem - unknown type throws", () => {
	const input = [
		["id", 1],
		["type", "unknown"],
		["by", "user"],
	];

	let threw = false;
	try {
		migrateItem(input);
	} catch (e) {
		threw = true;
		assertEquals((e as Error).message.includes("unknown item type"), true);
	}
	assertEquals(threw, true);
});

Deno.test("migrateItem - defaults missing fields", () => {
	const input = [
		["id", 1],
		["type", "story"],
		["by", "user"],
		["title", "Test"],
	];
	const result = migrateItem(input);

	assertEquals(result.ip, "0.0.0.0");
	assertEquals(result.score, 1);
	assertEquals(result.sockvotes, 0);
});

// =============================================================================
// migrateBannedSites tests
// =============================================================================

Deno.test("migrateBannedSites - empty", () => {
	const result = migrateBannedSites([]);
	assertEquals(result, {});
});

Deno.test("migrateBannedSites - non-array", () => {
	const result = migrateBannedSites("not an array");
	assertEquals(result, {});
});

Deno.test("migrateBannedSites - valid entries", () => {
	const input = [
		["spam.com", "kill"],
		["ads.net", "ignore"],
	];
	const result = migrateBannedSites(input);

	assertEquals(result["spam.com"].ban, "kill");
	assertEquals(result["spam.com"].user, "migration");
	assertExists(result["spam.com"].time);

	assertEquals(result["ads.net"].ban, "ignore");
});

Deno.test("migrateBannedSites - skips invalid ban types", () => {
	const input = [
		["spam.com", "kill"],
		["other.com", "invalid"],
	];
	const result = migrateBannedSites(input);

	assertEquals(Object.keys(result).length, 1);
	assertEquals(result["spam.com"].ban, "kill");
});

// =============================================================================
// migrateBannedIps tests
// =============================================================================

Deno.test("migrateBannedIps - empty", () => {
	const result = migrateBannedIps([]);
	assertEquals(result, {});
});

Deno.test("migrateBannedIps - non-array", () => {
	const result = migrateBannedIps(null);
	assertEquals(result, {});
});

Deno.test("migrateBannedIps - valid entries", () => {
	const input = [
		["10.0.0.1"],
		["192.168.1.1"],
	];
	const result = migrateBannedIps(input);

	assertEquals(result["10.0.0.1"].user, "migration");
	assertExists(result["10.0.0.1"].time);

	assertExists(result["192.168.1.1"]);
});

// =============================================================================
// File operation tests
// =============================================================================

Deno.test("readSExprFile - returns null for missing", async () => {
	const result = await readSExprFile("/nonexistent/path/file");
	assertEquals(result, null);
});

Deno.test("readSExprFile - parses existing file", async () => {
	const tempDir = await Deno.makeTempDir();
	const path = `${tempDir}/test.sexpr`;
	await Deno.writeTextFile(path, '((id "test") (value 42))');

	const result = await readSExprFile(path);
	assertEquals(result, [
		["id", "test"],
		["value", 42],
	]);

	await Deno.remove(tempDir, { recursive: true });
});

Deno.test("listFiles - returns empty for missing dir", async () => {
	const result = await listFiles("/nonexistent/directory");
	assertEquals(result, []);
});

Deno.test("listFiles - lists files", async () => {
	const tempDir = await Deno.makeTempDir();
	await Deno.writeTextFile(`${tempDir}/file1.txt`, "");
	await Deno.writeTextFile(`${tempDir}/file2.txt`, "");
	await Deno.mkdir(`${tempDir}/subdir`);

	const result = await listFiles(tempDir);
	assertEquals(result.sort(), ["file1.txt", "file2.txt"]);

	await Deno.remove(tempDir, { recursive: true });
});

// =============================================================================
// Full migration test
// =============================================================================

Deno.test("migrate - full migration", async () => {
	// create temp directories
	const wwwDir = await Deno.makeTempDir({ prefix: "anarki_www_" });
	const dataDir = await Deno.makeTempDir({ prefix: "deno_news_data_" });

	// create anarki-style data
	await Deno.writeTextFile(
		`${wwwDir}/hpw`,
		'(("testuser" "(stdin)= abc123def456789"))',
	);

	await Deno.writeTextFile(
		`${wwwDir}/cooks`,
		'((token123 "testuser"))',
	);

	await Deno.writeTextFile(
		`${wwwDir}/badsites`,
		'(("spam.com" kill))',
	);

	await Deno.writeTextFile(
		`${wwwDir}/badips`,
		'(("10.0.0.1"))',
	);

	await Deno.mkdir(`${wwwDir}/profile`);
	await Deno.writeTextFile(
		`${wwwDir}/profile/testuser`,
		'((id "testuser") (karma 10) (created 1700000000) (votes ((1700000000 1 "testuser" "example.com" up))))',
	);

	await Deno.mkdir(`${wwwDir}/story`);
	await Deno.writeTextFile(
		`${wwwDir}/story/1`,
		'((id 1) (type story) (by "testuser") (time 1700000000) (title "Test Story") (url "https://example.com") (score 5))',
	);

	// run migration
	const config = createStorageConfig(dataDir);
	const result = await migrate(wwwDir, config);

	// verify results
	assertEquals(result.passwords, 1);
	assertEquals(result.sessions, 1);
	assertEquals(result.profiles, 1);
	assertEquals(result.items, 1);
	assertEquals(result.userVotes, 1);
	assertEquals(result.bannedSites, 1);
	assertEquals(result.bannedIps, 1);
	assertEquals(result.errors.length, 0);

	// verify files were created
	const passwordsPath = `${dataDir}/hpw.json`;
	const passwordsContent = await Deno.readTextFile(passwordsPath);
	const passwords = JSON.parse(passwordsContent);
	assertEquals(passwords["testuser"].hash, "abc123def456789");

	const profilePath = `${dataDir}/news/profile/testuser.json`;
	const profileContent = await Deno.readTextFile(profilePath);
	const profile = JSON.parse(profileContent);
	assertEquals(profile.id, "testuser");
	assertEquals(profile.karma, 10);

	const itemPath = `${dataDir}/news/story/1.json`;
	const itemContent = await Deno.readTextFile(itemPath);
	const item = JSON.parse(itemContent);
	assertEquals(item.id, 1);
	assertEquals(item.title, "Test Story");

	// cleanup
	await Deno.remove(wwwDir, { recursive: true });
	await Deno.remove(dataDir, { recursive: true });
});

Deno.test("migrate - handles errors gracefully", async () => {
	const wwwDir = await Deno.makeTempDir({ prefix: "anarki_www_" });
	const dataDir = await Deno.makeTempDir({ prefix: "deno_news_data_" });

	// create invalid data
	await Deno.writeTextFile(`${wwwDir}/hpw`, "invalid ( not closed");

	await Deno.mkdir(`${wwwDir}/profile`);
	await Deno.writeTextFile(`${wwwDir}/profile/baduser`, "((invalid");

	await Deno.mkdir(`${wwwDir}/story`);
	await Deno.writeTextFile(`${wwwDir}/story/1`, "((id 1) (type invalid))");

	const config = createStorageConfig(dataDir);
	const result = await migrate(wwwDir, config);

	// should have errors but not crash
	assertEquals(result.errors.length > 0, true);

	// cleanup
	await Deno.remove(wwwDir, { recursive: true });
	await Deno.remove(dataDir, { recursive: true });
});

Deno.test("migrate - handles missing files gracefully", async () => {
	const wwwDir = await Deno.makeTempDir({ prefix: "anarki_www_" });
	const dataDir = await Deno.makeTempDir({ prefix: "deno_news_data_" });

	// empty www dir - no files
	const config = createStorageConfig(dataDir);
	const result = await migrate(wwwDir, config);

	// should complete with no data
	assertEquals(result.passwords, 0);
	assertEquals(result.sessions, 0);
	assertEquals(result.profiles, 0);
	assertEquals(result.items, 0);
	assertEquals(result.errors.length, 0);

	// cleanup
	await Deno.remove(wwwDir, { recursive: true });
	await Deno.remove(dataDir, { recursive: true });
});

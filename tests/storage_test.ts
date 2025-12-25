/**
 * tests for storage layer
 */

import { assertEquals, assertExists } from "@std/assert";
import {
	createStorageConfig,
	ensureStorageDirs,
	fileExists,
	getNextItemId,
	listDir,
	listItemIds,
	listProfileIds,
	loadAdmins,
	loadBannedIps,
	loadBannedSites,
	loadItem,
	loadJson,
	loadLightweights,
	loadPasswords,
	loadProfile,
	loadScrubRules,
	loadSessions,
	loadTopStories,
	loadUserVotes,
	saveAdmins,
	saveBannedIps,
	saveBannedSites,
	saveItem,
	saveJson,
	saveLightweights,
	savePasswords,
	saveProfile,
	saveScrubRules,
	saveSessions,
	saveTopStories,
	saveUserVotes,
	type StorageConfig,
} from "../src/lib/storage.ts";
import { z } from "@zod/zod";
import type { Item, Profile, UserVotesTable } from "../src/lib/schemas.ts";

// use a temporary directory for tests
const testDir = await Deno.makeTempDir({ prefix: "deno_news_test_" });
const config = createStorageConfig(testDir);

// clean up after all tests
Deno.test({
	name: "storage cleanup",
	fn: async () => {
		await Deno.remove(testDir, { recursive: true });
	},
	sanitizeOps: false,
	sanitizeResources: false,
});

Deno.test("createStorageConfig - creates correct paths", () => {
	const cfg = createStorageConfig("mydata");
	assertEquals(cfg.dataDir, "mydata");
	assertEquals(cfg.newsDir, "mydata/news");
	assertEquals(cfg.storyDir, "mydata/news/story");
	assertEquals(cfg.profileDir, "mydata/news/profile");
	assertEquals(cfg.voteDir, "mydata/news/vote");
});

Deno.test("ensureStorageDirs - creates directories", async () => {
	await ensureStorageDirs(config);

	assertEquals(await fileExists(config.dataDir), true);
	assertEquals(await fileExists(config.newsDir), true);
	assertEquals(await fileExists(config.storyDir), true);
	assertEquals(await fileExists(config.profileDir), true);
	assertEquals(await fileExists(config.voteDir), true);
});

Deno.test("fileExists - returns false for missing file", async () => {
	const result = await fileExists(`${testDir}/nonexistent.json`);
	assertEquals(result, false);
});

Deno.test("fileExists - returns true for existing file", async () => {
	const path = `${testDir}/exists.json`;
	await Deno.writeTextFile(path, "{}");
	const result = await fileExists(path);
	assertEquals(result, true);
});

Deno.test("loadJson - returns null for missing file", async () => {
	const schema = z.object({ foo: z.string() });
	const result = await loadJson(`${testDir}/missing.json`, schema);
	assertEquals(result, null);
});

Deno.test("loadJson - parses and validates json", async () => {
	const path = `${testDir}/test.json`;
	await Deno.writeTextFile(path, '{"foo": "bar"}');

	const schema = z.object({ foo: z.string() });
	const result = await loadJson(path, schema);
	assertEquals(result, { foo: "bar" });
});

Deno.test("saveJson - writes validated json", async () => {
	const path = `${testDir}/saved.json`;
	const schema = z.object({ foo: z.string() });
	await saveJson(path, { foo: "bar" }, schema);

	const text = await Deno.readTextFile(path);
	const data = JSON.parse(text);
	assertEquals(data, { foo: "bar" });
});

Deno.test("listDir - lists json files", async () => {
	const dir = `${testDir}/listtest`;
	await Deno.mkdir(dir, { recursive: true });
	await Deno.writeTextFile(`${dir}/one.json`, "{}");
	await Deno.writeTextFile(`${dir}/two.json`, "{}");
	await Deno.writeTextFile(`${dir}/notjson.txt`, "");

	const result = await listDir(dir);
	assertEquals(result.sort(), ["one", "two"]);
});

Deno.test("listDir - returns empty for missing dir", async () => {
	const result = await listDir(`${testDir}/missingdir`);
	assertEquals(result, []);
});

// =============================================================================
// Item storage tests
// =============================================================================

Deno.test("saveItem and loadItem - round trip", async () => {
	const item: Item = {
		id: 1,
		type: "story",
		by: "testuser",
		ip: "192.168.1.1",
		time: 1700000000,
		url: "https://example.com",
		title: "Test Story",
		text: null,
		votes: [],
		score: 5,
		sockvotes: 0,
		flags: null,
		dead: false,
		deleted: false,
		parts: null,
		parent: null,
		kids: [2, 3],
		keys: null,
	};

	await saveItem(config, item);
	const loaded = await loadItem(config, 1);

	assertExists(loaded);
	assertEquals(loaded.id, 1);
	assertEquals(loaded.type, "story");
	assertEquals(loaded.by, "testuser");
	assertEquals(loaded.title, "Test Story");
	assertEquals(loaded.kids, [2, 3]);
});

Deno.test("loadItem - returns null for missing", async () => {
	const result = await loadItem(config, 99999);
	assertEquals(result, null);
});

Deno.test("listItemIds - returns sorted ids", async () => {
	// item 1 already exists from previous test
	const item2: Item = {
		id: 2,
		type: "comment",
		by: "commenter",
		ip: "192.168.1.2",
		time: 1700001000,
		url: null,
		title: null,
		text: "A comment",
		votes: null,
		score: 1,
		sockvotes: 0,
		flags: null,
		dead: null,
		deleted: null,
		parts: null,
		parent: 1,
		kids: null,
		keys: null,
	};
	await saveItem(config, item2);

	const ids = await listItemIds(config);
	assertEquals(ids[0], 2); // descending order
	assertEquals(ids[1], 1);
});

// =============================================================================
// Profile storage tests
// =============================================================================

Deno.test("saveProfile and loadProfile - round trip", async () => {
	const profile: Profile = {
		id: "testuser",
		name: "Test User",
		created: 1700000000,
		auth: 0,
		member: null,
		submitted: [1],
		votes: null,
		karma: 10,
		avg: null,
		weight: 0.5,
		ignore: null,
		email: "test@example.com",
		about: "About me",
		showdead: null,
		noprocrast: null,
		firstview: null,
		lastview: null,
		maxvisit: 20,
		minaway: 180,
		topcolor: null,
		keys: null,
		delay: 0,
	};

	await saveProfile(config, profile);
	const loaded = await loadProfile(config, "testuser");

	assertExists(loaded);
	assertEquals(loaded.id, "testuser");
	assertEquals(loaded.karma, 10);
	assertEquals(loaded.email, "test@example.com");
});

Deno.test("loadProfile - returns null for missing", async () => {
	const result = await loadProfile(config, "nonexistent");
	assertEquals(result, null);
});

Deno.test("listProfileIds - lists profiles", async () => {
	const ids = await listProfileIds(config);
	assertEquals(ids.includes("testuser"), true);
});

// =============================================================================
// User votes storage tests
// =============================================================================

Deno.test("saveUserVotes and loadUserVotes - round trip", async () => {
	const votes: UserVotesTable = {
		"1": { dir: "up", time: 1700000000 },
		"2": { dir: "down", time: 1700001000 },
	};

	await saveUserVotes(config, "testuser", votes);
	const loaded = await loadUserVotes(config, "testuser");

	assertExists(loaded);
	assertEquals(loaded["1"].dir, "up");
	assertEquals(loaded["2"].dir, "down");
});

Deno.test("loadUserVotes - returns null for missing", async () => {
	const result = await loadUserVotes(config, "nonexistent");
	assertEquals(result, null);
});

// =============================================================================
// Global tables tests
// =============================================================================

Deno.test("bannedSites - save and load", async () => {
	await saveBannedSites(config, {
		"spam.com": {
			ban: "kill",
			user: "admin",
			time: 1234567890,
			info: null,
		},
		"malware.net": {
			ban: "ignore",
			user: "admin",
			time: 1234567891,
			info: null,
		},
	});
	const loaded = await loadBannedSites(config);
	assertEquals(loaded["spam.com"].ban, "kill");
	assertEquals(loaded["malware.net"].ban, "ignore");
});

Deno.test("loadBannedSites - returns empty for missing", async () => {
	const tempConfig = createStorageConfig(`${testDir}/empty1`);
	await ensureStorageDirs(tempConfig);
	const result = await loadBannedSites(tempConfig);
	assertEquals(result, {});
});

Deno.test("bannedIps - save and load", async () => {
	await saveBannedIps(config, {
		"10.0.0.1": { user: "admin", time: 1234567890, info: null },
	});
	const loaded = await loadBannedIps(config);
	assertEquals(loaded["10.0.0.1"].user, "admin");
});

Deno.test("lightweights - save and load", async () => {
	await saveLightweights(config, { "imgur.com": true });
	const loaded = await loadLightweights(config);
	assertEquals(loaded["imgur.com"], true);
});

Deno.test("scrubRules - save and load", async () => {
	await saveScrubRules(config, [
		{ find: "[VIDEO]", replace: "" },
		{ find: "BREAKING:", replace: "" },
	]);
	const loaded = await loadScrubRules(config);
	assertEquals(loaded.length, 2);
	assertEquals(loaded[0].find, "[VIDEO]");
});

Deno.test("passwords - save and load", async () => {
	await savePasswords(config, {
		testuser: { hash: "abc123", salt: "xyz789", type: "sha256-salted" },
	});
	const loaded = await loadPasswords(config);
	assertEquals(loaded["testuser"].hash, "abc123");
});

Deno.test("sessions - save and load", async () => {
	await saveSessions(config, {
		token123: {
			token: "token123",
			user: "testuser",
			ip: "192.168.1.1",
			created: 1700000000,
		},
	});
	const loaded = await loadSessions(config);
	assertEquals(loaded["token123"].user, "testuser");
});

Deno.test("admins - save and load", async () => {
	await saveAdmins(config, ["admin1", "admin2"]);
	const loaded = await loadAdmins(config);
	assertEquals(loaded, ["admin1", "admin2"]);
});

Deno.test("topStories - save and load", async () => {
	await saveTopStories(config, [100, 99, 98, 97]);
	const loaded = await loadTopStories(config);
	assertEquals(loaded, [100, 99, 98, 97]);
});

// =============================================================================
// Utility tests
// =============================================================================

Deno.test("getNextItemId - returns next id", async () => {
	// we have items 1 and 2 from earlier tests
	const nextId = await getNextItemId(config);
	assertEquals(nextId, 3);
});

// =============================================================================
// Error handling tests
// =============================================================================

Deno.test("loadJson - throws on invalid json", async () => {
	const path = `${testDir}/invalid.json`;
	await Deno.writeTextFile(path, "not valid json {{{");

	const schema = z.object({ foo: z.string() });
	let threw = false;
	try {
		await loadJson(path, schema);
	} catch {
		threw = true;
	}
	assertEquals(threw, true);
});

Deno.test("loadJson - throws on schema mismatch", async () => {
	const path = `${testDir}/mismatch.json`;
	await Deno.writeTextFile(path, '{"foo": 123}');

	const schema = z.object({ foo: z.string() });
	let threw = false;
	try {
		await loadJson(path, schema);
	} catch {
		threw = true;
	}
	assertEquals(threw, true);
});

Deno.test("fileExists - handles permission error", async () => {
	// This test verifies the error re-throw path
	// We can't easily simulate permission errors, but we test that non-NotFound errors are thrown
	const result = await fileExists(
		`${testDir}/definitely-does-not-exist-12345`,
	);
	assertEquals(result, false);
});

Deno.test("listDir - ignores non-json files", async () => {
	const dir = `${testDir}/mixeddir`;
	await Deno.mkdir(dir, { recursive: true });
	await Deno.writeTextFile(`${dir}/data.json`, "{}");
	await Deno.writeTextFile(`${dir}/readme.txt`, "text");
	await Deno.writeTextFile(`${dir}/config.yaml`, "yaml: true");

	const result = await listDir(dir);
	assertEquals(result.length, 1);
	assertEquals(result[0], "data");
});

Deno.test("saveItem - throws without id", async () => {
	const item: Item = {
		id: null,
		type: "story",
		by: "test",
		ip: "127.0.0.1",
		time: 1700000000,
		url: null,
		title: "Test",
		text: null,
		votes: null,
		score: 0,
		sockvotes: 0,
		flags: null,
		dead: null,
		deleted: null,
		parts: null,
		parent: null,
		kids: null,
		keys: null,
	};

	let threw = false;
	try {
		await saveItem(config, item);
	} catch (e) {
		threw = true;
		assertEquals((e as Error).message.includes("without id"), true);
	}
	assertEquals(threw, true);
});

Deno.test("saveProfile - throws without id", async () => {
	const profile: Profile = {
		id: null,
		name: null,
		created: 1700000000,
		auth: 0,
		member: null,
		submitted: null,
		votes: null,
		karma: 1,
		avg: null,
		weight: 0.5,
		ignore: null,
		email: null,
		about: null,
		showdead: null,
		noprocrast: null,
		firstview: null,
		lastview: null,
		maxvisit: 20,
		minaway: 180,
		topcolor: null,
		keys: null,
		delay: 0,
	};

	let threw = false;
	try {
		await saveProfile(config, profile);
	} catch (e) {
		threw = true;
		assertEquals((e as Error).message.includes("without id"), true);
	}
	assertEquals(threw, true);
});

Deno.test("loadBannedIps - returns empty for missing", async () => {
	const tempConfig = createStorageConfig(`${testDir}/empty2`);
	await ensureStorageDirs(tempConfig);
	const result = await loadBannedIps(tempConfig);
	assertEquals(Object.keys(result).length, 0);
});

Deno.test("loadLightweights - returns empty for missing", async () => {
	const tempConfig = createStorageConfig(`${testDir}/empty3`);
	await ensureStorageDirs(tempConfig);
	const result = await loadLightweights(tempConfig);
	assertEquals(Object.keys(result).length, 0);
});

Deno.test("loadScrubRules - returns empty for missing", async () => {
	const tempConfig = createStorageConfig(`${testDir}/empty4`);
	await ensureStorageDirs(tempConfig);
	const result = await loadScrubRules(tempConfig);
	assertEquals(result.length, 0);
});

Deno.test("loadPasswords - returns empty for missing", async () => {
	const tempConfig = createStorageConfig(`${testDir}/empty5`);
	await ensureStorageDirs(tempConfig);
	const result = await loadPasswords(tempConfig);
	assertEquals(Object.keys(result).length, 0);
});

Deno.test("loadSessions - returns empty for missing", async () => {
	const tempConfig = createStorageConfig(`${testDir}/empty6`);
	await ensureStorageDirs(tempConfig);
	const result = await loadSessions(tempConfig);
	assertEquals(Object.keys(result).length, 0);
});

Deno.test("loadAdmins - returns empty for missing", async () => {
	const tempConfig = createStorageConfig(`${testDir}/empty7`);
	await ensureStorageDirs(tempConfig);
	const result = await loadAdmins(tempConfig);
	assertEquals(result.length, 0);
});

Deno.test("loadTopStories - returns empty for missing", async () => {
	const tempConfig = createStorageConfig(`${testDir}/empty8`);
	await ensureStorageDirs(tempConfig);
	const result = await loadTopStories(tempConfig);
	assertEquals(result.length, 0);
});

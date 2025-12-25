/**
 * tests for ranking algorithms
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
	bestN,
	canSee,
	controFactor,
	filterVisible,
	frontpageRank,
	getFamily,
	GRAVITY,
	isAuthor,
	isBlank,
	isComment,
	isDelayed,
	isLightweight,
	isLightweightUrl,
	isLive,
	isMetastory,
	isPoll,
	isStory,
	isValidUrl,
	itemAge,
	LONG_DOMAINS,
	MAX_DELAY,
	minutesSince,
	MULTI_TLD_COUNTRIES,
	parseSite,
	realScore,
	retrieve,
	seconds,
	seesDead,
	sitename,
	TIMEBASE,
	userAge,
	visibleFamilyCount,
} from "../src/lib/ranking.ts";
import type { Item, Profile } from "../src/lib/schemas.ts";

// helper to create test items
function createItem(overrides: Partial<Item> = {}): Item {
	return {
		id: 1,
		type: "story",
		by: "testuser",
		ip: "192.168.1.1",
		time: seconds(),
		url: "https://example.com",
		title: "Test Story",
		text: null,
		votes: null,
		score: 10,
		sockvotes: 0,
		flags: null,
		dead: null,
		deleted: null,
		parts: null,
		parent: null,
		kids: null,
		keys: null,
		...overrides,
	};
}

function createProfile(overrides: Partial<Profile> = {}): Profile {
	return {
		id: "testuser",
		name: "Test User",
		created: seconds(),
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
		...overrides,
	};
}

// =============================================================================
// Time functions
// =============================================================================

Deno.test("seconds - returns current time", () => {
	const now = Math.floor(Date.now() / 1000);
	const result = seconds();
	// should be within 1 second
	assertEquals(Math.abs(result - now) <= 1, true);
});

Deno.test("minutesSince - calculates elapsed minutes", () => {
	const fiveMinutesAgo = seconds() - 5 * 60;
	const result = minutesSince(fiveMinutesAgo);
	assertAlmostEquals(result, 5, 0.1);
});

Deno.test("itemAge - returns age in minutes", () => {
	const item = createItem({ time: seconds() - 10 * 60 });
	const age = itemAge(item);
	assertAlmostEquals(age, 10, 0.1);
});

Deno.test("userAge - returns age in minutes", () => {
	const profile = createProfile({ created: seconds() - 60 * 60 });
	const age = userAge(profile);
	assertAlmostEquals(age, 60, 0.1);
});

// =============================================================================
// Score functions
// =============================================================================

Deno.test("realScore - subtracts sockvotes", () => {
	const item = createItem({ score: 10, sockvotes: 3 });
	assertEquals(realScore(item), 7);
});

Deno.test("realScore - handles zero sockvotes", () => {
	const item = createItem({ score: 10, sockvotes: 0 });
	assertEquals(realScore(item), 10);
});

// =============================================================================
// Type checks
// =============================================================================

Deno.test("isStory - returns true for story", () => {
	assertEquals(isStory(createItem({ type: "story" })), true);
	assertEquals(isStory(createItem({ type: "comment" })), false);
});

Deno.test("isComment - returns true for comment", () => {
	assertEquals(isComment(createItem({ type: "comment" })), true);
	assertEquals(isComment(createItem({ type: "story" })), false);
});

Deno.test("isPoll - returns true for poll", () => {
	assertEquals(isPoll(createItem({ type: "poll" })), true);
	assertEquals(isPoll(createItem({ type: "story" })), false);
});

Deno.test("isMetastory - returns true for story or poll", () => {
	assertEquals(isMetastory(createItem({ type: "story" })), true);
	assertEquals(isMetastory(createItem({ type: "poll" })), true);
	assertEquals(isMetastory(createItem({ type: "comment" })), false);
	assertEquals(isMetastory(null), false);
});

Deno.test("isLive - returns true when not dead or deleted", () => {
	assertEquals(isLive(createItem({ dead: false, deleted: false })), true);
	assertEquals(isLive(createItem({ dead: true, deleted: false })), false);
	assertEquals(isLive(createItem({ dead: false, deleted: true })), false);
	assertEquals(isLive(createItem({ dead: null, deleted: null })), true);
});

// =============================================================================
// String helpers
// =============================================================================

Deno.test("isBlank - handles various inputs", () => {
	assertEquals(isBlank(null), true);
	assertEquals(isBlank(undefined), true);
	assertEquals(isBlank(""), true);
	assertEquals(isBlank("  "), true);
	assertEquals(isBlank("hello"), false);
});

Deno.test("isValidUrl - validates http urls", () => {
	assertEquals(isValidUrl("http://example.com"), true);
	assertEquals(isValidUrl("https://example.com"), true);
	assertEquals(isValidUrl("ftp://example.com"), false);
	assertEquals(isValidUrl("example.com"), false);
	assertEquals(isValidUrl(null), false);
});

// =============================================================================
// URL parsing
// =============================================================================

Deno.test("parseSite - extracts domain parts", () => {
	assertEquals(parseSite("https://www.example.com/path"), [
		"com",
		"example",
		"www",
	]);
	assertEquals(parseSite("http://news.ycombinator.com"), [
		"com",
		"ycombinator",
		"news",
	]);
});

Deno.test("parseSite - handles url with query", () => {
	const result = parseSite("https://example.com?foo=bar");
	assertEquals(result, ["com", "example"]);
});

Deno.test("parseSite - invalid url returns empty", () => {
	const result = parseSite("not-a-valid-url");
	assertEquals(result, []);
});

Deno.test("sitename - extracts site name", () => {
	assertEquals(sitename("https://example.com/page"), "example.com");
	assertEquals(sitename("https://www.example.com/page"), "example.com");
	assertEquals(sitename("https://blog.example.com/page"), "example.com");
});

Deno.test("sitename - handles multi-tld countries", () => {
	assertEquals(sitename("https://news.bbc.co.uk/page"), "bbc.co.uk");
	assertEquals(sitename("https://example.co.jp/page"), "example.co.jp");
});

Deno.test("sitename - handles long domains", () => {
	assertEquals(
		sitename("https://myblog.blogspot.com/post"),
		"myblog.blogspot.com",
	);
	assertEquals(
		sitename("https://site.wordpress.com/post"),
		"site.wordpress.com",
	);
});

Deno.test("sitename - returns null for invalid", () => {
	assertEquals(sitename(null), null);
	assertEquals(sitename("not-a-url"), null);
});

Deno.test("sitename - handles ip addresses", () => {
	// note: IP addresses are reversed because parseSite reverses tokens
	// this might be a bug but matches arc behavior
	assertEquals(sitename("http://192.168.1.1/page"), "1.1.168.192");
	assertEquals(sitename("http://127.0.0.1:8080"), "1:8080.0.0.127");
});

Deno.test("sitename - handles single token domains", () => {
	// edge case where there's only one token (shouldn't happen with valid URLs)
	// but the code handles it by returning null at line 239
	assertEquals(sitename("http://localhost"), null);
});

Deno.test("isLightweightUrl - detects image urls", () => {
	assertEquals(isLightweightUrl("https://example.com/image.png"), true);
	assertEquals(isLightweightUrl("https://example.com/image.jpg"), true);
	assertEquals(isLightweightUrl("https://example.com/image.JPEG"), true);
	assertEquals(isLightweightUrl("https://example.com/page.html"), false);
	assertEquals(isLightweightUrl(null), false);
});

// =============================================================================
// Lightweight detection
// =============================================================================

Deno.test("isLightweight - dead items are lightweight", () => {
	const item = createItem({ dead: true });
	assertEquals(isLightweight(item, {}), true);
});

Deno.test("isLightweight - rally items are lightweight", () => {
	const item = createItem({ keys: ["rally"] });
	assertEquals(isLightweight(item, {}), true);
});

Deno.test("isLightweight - image items are lightweight", () => {
	const item = createItem({ keys: ["image"] });
	assertEquals(isLightweight(item, {}), true);
});

Deno.test("isLightweight - lightweight sites", () => {
	const item = createItem({ url: "https://imgur.com/image" });
	assertEquals(isLightweight(item, { "imgur.com": true }), true);
	assertEquals(isLightweight(item, {}), false);
});

Deno.test("isLightweight - image urls", () => {
	const item = createItem({ url: "https://example.com/photo.png" });
	assertEquals(isLightweight(item, {}), true);
});

// =============================================================================
// Ranking
// =============================================================================

Deno.test("controFactor - returns 1 for low comment count", () => {
	const item = createItem({ score: 10 });
	assertEquals(controFactor(item, 10), 1);
	assertEquals(controFactor(item, 20), 1);
});

Deno.test("controFactor - reduces for high comment count", () => {
	const item = createItem({ score: 10 });
	const factor = controFactor(item, 50);
	// (10/50)^2 = 0.04
	assertAlmostEquals(factor, 0.04, 0.001);
});

Deno.test("controFactor - caps at 1", () => {
	const item = createItem({ score: 100 });
	const factor = controFactor(item, 25);
	// (100/25)^2 = 16, but capped at 1
	assertEquals(factor, 1);
});

Deno.test("frontpageRank - higher score means higher rank", () => {
	const item1 = createItem({ score: 10, time: seconds() - 60 });
	const item2 = createItem({ score: 20, time: seconds() - 60 });

	const rank1 = frontpageRank(item1);
	const rank2 = frontpageRank(item2);

	assertEquals(rank2 > rank1, true);
});

Deno.test("frontpageRank - older items rank lower", () => {
	const item1 = createItem({ score: 10, time: seconds() - 60 });
	const item2 = createItem({ score: 10, time: seconds() - 3600 });

	const rank1 = frontpageRank(item1);
	const rank2 = frontpageRank(item2);

	assertEquals(rank1 > rank2, true);
});

Deno.test("frontpageRank - comments rank lower than stories", () => {
	const story = createItem({
		type: "story",
		score: 10,
		time: seconds() - 60,
	});
	const comment = createItem({
		type: "comment",
		score: 10,
		time: seconds() - 60,
	});

	const storyRank = frontpageRank(story);
	const commentRank = frontpageRank(comment);

	assertEquals(storyRank > commentRank, true);
});

Deno.test("frontpageRank - no-url stories rank lower", () => {
	const withUrl = createItem({
		url: "https://example.com",
		score: 10,
		time: seconds() - 60,
	});
	const noUrl = createItem({ url: null, score: 10, time: seconds() - 60 });

	const withUrlRank = frontpageRank(withUrl);
	const noUrlRank = frontpageRank(noUrl);

	assertEquals(withUrlRank > noUrlRank, true);
});

// =============================================================================
// Visibility
// =============================================================================

Deno.test("isAuthor - checks authorship", () => {
	const item = createItem({ by: "alice" });
	assertEquals(isAuthor("alice", item), true);
	assertEquals(isAuthor("bob", item), false);
	assertEquals(isAuthor(null, item), false);
});

Deno.test("seesDead - editors see dead", () => {
	assertEquals(seesDead(null, true), true);
	assertEquals(seesDead(null, false), false);
});

Deno.test("seesDead - users with showdead", () => {
	const profile = createProfile({ showdead: true, ignore: null });
	assertEquals(seesDead(profile, false), true);
});

Deno.test("seesDead - ignored users cannot see dead", () => {
	const profile = createProfile({ showdead: true, ignore: true });
	assertEquals(seesDead(profile, false), false);
});

Deno.test("isDelayed - new comments from delayed users", () => {
	const matureIds = new Set<number>();
	const item = createItem({
		id: 1,
		type: "comment",
		time: seconds() - 60, // 1 minute old
	});

	// 5 minute delay, comment is 1 minute old
	assertEquals(isDelayed(item, 5, matureIds), true);

	// 0 delay
	assertEquals(isDelayed(item, 0, matureIds), false);
});

Deno.test("isDelayed - mature comments not delayed", () => {
	const matureIds = new Set<number>([1]);
	const item = createItem({ id: 1, type: "comment", time: seconds() - 60 });

	assertEquals(isDelayed(item, 5, matureIds), false);
});

Deno.test("canSee - deleted items admin only", () => {
	const item = createItem({ deleted: true });
	assertEquals(canSee("user", item, true, false), true);
	assertEquals(canSee("user", item, false, false), false);
});

Deno.test("canSee - dead items author or seesdead", () => {
	const item = createItem({ dead: true, by: "alice" });
	assertEquals(canSee("alice", item, false, false), true); // author
	assertEquals(canSee("bob", item, false, true), true); // sees dead
	assertEquals(canSee("bob", item, false, false), false);
});

Deno.test("canSee - live items everyone", () => {
	const item = createItem({ dead: false, deleted: false });
	assertEquals(canSee(null, item, false, false), true);
	assertEquals(canSee("user", item, false, false), true);
});

Deno.test("filterVisible - filters items", () => {
	const items = [
		createItem({ id: 1, dead: false }),
		createItem({ id: 2, dead: true }),
		createItem({ id: 3, deleted: true }),
	];

	const visible = filterVisible(items, null, false, false);
	assertEquals(visible.length, 1);
	assertEquals(visible[0].id, 1);
});

// =============================================================================
// Family tree
// =============================================================================

Deno.test("visibleFamilyCount - counts visible items", async () => {
	const root = createItem({ id: 1, kids: [2, 3] });
	const kid1 = createItem({ id: 2, kids: null });
	const kid2 = createItem({ id: 3, kids: [4], dead: true });
	const grandkid = createItem({ id: 4, kids: null });

	const items = new Map<number, Item>([
		[1, root],
		[2, kid1],
		[3, kid2],
		[4, grandkid],
	]);

	const getItem = async (id: number) => items.get(id) ?? null;
	const canSeeItem = (item: Item) => !item.dead;

	const count = await visibleFamilyCount(root, getItem, canSeeItem);
	// root(1) + kid1(1) + kid2(0, dead) + grandkid(1) = 3
	assertEquals(count, 3);
});

Deno.test("getFamily - returns all descendants", async () => {
	const root = createItem({ id: 1, kids: [2, 3] });
	const kid1 = createItem({ id: 2, kids: null });
	const kid2 = createItem({ id: 3, kids: [4] });
	const grandkid = createItem({ id: 4, kids: null });

	const items = new Map<number, Item>([
		[1, root],
		[2, kid1],
		[3, kid2],
		[4, grandkid],
	]);

	const getItem = async (id: number) => items.get(id) ?? null;

	const family = await getFamily(root, getItem);
	assertEquals(family.length, 4);
	assertEquals(family.map((i) => i.id).sort(), [1, 2, 3, 4]);
});

// =============================================================================
// Utility functions
// =============================================================================

Deno.test("bestN - returns top n items", () => {
	const items = [
		{ name: "a", score: 5 },
		{ name: "b", score: 10 },
		{ name: "c", score: 3 },
		{ name: "d", score: 8 },
	];

	const top2 = bestN(items, 2, (i) => i.score);
	assertEquals(top2.length, 2);
	assertEquals(top2[0].name, "b");
	assertEquals(top2[1].name, "d");
});

Deno.test("retrieve - gets n items passing test", () => {
	const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
	const evens = retrieve(items, 3, (n) => n % 2 === 0);
	assertEquals(evens, [2, 4, 6]);
});

Deno.test("retrieve - returns fewer if not enough match", () => {
	const items = [1, 3, 5, 7];
	const evens = retrieve(items, 3, (n) => n % 2 === 0);
	assertEquals(evens, []);
});

// =============================================================================
// Constants exported
// =============================================================================

Deno.test("constants are correct", () => {
	assertEquals(GRAVITY, 1.8);
	assertEquals(TIMEBASE, 120);
	assertEquals(MAX_DELAY, 10);
	assertEquals(MULTI_TLD_COUNTRIES.includes("uk"), true);
	assertEquals(LONG_DOMAINS.includes("blogspot"), true);
});

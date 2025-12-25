/**
 * tests for main application functions
 */

import { assertEquals, assertExists } from "@std/assert";
import {
	activeRank,
	activeThreshold,
	ancestors,
	bar,
	byNoob,
	commentForm,
	commentlink,
	config,
	daysSince,
	displayItem,
	displayItems,
	displayStory,
	downvoteThreshold,
	downvoteTime,
	ellipsize,
	family,
	findRootParent,
	flagKillThreshold,
	flagThreshold,
	formatdoc,
	hasAdminVote,
	hasFlagged,
	hasUserVoted,
	htmlWithStatus,
	itemline,
	items,
	itemScore,
	killItem,
	leaderThreshold,
	loginPage,
	longpage,
	lowestScore,
	mainColour,
	manyFlags,
	maxend,
	metastory,
	minipage,
	msgpage,
	multisubst,
	newsDir,
	nleaders,
	npage,
	ownChangeableItem,
	pagetop,
	paras,
	parsePageParam,
	perpage,
	pollThreshold,
	processTitle,
	profDir,
	profiles,
	recordUserVote,
	redirect,
	redirectWithClearCookie,
	redirectWithCookie,
	shortpage,
	shouldAutoKill,
	storyDir,
	subcomment,
	submissions,
	threadsPerpage,
	titleline,
	toggleFlag,
	toplink,
	topright,
	userChangetime,
	userComments,
	voteDir,
	votejs,
	votelinks,
	votewid,
	whitepage,
} from "../src/main.ts";
import type { Item } from "../src/lib/schemas.ts";
import type { Request } from "../src/lib/server.ts";

// =============================================================================
// Helper functions
// =============================================================================

function createMockRequest(args: Record<string, string> = {}): Request {
	const argsMap = new Map(Object.entries(args));
	return {
		method: "GET",
		path: "/test",
		op: "test",
		args: argsMap,
		cookies: new Map(),
		ip: "127.0.0.1",
		body: null,
		raw: new globalThis.Request("http://localhost/test"),
	};
}

function createTestItem(overrides: Partial<Item> = {}): Item {
	return {
		id: 1,
		type: "story",
		by: "testuser",
		ip: "127.0.0.1",
		time: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
		url: "https://example.com",
		title: "Test Story",
		text: null,
		votes: [],
		score: 1,
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

// =============================================================================
// Constants tests
// =============================================================================

Deno.test("constants - site config", () => {
	assertExists(config.thisSite);
	assertExists(config.siteUrl);
	assertExists(config.siteColour);
});

Deno.test("constants - pagination", () => {
	assertEquals(perpage, 30);
	assertEquals(threadsPerpage, 10);
	assertEquals(maxend, 210);
});

Deno.test("constants - voting thresholds", () => {
	assertEquals(downvoteThreshold, 200);
	assertEquals(downvoteTime, 1440);
	assertEquals(lowestScore, -4);
	assertEquals(votewid, 14);
});

Deno.test("constants - flag thresholds", () => {
	assertEquals(flagThreshold, 30);
	assertEquals(flagKillThreshold, 7);
	assertEquals(manyFlags, 1);
});

Deno.test("constants - edit times", () => {
	assertEquals(userChangetime, 120);
});

Deno.test("constants - leaders", () => {
	assertEquals(nleaders, 20);
	assertEquals(leaderThreshold, 1);
});

Deno.test("constants - poll", () => {
	assertEquals(pollThreshold, 20);
});

Deno.test("constants - directories", () => {
	assertEquals(newsDir, "data/news/");
	assertEquals(storyDir, "data/news/story/");
	assertEquals(profDir, "data/news/profile/");
	assertEquals(voteDir, "data/news/vote/");
});

Deno.test("constants - bar", () => {
	assertEquals(bar, " | ");
});

Deno.test("constants - formatdoc", () => {
	assertEquals(formatdoc.includes("Blank lines"), true);
});

Deno.test("constants - votejs", () => {
	assertEquals(votejs.includes("function vote"), true);
	assertEquals(votejs.includes("byId"), true);
});

Deno.test("constants - active threshold", () => {
	assertEquals(activeThreshold, 1500);
});

// =============================================================================
// Page template tests
// =============================================================================

Deno.test("whitepage - creates white page", () => {
	const html = whitepage("<p>content</p>");
	assertEquals(html.includes("<html>"), true);
	assertEquals(html.includes('bgcolor="white"'), true);
	assertEquals(html.includes("<p>content</p>"), true);
});

Deno.test("npage - creates news page", () => {
	const html = npage("Test Title", "<p>body</p>");
	assertEquals(html.includes("<html>"), true);
	assertEquals(html.includes("<title>Test Title</title>"), true);
	assertEquals(html.includes("<p>body</p>"), true);
	assertEquals(html.includes("news.css"), true);
});

Deno.test("minipage - creates mini page", () => {
	const html = minipage("Test Label", "<p>content</p>");
	assertEquals(html.includes("<html>"), true);
	assertEquals(html.includes("Test Label"), true);
	assertEquals(html.includes("<p>content</p>"), true);
});

Deno.test("shortpage - creates short page", () => {
	const html = shortpage(null, null, null, "Test", "test", "<p>content</p>");
	assertEquals(html.includes("<html>"), true);
	assertEquals(html.includes("<p>content</p>"), true);
});

Deno.test("longpage - creates long page", () => {
	const html = longpage(
		null,
		Date.now(),
		null,
		null,
		undefined,
		"test",
		"<p>content</p>",
	);
	assertEquals(html.includes("<html>"), true);
	assertEquals(html.includes("<p>content</p>"), true);
});

Deno.test("msgpage - creates message page", () => {
	const html = msgpage(null, "Test message");
	assertEquals(html.includes("Test message"), true);
});

Deno.test("msgpage - creates message page with title", () => {
	const html = msgpage(null, "Test message", "Custom Title");
	assertEquals(html.includes("Test message"), true);
	assertEquals(html.includes("Custom Title"), true);
});

Deno.test("msgpage - wraps long messages", () => {
	const longMsg = "a".repeat(100);
	const html = msgpage(null, longMsg);
	assertEquals(html.includes("width="), true);
});

Deno.test("loginPage - creates login form", () => {
	const html = loginPage("news");
	assertEquals(html.includes("Login"), true);
	assertEquals(html.includes("Create Account"), true);
	assertEquals(html.includes("password"), true);
});

Deno.test("loginPage - shows error message", () => {
	const html = loginPage("news", "Bad login");
	assertEquals(html.includes("Bad login"), true);
});

// =============================================================================
// Header/nav tests
// =============================================================================

Deno.test("mainColour - returns site colour", () => {
	const col = mainColour(null);
	assertEquals(col.r, config.siteColour.r);
	assertEquals(col.g, config.siteColour.g);
	assertEquals(col.b, config.siteColour.b);
});

Deno.test("topright - logged out", () => {
	const html = topright(null, "news");
	assertEquals(html.includes("login"), true);
});

Deno.test("topright - logged in", () => {
	const html = topright("testuser", "news");
	assertEquals(html.includes("testuser"), true);
	assertEquals(html.includes("logout"), true);
});

Deno.test("toplink - creates link", () => {
	const html = toplink("new", "newest", null);
	assertEquals(html.includes("new"), true);
	assertEquals(html.includes("newest"), true);
});

Deno.test("toplink - selected state", () => {
	const html = toplink("new", "newest", "new");
	assertEquals(html.includes("topsel"), true);
});

Deno.test("pagetop - full header", () => {
	const html = pagetop("full", null, null, undefined, null, "news");
	assertEquals(html.includes("newest"), true);
	assertEquals(html.includes("comments"), true);
	assertEquals(html.includes("submit"), true);
});

Deno.test("pagetop - simple header", () => {
	const html = pagetop(null, null, "Test Label", undefined, null, "");
	assertEquals(html.includes("Test Label"), true);
});

// =============================================================================
// Item display tests
// =============================================================================

Deno.test("titleline - creates title link", () => {
	const item = createTestItem();
	const html = titleline(item, null);
	assertEquals(html.includes("Test Story"), true);
	assertEquals(html.includes("example.com"), true);
});

Deno.test("titleline - self post", () => {
	const item = createTestItem({ url: null, title: "Ask: Question" });
	const html = titleline(item, null);
	assertEquals(html.includes("Ask: Question"), true);
	assertEquals(html.includes("item?id="), true);
});

Deno.test("itemline - shows score and time", () => {
	const item = createTestItem({ score: 5 });
	const html = itemline(item, null);
	assertEquals(html.includes("5 points"), true);
	assertEquals(html.includes("testuser"), true);
});

Deno.test("itemline - single point", () => {
	const item = createTestItem({ score: 1 });
	const html = itemline(item, null);
	assertEquals(html.includes("1 point"), true);
});

Deno.test("commentlink - shows count", () => {
	const item = createTestItem({ kids: [2, 3, 4] });
	const html = commentlink(item, null);
	assertEquals(html.includes("3"), true);
	assertEquals(html.includes("comment"), true);
});

Deno.test("commentlink - no comments", () => {
	const item = createTestItem({ kids: null });
	const html = commentlink(item, null);
	assertEquals(html.includes("discuss"), true);
});

Deno.test("displayStory - renders story", () => {
	const item = createTestItem();
	const html = displayStory(1, item, null, "news");
	assertEquals(html.includes("Test Story"), true);
	assertEquals(html.includes("1."), true);
});

Deno.test("displayStory - renders without number", () => {
	const item = createTestItem();
	const html = displayStory(null, item, null, "news");
	assertEquals(html.includes("Test Story"), true);
});

Deno.test("displayItem - dispatches to story", () => {
	const item = createTestItem();
	const html = displayItem(1, item, null, "news");
	assertEquals(html.includes("Test Story"), true);
});

Deno.test("displayItem - dispatches to comment", () => {
	const item = createTestItem({
		type: "comment",
		text: "A comment",
		title: null,
	});
	const html = displayItem(1, item, null, "news");
	assertEquals(html.includes("A comment"), true);
});

Deno.test("displayItems - renders list", () => {
	const itemList = [
		createTestItem({ id: 1 }),
		createTestItem({ id: 2, title: "Second" }),
	];
	const html = displayItems(null, itemList, null, undefined, "news");
	assertEquals(html.includes("Test Story"), true);
	assertEquals(html.includes("Second"), true);
});

// =============================================================================
// Vote link tests
// =============================================================================

Deno.test("votelinks - shows upvote for unvoted item", () => {
	const item = createTestItem();
	const html = votelinks(item, null, "news");
	assertEquals(html.includes("grayarrow.gif"), true);
});

Deno.test("votelinks - shows * for author", () => {
	const item = createTestItem({ by: "testuser" });
	const html = votelinks(item, "testuser", "news");
	assertEquals(html.includes("*"), true);
});

// =============================================================================
// Helper function tests
// =============================================================================

Deno.test("metastory - story is metastory", () => {
	const item = createTestItem({ type: "story" });
	assertEquals(metastory(item), true);
});

Deno.test("metastory - poll is metastory", () => {
	const item = createTestItem({ type: "poll" });
	assertEquals(metastory(item), true);
});

Deno.test("metastory - comment is not metastory", () => {
	const item = createTestItem({ type: "comment" });
	assertEquals(metastory(item), false);
});

Deno.test("ellipsize - short string unchanged", () => {
	assertEquals(ellipsize("hello", 10), "hello");
});

Deno.test("ellipsize - long string truncated", () => {
	const result = ellipsize("hello world", 5);
	assertEquals(result.length <= 8, true);
	assertEquals(result.includes("..."), true);
});

Deno.test("paras - splits on blank lines", () => {
	const result = paras("line1\n\nline2");
	assertEquals(result.length, 2);
	assertEquals(result[0], "line1");
	assertEquals(result[1], "line2");
});

Deno.test("daysSince - calculates days", () => {
	const now = Math.floor(Date.now() / 1000);
	const twoDaysAgo = now - 86400 * 2;
	assertEquals(daysSince(twoDaysAgo), 2);
});

Deno.test("multisubst - replaces patterns", () => {
	const rules = [
		{ find: "foo", replace: "bar" },
		{ find: "baz", replace: "qux" },
	];
	assertEquals(multisubst(rules, "foo baz"), "bar qux");
});

Deno.test("processTitle - applies scrub rules", () => {
	// Empty scrubrules means no changes
	const result = processTitle("Test Title");
	assertEquals(result, "Test Title");
});

Deno.test("findRootParent - returns self for story", () => {
	const item = createTestItem();
	items.set(1, item);
	const root = findRootParent(item);
	assertEquals(root.id, 1);
	items.delete(1);
});

Deno.test("findRootParent - follows parent chain", () => {
	const story = createTestItem({ id: 1 });
	const comment = createTestItem({ id: 2, type: "comment", parent: 1 });
	items.set(1, story);
	items.set(2, comment);
	const root = findRootParent(comment);
	assertEquals(root.id, 1);
	items.delete(1);
	items.delete(2);
});

Deno.test("family - returns item and descendants", () => {
	const story = createTestItem({ id: 1, kids: [2] });
	const comment = createTestItem({
		id: 2,
		type: "comment",
		parent: 1,
		kids: null,
	});
	items.set(1, story);
	items.set(2, comment);
	const fam = family(story);
	assertEquals(fam.length, 2);
	items.delete(1);
	items.delete(2);
});

Deno.test("activeRank - calculates activity score", () => {
	const story = createTestItem({ id: 1, kids: [2] });
	const comment = createTestItem({
		id: 2,
		type: "comment",
		parent: 1,
		time: Math.floor(Date.now() / 1000) - 60,
	});
	items.set(1, story);
	items.set(2, comment);
	const rank = activeRank(story);
	assertEquals(rank > 0, true);
	items.delete(1);
	items.delete(2);
});

Deno.test("ancestors - returns parent chain", () => {
	const story = createTestItem({ id: 1 });
	const c1 = createTestItem({ id: 2, type: "comment", parent: 1 });
	const c2 = createTestItem({ id: 3, type: "comment", parent: 2 });
	items.set(1, story);
	items.set(2, c1);
	items.set(3, c2);
	const anc = ancestors(c2);
	assertEquals(anc.length, 2);
	items.delete(1);
	items.delete(2);
	items.delete(3);
});

Deno.test("subcomment - detects reply to own comment", () => {
	const c1 = createTestItem({ id: 1, type: "comment", by: "alice" });
	const c2 = createTestItem({ id: 2, type: "comment", parent: 1, by: "bob" });
	items.set(1, c1);
	items.set(2, c2);
	// c2 is a subcomment (reply to c1)
	assertEquals(subcomment(c2), false); // subcomment checks if parent is by same user
	items.delete(1);
	items.delete(2);
});

// =============================================================================
// Permission tests
// =============================================================================

Deno.test("ownChangeableItem - own recent item", () => {
	const item = createTestItem({ by: "testuser" });
	assertEquals(ownChangeableItem("testuser", item), true);
});

Deno.test("ownChangeableItem - not own item", () => {
	const item = createTestItem({ by: "other" });
	assertEquals(ownChangeableItem("testuser", item), false);
});

Deno.test("hasFlagged - no flags", () => {
	const item = createTestItem({ flags: null });
	assertEquals(hasFlagged("testuser", item), false);
});

Deno.test("hasFlagged - user has flagged", () => {
	const item = createTestItem({ flags: ["testuser"] });
	assertEquals(hasFlagged("testuser", item), true);
});

Deno.test("toggleFlag - adds flag", () => {
	const item = createTestItem({ flags: null });
	toggleFlag("testuser", item);
	assertEquals(item.flags?.includes("testuser"), true);
});

Deno.test("toggleFlag - removes flag", () => {
	const item = createTestItem({ flags: ["testuser"] });
	toggleFlag("testuser", item);
	assertEquals(item.flags?.includes("testuser"), false);
});

Deno.test("hasAdminVote - no votes", () => {
	const item = createTestItem({ votes: null });
	assertEquals(hasAdminVote(item), false);
});

Deno.test("killItem - marks as dead", () => {
	const item = createTestItem({ dead: null });
	killItem(item);
	assertEquals(item.dead, true);
});

Deno.test("shouldAutoKill - under threshold", () => {
	const item = createTestItem({ flags: ["a", "b", "c"] });
	assertEquals(shouldAutoKill(item), false);
});

Deno.test("shouldAutoKill - above threshold", () => {
	// needs more than flagKillThreshold (7) flags, low score, no nokill key, no admin vote
	const item = createTestItem({
		flags: ["a", "b", "c", "d", "e", "f", "g", "h"],
		score: 1,
	});
	assertEquals(shouldAutoKill(item), true);
});

// =============================================================================
// Link generation tests
// =============================================================================

Deno.test("commentForm - generates form", () => {
	const item = createTestItem();
	const html = commentForm(item, "testuser", "item?id=1");
	assertEquals(html.includes("textarea"), true);
	assertEquals(html.includes("submit"), true);
});

// =============================================================================
// User data tests
// =============================================================================

Deno.test("submissions - returns empty for unknown user", () => {
	const result = submissions("unknownuser");
	assertEquals(result.length, 0);
});

Deno.test("userComments - returns empty for unknown user", () => {
	const result = userComments("unknownuser");
	assertEquals(result.length, 0);
});

Deno.test("byNoob - unknown user is not noob", () => {
	const item = createTestItem({ by: "unknownuser" });
	assertEquals(byNoob(item), false);
});

// =============================================================================
// Vote tracking tests
// =============================================================================

Deno.test("hasUserVoted - no votes", () => {
	assertEquals(hasUserVoted("testuser", 999), false);
});

Deno.test("recordUserVote - records vote", () => {
	recordUserVote("votetest", 100, "up");
	assertEquals(hasUserVoted("votetest", 100), true);
});

// =============================================================================
// Response helper tests
// =============================================================================

Deno.test("htmlWithStatus - creates response", () => {
	const res = htmlWithStatus("<html></html>", 200);
	assertEquals(res.status, 200);
	assertEquals(res.body, "<html></html>");
});

Deno.test("redirect - creates redirect", () => {
	const res = redirect("/news");
	assertEquals(res.status, 302);
	assertEquals(res.headers.get("Location"), "/news");
});

Deno.test("redirectWithCookie - includes cookie", () => {
	const res = redirectWithCookie("/news", "abc123");
	assertEquals(res.status, 302);
	assertEquals(res.headers.get("Set-Cookie")?.includes("user=abc123"), true);
});

Deno.test("redirectWithClearCookie - clears cookie", () => {
	const res = redirectWithClearCookie("/news");
	assertEquals(res.status, 302);
	assertEquals(res.headers.get("Set-Cookie")?.includes("Max-Age=0"), true);
});

// =============================================================================
// Item score tests
// =============================================================================

Deno.test("itemScore - formats score", () => {
	const item = createTestItem({ score: 5 });
	const html = itemScore(item);
	assertEquals(html.includes("5"), true);
});

// =============================================================================
// Pagination tests
// =============================================================================

Deno.test("parsePageParam - default page 1", () => {
	const req = createMockRequest();
	const { start, end } = parsePageParam(req);
	assertEquals(start, 0);
	assertEquals(end, 30); // perpage = 30
});

Deno.test("parsePageParam - page 2", () => {
	const req = createMockRequest({ p: "2" });
	const { start, end } = parsePageParam(req);
	assertEquals(start, 30);
	assertEquals(end, 60);
});

Deno.test("parsePageParam - page 3", () => {
	const req = createMockRequest({ p: "3" });
	const { start, end } = parsePageParam(req);
	assertEquals(start, 60);
	assertEquals(end, 90);
});

Deno.test("parsePageParam - clamps page 0 to 1", () => {
	const req = createMockRequest({ p: "0" });
	const { start, end } = parsePageParam(req);
	assertEquals(start, 0);
	assertEquals(end, 30);
});

Deno.test("parsePageParam - clamps negative page to 1", () => {
	const req = createMockRequest({ p: "-5" });
	const { start, end } = parsePageParam(req);
	assertEquals(start, 0);
	assertEquals(end, 30);
});

Deno.test("parsePageParam - clamps beyond maxend", () => {
	// maxend = 210, perpage = 30, so max page is ceil(210/30) = 7
	const req = createMockRequest({ p: "100" });
	const { start, end } = parsePageParam(req);
	assertEquals(start, 180); // (7-1) * 30
	assertEquals(end, 210); // clamped to maxend
});

Deno.test("parsePageParam - custom perpage for threads", () => {
	const req = createMockRequest({ p: "2" });
	const { start, end } = parsePageParam(req, threadsPerpage); // 10
	assertEquals(start, 10);
	assertEquals(end, 20);
});

Deno.test("parsePageParam - invalid string defaults to page 1", () => {
	const req = createMockRequest({ p: "abc" });
	const { start, end } = parsePageParam(req);
	assertEquals(start, 0);
	assertEquals(end, 30);
});

Deno.test("displayItems - shows More link when more items exist", () => {
	// create 35 items (more than perpage=30)
	const itemList: Item[] = [];
	for (let i = 1; i <= 35; i++) {
		itemList.push(createTestItem({ id: i, title: `Story ${i}` }));
	}
	const html = displayItems(null, itemList, null, undefined, "news", 0, 30);
	assertEquals(html.includes("More"), true);
	assertEquals(html.includes("news?p=2"), true);
});

Deno.test("displayItems - no More link when at end", () => {
	// create 20 items (less than perpage=30)
	const itemList: Item[] = [];
	for (let i = 1; i <= 20; i++) {
		itemList.push(createTestItem({ id: i, title: `Story ${i}` }));
	}
	const html = displayItems(null, itemList, null, undefined, "news", 0, 30);
	assertEquals(html.includes("More"), false);
});

Deno.test("displayItems - handles whence with existing query params", () => {
	// create 35 items
	const itemList: Item[] = [];
	for (let i = 1; i <= 35; i++) {
		itemList.push(createTestItem({ id: i, title: `Story ${i}` }));
	}
	const html = displayItems(
		null,
		itemList,
		null,
		undefined,
		"submitted?id=testuser",
		0,
		30,
	);
	assertEquals(html.includes("More"), true);
	// note: & is escaped to &#38; by escapeHtml in the tag function
	assertEquals(html.includes("submitted?id=testuser&#38;p=2"), true);
});

Deno.test("displayItems - pagination respects start/end", () => {
	// create 100 items
	const itemList: Item[] = [];
	for (let i = 1; i <= 100; i++) {
		itemList.push(createTestItem({ id: i, title: `Story ${i}` }));
	}
	// show page 2 (items 31-60)
	const html = displayItems(null, itemList, null, undefined, "news", 30, 60);
	assertEquals(html.includes("Story 31"), true);
	assertEquals(html.includes("Story 60"), true);
	assertEquals(html.includes("Story 30"), false);
	assertEquals(html.includes("Story 61"), false);
});

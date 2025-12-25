/**
 * tests for zod schemas
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
	BannedIpsTableSchema,
	BannedSitesTableSchema,
	ItemSchema,
	ItemTypeSchema,
	ItemVoteSchema,
	LightweightsTableSchema,
	PasswordEntrySchema,
	PasswordTableSchema,
	ProfileSchema,
	ScrubRuleSchema,
	ScrubRulesSchema,
	SessionSchema,
	SessionsTableSchema,
	SiteConfigSchema,
	UserVoteSchema,
	UserVotesTableSchema,
	VoteDirectionSchema,
} from "../src/lib/schemas.ts";

Deno.test("ProfileSchema - creates profile with defaults", () => {
	const profile = ProfileSchema.parse({});

	assertEquals(profile.id, null);
	assertEquals(profile.name, null);
	assertEquals(profile.auth, 0);
	assertEquals(profile.karma, 1);
	assertEquals(profile.weight, 0.5);
	assertEquals(profile.maxvisit, 20);
	assertEquals(profile.minaway, 180);
	assertEquals(profile.delay, 0);
	assertEquals(typeof profile.created, "number");
});

Deno.test("ProfileSchema - parses full profile", () => {
	const input = {
		id: "testuser",
		name: "Test User",
		created: 1700000000,
		auth: 1,
		member: true,
		submitted: [1, 2, 3],
		votes: [
			{
				time: 1700000000,
				id: 1,
				by: "other",
				sitename: "example.com",
				dir: "up",
			},
		],
		karma: 100,
		avg: 2.5,
		weight: 0.8,
		ignore: false,
		email: "test@example.com",
		about: "About me",
		showdead: true,
		noprocrast: false,
		firstview: 1700000000,
		lastview: 1700001000,
		maxvisit: 30,
		minaway: 120,
		topcolor: "#ff6600",
		keys: ["admin", "editor"],
		delay: 5,
	};

	const profile = ProfileSchema.parse(input);
	assertEquals(profile.id, "testuser");
	assertEquals(profile.karma, 100);
	assertEquals(profile.votes?.length, 1);
	assertEquals(profile.keys?.length, 2);
});

Deno.test("ProfileSchema - rejects invalid vote direction", () => {
	const input = {
		votes: [{
			time: 1700000000,
			id: 1,
			by: "other",
			sitename: null,
			dir: "invalid",
		}],
	};

	assertThrows(() => ProfileSchema.parse(input));
});

Deno.test("ItemTypeSchema - validates item types", () => {
	assertEquals(ItemTypeSchema.parse("story"), "story");
	assertEquals(ItemTypeSchema.parse("comment"), "comment");
	assertEquals(ItemTypeSchema.parse("poll"), "poll");
	assertEquals(ItemTypeSchema.parse("pollopt"), "pollopt");
	assertThrows(() => ItemTypeSchema.parse("invalid"));
});

Deno.test("VoteDirectionSchema - validates directions", () => {
	assertEquals(VoteDirectionSchema.parse("up"), "up");
	assertEquals(VoteDirectionSchema.parse("down"), "down");
	assertThrows(() => VoteDirectionSchema.parse("sideways"));
});

Deno.test("ItemVoteSchema - parses vote record", () => {
	const vote = ItemVoteSchema.parse({
		time: 1700000000,
		ip: "192.168.1.1",
		user: "testuser",
		dir: "up",
		score: 5,
	});

	assertEquals(vote.time, 1700000000);
	assertEquals(vote.ip, "192.168.1.1");
	assertEquals(vote.user, "testuser");
	assertEquals(vote.dir, "up");
	assertEquals(vote.score, 5);
});

Deno.test("ItemSchema - creates item with defaults", () => {
	const item = ItemSchema.parse({});

	assertEquals(item.id, null);
	assertEquals(item.type, null);
	assertEquals(item.score, 0);
	assertEquals(item.sockvotes, 0);
	assertEquals(typeof item.time, "number");
});

Deno.test("ItemSchema - parses story item", () => {
	const input = {
		id: 123,
		type: "story",
		by: "author",
		ip: "192.168.1.1",
		time: 1700000000,
		url: "https://example.com/article",
		title: "Test Story",
		text: null,
		votes: [
			{
				time: 1700000000,
				ip: "192.168.1.2",
				user: "voter",
				dir: "up",
				score: 1,
			},
		],
		score: 5,
		sockvotes: 0,
		flags: ["flagger1"],
		dead: false,
		deleted: false,
		parts: null,
		parent: null,
		kids: [124, 125],
		keys: ["nokill"],
	};

	const item = ItemSchema.parse(input);
	assertEquals(item.id, 123);
	assertEquals(item.type, "story");
	assertEquals(item.title, "Test Story");
	assertEquals(item.kids?.length, 2);
});

Deno.test("ItemSchema - parses comment item", () => {
	const input = {
		id: 124,
		type: "comment",
		by: "commenter",
		ip: "192.168.1.3",
		time: 1700001000,
		url: null,
		title: null,
		text: "This is a comment",
		score: 2,
		parent: 123,
		kids: [],
	};

	const item = ItemSchema.parse(input);
	assertEquals(item.type, "comment");
	assertEquals(item.text, "This is a comment");
	assertEquals(item.parent, 123);
});

Deno.test("ItemSchema - parses poll with parts", () => {
	const input = {
		id: 200,
		type: "poll",
		by: "pollster",
		title: "Best programming language?",
		parts: [201, 202, 203],
	};

	const item = ItemSchema.parse(input);
	assertEquals(item.type, "poll");
	assertEquals(item.parts?.length, 3);
});

Deno.test("UserVoteSchema - parses user vote", () => {
	const vote = UserVoteSchema.parse({
		dir: "up",
		time: 1700000000,
	});

	assertEquals(vote.dir, "up");
	assertEquals(vote.time, 1700000000);
});

Deno.test("UserVotesTableSchema - parses votes table", () => {
	const table = UserVotesTableSchema.parse({
		"123": { dir: "up", time: 1700000000 },
		"456": { dir: "down", time: 1700001000 },
	});

	assertEquals(table["123"].dir, "up");
	assertEquals(table["456"].dir, "down");
});

Deno.test("SessionSchema - parses session", () => {
	const session = SessionSchema.parse({
		token: "abc123",
		user: "testuser",
		ip: "192.168.1.1",
		created: 1700000000,
	});

	assertEquals(session.token, "abc123");
	assertEquals(session.user, "testuser");
});

Deno.test("SessionsTableSchema - parses sessions table", () => {
	const sessions = SessionsTableSchema.parse({
		abc123: {
			token: "abc123",
			user: "testuser",
			ip: "192.168.1.1",
			created: 1700000000,
		},
	});

	assertEquals(sessions["abc123"].user, "testuser");
});

Deno.test("PasswordEntrySchema - parses password entry", () => {
	const entry = PasswordEntrySchema.parse({
		hash: "hashedpassword",
		salt: "randomsalt",
	});

	assertEquals(entry.hash, "hashedpassword");
	assertEquals(entry.salt, "randomsalt");
});

Deno.test("PasswordTableSchema - parses password table", () => {
	const table = PasswordTableSchema.parse({
		testuser: { hash: "hash1", salt: "salt1" },
		otheruser: { hash: "hash2", salt: "salt2" },
	});

	assertEquals(table["testuser"].hash, "hash1");
});

Deno.test("BannedSitesTableSchema - parses banned sites", () => {
	const table = BannedSitesTableSchema.parse({
		"spam.com": {
			ban: "kill",
			user: "admin",
			time: 1234567890,
			info: null,
		},
		"malware.net": { ban: "ignore", user: "admin", time: 1234567891 },
	});

	assertEquals(table["spam.com"].ban, "kill");
	assertEquals(table["malware.net"].ban, "ignore");
});

Deno.test("BannedIpsTableSchema - parses banned ips", () => {
	const table = BannedIpsTableSchema.parse({
		"192.168.1.100": { user: "admin", time: 1234567890, info: null },
		"10.0.0.1": { user: "admin", time: 1234567891 },
	});

	assertEquals(table["192.168.1.100"].user, "admin");
});

Deno.test("LightweightsTableSchema - parses lightweights", () => {
	const table = LightweightsTableSchema.parse({
		"imgur.com": true,
		"gfycat.com": true,
	});

	assertEquals(table["imgur.com"], true);
});

Deno.test("ScrubRuleSchema - parses scrub rule", () => {
	const rule = ScrubRuleSchema.parse({
		find: "[VIDEO]",
		replace: "",
	});

	assertEquals(rule.find, "[VIDEO]");
	assertEquals(rule.replace, "");
});

Deno.test("ScrubRulesSchema - parses scrub rules array", () => {
	const rules = ScrubRulesSchema.parse([
		{ find: "[VIDEO]", replace: "" },
		{ find: "BREAKING:", replace: "" },
	]);

	assertEquals(rules.length, 2);
});

Deno.test("SiteConfigSchema - creates config with defaults", () => {
	const config = SiteConfigSchema.parse({});

	assertEquals(config.thisSite, "My Forum");
	assertEquals(config.siteUrl, "http://news.yourdomain.com/");
	assertEquals(config.preferUrl, true);
});

Deno.test("SiteConfigSchema - parses custom config", () => {
	const config = SiteConfigSchema.parse({
		thisSite: "My News Site",
		siteUrl: "https://news.example.com/",
		siteDesc: "A news aggregator",
		siteColour: [255, 102, 0],
	});

	assertEquals(config.thisSite, "My News Site");
	assertEquals(config.siteColour, { r: 255, g: 102, b: 0 });
});

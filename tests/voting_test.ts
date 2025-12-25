/**
 * tests for voting system
 */

import { assertEquals } from "@std/assert";
import {
	applyVote,
	canDownvote,
	canVoteOnItem,
	DOWNVOTE_RATIO_LIMIT,
	DOWNVOTE_THRESHOLD,
	downvoteRatio,
	hasVoteFromIp,
	isLegitUser,
	isPossibleSockpuppet,
	justDownvoted,
	LEGIT_THRESHOLD,
	LOWEST_SCORE,
	NEW_AGE_THRESHOLD,
	NEW_KARMA_THRESHOLD,
	shouldRerank,
	updateAuthorKarma,
	updateUserVoteRecords,
	validateVote,
	VOTE_WINDOW,
} from "../src/lib/voting.ts";
import { seconds } from "../src/lib/ranking.ts";
import type { Item, Profile, UserVotesTable } from "../src/lib/schemas.ts";

// helper to create test items
function createItem(overrides: Partial<Item> = {}): Item {
	return {
		id: 1,
		type: "story",
		by: "author",
		ip: "10.0.0.1",
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
		created: seconds() - 86400, // 1 day old
		auth: 0,
		member: null,
		submitted: null,
		votes: null,
		karma: 100,
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
// Constants
// =============================================================================

Deno.test("constants are correct", () => {
	assertEquals(LEGIT_THRESHOLD, 0);
	assertEquals(NEW_AGE_THRESHOLD, 0);
	assertEquals(NEW_KARMA_THRESHOLD, 2);
	assertEquals(DOWNVOTE_RATIO_LIMIT, 0.65);
	assertEquals(VOTE_WINDOW, 100);
});

// =============================================================================
// User validation
// =============================================================================

Deno.test("isLegitUser - editors are legit", () => {
	const profile = createProfile({ karma: 0 });
	assertEquals(isLegitUser(profile, true), true);
});

Deno.test("isLegitUser - high karma users are legit", () => {
	const profile = createProfile({ karma: 10 });
	assertEquals(isLegitUser(profile, false), true);
});

Deno.test("isLegitUser - low karma users not legit", () => {
	const profile = createProfile({ karma: 0 });
	assertEquals(isLegitUser(profile, false), false);
});

Deno.test("isPossibleSockpuppet - ignored users", () => {
	const profile = createProfile({ ignore: true });
	assertEquals(isPossibleSockpuppet(profile), true);
});

Deno.test("isPossibleSockpuppet - low weight users", () => {
	const profile = createProfile({ weight: 0.3 });
	assertEquals(isPossibleSockpuppet(profile), true);
});

Deno.test("isPossibleSockpuppet - new low karma users", () => {
	// note: NEW_AGE_THRESHOLD is 0, so any user passes age check
	// only matters if threshold is > 0
	const profile = createProfile({
		created: seconds(), // brand new
		karma: 1,
	});
	// with default thresholds, this is not a sockpuppet
	assertEquals(isPossibleSockpuppet(profile), false);
});

Deno.test("isPossibleSockpuppet - normal users", () => {
	const profile = createProfile({ karma: 100, weight: 0.5, ignore: null });
	assertEquals(isPossibleSockpuppet(profile), false);
});

// =============================================================================
// Downvote ratio
// =============================================================================

Deno.test("downvoteRatio - calculates ratio correctly", () => {
	const votes = [
		{
			vote: { dir: "down" as const, time: 1 },
			itemBy: "alice",
			ignored: false,
		},
		{
			vote: { dir: "up" as const, time: 2 },
			itemBy: "bob",
			ignored: false,
		},
		{
			vote: { dir: "down" as const, time: 3 },
			itemBy: "carol",
			ignored: false,
		},
		{
			vote: { dir: "up" as const, time: 4 },
			itemBy: "dave",
			ignored: false,
		},
	];

	const ratio = downvoteRatio(votes, "testuser");
	assertEquals(ratio, 0.5); // 2 down, 2 up
});

Deno.test("downvoteRatio - excludes votes on own items", () => {
	const votes = [
		{
			vote: { dir: "down" as const, time: 1 },
			itemBy: "testuser",
			ignored: false,
		},
		{
			vote: { dir: "up" as const, time: 2 },
			itemBy: "alice",
			ignored: false,
		},
	];

	const ratio = downvoteRatio(votes, "testuser");
	assertEquals(ratio, 0); // own vote excluded, only 1 up
});

Deno.test("downvoteRatio - excludes votes on ignored users", () => {
	const votes = [
		{
			vote: { dir: "down" as const, time: 1 },
			itemBy: "alice",
			ignored: true,
		},
		{
			vote: { dir: "up" as const, time: 2 },
			itemBy: "bob",
			ignored: false,
		},
	];

	const ratio = downvoteRatio(votes, "testuser");
	assertEquals(ratio, 0); // ignored excluded
});

Deno.test("downvoteRatio - empty votes", () => {
	const ratio = downvoteRatio([], "testuser");
	assertEquals(ratio, 0);
});

// =============================================================================
// Karma bombing
// =============================================================================

Deno.test("justDownvoted - detects karma bombing", () => {
	const recentVotes = [
		{ itemBy: "victim", dir: "down" as const },
		{ itemBy: "victim", dir: "down" as const },
		{ itemBy: "victim", dir: "down" as const },
	];

	assertEquals(justDownvoted(recentVotes, "victim"), true);
});

Deno.test("justDownvoted - not enough downvotes", () => {
	const recentVotes = [
		{ itemBy: "victim", dir: "down" as const },
		{ itemBy: "victim", dir: "down" as const },
	];

	assertEquals(justDownvoted(recentVotes, "victim"), false);
});

Deno.test("justDownvoted - mixed votes", () => {
	const recentVotes = [
		{ itemBy: "victim", dir: "down" as const },
		{ itemBy: "victim", dir: "up" as const },
		{ itemBy: "victim", dir: "down" as const },
	];

	assertEquals(justDownvoted(recentVotes, "victim"), false);
});

Deno.test("justDownvoted - different authors", () => {
	const recentVotes = [
		{ itemBy: "alice", dir: "down" as const },
		{ itemBy: "bob", dir: "down" as const },
		{ itemBy: "carol", dir: "down" as const },
	];

	assertEquals(justDownvoted(recentVotes, "victim"), false);
});

// =============================================================================
// IP detection
// =============================================================================

Deno.test("hasVoteFromIp - finds matching ip", () => {
	const item = createItem({
		votes: [
			{ time: 1, ip: "192.168.1.1", user: "alice", dir: "up", score: 1 },
		],
	});

	assertEquals(hasVoteFromIp(item, "192.168.1.1"), true);
	assertEquals(hasVoteFromIp(item, "192.168.1.2"), false);
});

Deno.test("hasVoteFromIp - no votes", () => {
	const item = createItem({ votes: null });
	assertEquals(hasVoteFromIp(item, "192.168.1.1"), false);
});

// =============================================================================
// Vote validation
// =============================================================================

Deno.test("validateVote - rejects already voted", () => {
	const user = createProfile();
	const item = createItem();
	const userVotes: UserVotesTable = { "1": { dir: "up", time: 1 } };

	const result = validateVote(
		user,
		item,
		userVotes,
		"up",
		"192.168.1.1",
		false,
	);
	assertEquals(result.valid, false);
	assertEquals(result.reason, "already voted");
});

Deno.test("validateVote - rejects dead item for non-author", () => {
	const user = createProfile({ id: "voter" });
	const item = createItem({ by: "author", dead: true });
	const userVotes: UserVotesTable = {};

	const result = validateVote(
		user,
		item,
		userVotes,
		"up",
		"192.168.1.1",
		false,
	);
	assertEquals(result.valid, false);
	assertEquals(result.reason, "item is dead");
});

Deno.test("validateVote - allows author to vote on dead item", () => {
	const user = createProfile({ id: "author" });
	const item = createItem({ by: "author", dead: true });
	const userVotes: UserVotesTable = {};

	const result = validateVote(
		user,
		item,
		userVotes,
		"up",
		"192.168.1.1",
		false,
	);
	assertEquals(result.valid, true);
});

Deno.test("validateVote - rejects ignored user on non-own item", () => {
	const user = createProfile({ id: "voter", ignore: true });
	const item = createItem({ by: "author" });
	const userVotes: UserVotesTable = {};

	const result = validateVote(
		user,
		item,
		userVotes,
		"up",
		"192.168.1.1",
		false,
	);
	assertEquals(result.valid, false);
	assertEquals(result.reason, "vote restricted");
});

Deno.test("validateVote - allows ignored user on own item", () => {
	const user = createProfile({ id: "author", ignore: true });
	const item = createItem({ by: "author" });
	const userVotes: UserVotesTable = {};

	const result = validateVote(
		user,
		item,
		userVotes,
		"up",
		"192.168.1.1",
		false,
	);
	assertEquals(result.valid, true);
});

Deno.test("validateVote - rejects downvote with nodowns key", () => {
	const user = createProfile({ id: "voter" });
	const item = createItem({ by: "author" });
	const userVotes: UserVotesTable = {};

	const result = validateVote(
		user,
		item,
		userVotes,
		"down",
		"192.168.1.1",
		false,
		[],
		true, // noDownsKey
	);
	assertEquals(result.valid, false);
	assertEquals(result.reason, "downvotes disabled");
});

Deno.test("validateVote - rejects karma bombing", () => {
	const user = createProfile({ id: "voter" });
	const item = createItem({ by: "victim" });
	const userVotes: UserVotesTable = {};
	const recentVotes = [
		{ itemBy: "victim", dir: "down" as const },
		{ itemBy: "victim", dir: "down" as const },
		{ itemBy: "victim", dir: "down" as const },
	];

	const result = validateVote(
		user,
		item,
		userVotes,
		"down",
		"192.168.1.1",
		false,
		recentVotes,
	);
	assertEquals(result.valid, false);
	assertEquals(result.reason, "karma bombing prevented");
});

Deno.test("validateVote - editors can always downvote", () => {
	const user = createProfile({ id: "editor" });
	const item = createItem({ by: "victim" });
	const userVotes: UserVotesTable = {};
	const recentVotes = [
		{ itemBy: "victim", dir: "down" as const },
		{ itemBy: "victim", dir: "down" as const },
		{ itemBy: "victim", dir: "down" as const },
	];

	const result = validateVote(
		user,
		item,
		userVotes,
		"down",
		"192.168.1.1",
		true, // isEditor
		recentVotes,
		true, // noDownsKey - ignored for editors
	);
	assertEquals(result.valid, true);
});

Deno.test("validateVote - rejects duplicate ip for non-legit user", () => {
	const user = createProfile({ id: "voter", karma: 0 }); // not legit
	const item = createItem({
		by: "author",
		votes: [{
			time: 1,
			ip: "192.168.1.1",
			user: "other",
			dir: "up",
			score: 1,
		}],
	});
	const userVotes: UserVotesTable = {};

	const result = validateVote(
		user,
		item,
		userVotes,
		"up",
		"192.168.1.1",
		false,
	);
	assertEquals(result.valid, false);
	assertEquals(result.reason, "duplicate ip vote");
});

Deno.test("validateVote - allows duplicate ip for legit user", () => {
	const user = createProfile({ id: "voter", karma: 100 }); // legit
	const item = createItem({
		by: "author",
		votes: [{
			time: 1,
			ip: "192.168.1.1",
			user: "other",
			dir: "up",
			score: 1,
		}],
	});
	const userVotes: UserVotesTable = {};

	const result = validateVote(
		user,
		item,
		userVotes,
		"up",
		"192.168.1.1",
		false,
	);
	assertEquals(result.valid, true);
});

Deno.test("validateVote - marks sockpuppet upvotes", () => {
	const user = createProfile({ id: "voter", ignore: null, weight: 0.3 }); // sockpuppet
	const item = createItem({ by: "author" });
	const userVotes: UserVotesTable = {};

	const result = validateVote(
		user,
		item,
		userVotes,
		"up",
		"192.168.1.1",
		false,
	);
	assertEquals(result.valid, true);
	assertEquals(result.isSockpuppetVote, true);
});

Deno.test("validateVote - karma counts for normal votes", () => {
	const user = createProfile({ id: "voter" });
	const item = createItem({ by: "author", ip: "10.0.0.1" });
	const userVotes: UserVotesTable = {};

	const result = validateVote(
		user,
		item,
		userVotes,
		"up",
		"192.168.1.1",
		false,
	);
	assertEquals(result.valid, true);
	assertEquals(result.shouldCountForKarma, true);
});

Deno.test("validateVote - no karma for self-vote", () => {
	const user = createProfile({ id: "author" });
	const item = createItem({ by: "author" });
	const userVotes: UserVotesTable = {};

	const result = validateVote(
		user,
		item,
		userVotes,
		"up",
		"192.168.1.1",
		false,
	);
	assertEquals(result.valid, true);
	assertEquals(result.shouldCountForKarma, false);
});

Deno.test("validateVote - no karma for same ip non-editor", () => {
	const user = createProfile({ id: "voter" });
	const item = createItem({ by: "author", ip: "192.168.1.1" });
	const userVotes: UserVotesTable = {};

	const result = validateVote(
		user,
		item,
		userVotes,
		"up",
		"192.168.1.1",
		false,
	);
	assertEquals(result.valid, true);
	assertEquals(result.shouldCountForKarma, false);
});

Deno.test("validateVote - no karma for pollopt", () => {
	const user = createProfile({ id: "voter" });
	const item = createItem({ by: "author", type: "pollopt" });
	const userVotes: UserVotesTable = {};

	const result = validateVote(
		user,
		item,
		userVotes,
		"up",
		"192.168.1.1",
		false,
	);
	assertEquals(result.valid, true);
	assertEquals(result.shouldCountForKarma, false);
});

// =============================================================================
// Apply vote
// =============================================================================

Deno.test("applyVote - increments score for upvote", () => {
	const item = createItem({ score: 10 });
	const user = createProfile();
	const validation = {
		valid: true,
		shouldCountForScore: true,
		shouldCountForKarma: true,
		isSockpuppetVote: false,
	};

	applyVote(item, user, "up", "192.168.1.1", validation, false);
	assertEquals(item.score, 11);
});

Deno.test("applyVote - decrements score for downvote", () => {
	const item = createItem({ score: 10 });
	const user = createProfile();
	const validation = {
		valid: true,
		shouldCountForScore: true,
		shouldCountForKarma: true,
		isSockpuppetVote: false,
	};

	applyVote(item, user, "down", "192.168.1.1", validation, false);
	assertEquals(item.score, 9);
});

Deno.test("applyVote - increments sockvotes for sockpuppet", () => {
	const item = createItem({ sockvotes: 0 });
	const user = createProfile();
	const validation = {
		valid: true,
		shouldCountForScore: true,
		shouldCountForKarma: true,
		isSockpuppetVote: true,
	};

	applyVote(item, user, "up", "192.168.1.1", validation, false);
	assertEquals(item.sockvotes, 1);
});

Deno.test("applyVote - adds nokill key for admin", () => {
	const item = createItem({ keys: null });
	const user = createProfile();
	const validation = {
		valid: true,
		shouldCountForScore: true,
		shouldCountForKarma: true,
		isSockpuppetVote: false,
	};

	applyVote(item, user, "up", "192.168.1.1", validation, true);
	assertEquals(item.keys?.includes("nokill"), true);
});

Deno.test("applyVote - creates vote record", () => {
	const item = createItem({ votes: null });
	const user = createProfile({ id: "voter" });
	const validation = {
		valid: true,
		shouldCountForScore: true,
		shouldCountForKarma: true,
		isSockpuppetVote: false,
	};

	const vote = applyVote(item, user, "up", "192.168.1.1", validation, false);

	assertEquals(vote.user, "voter");
	assertEquals(vote.dir, "up");
	assertEquals(vote.ip, "192.168.1.1");
	assertEquals(item.votes?.length, 1);
});

// =============================================================================
// User vote records
// =============================================================================

Deno.test("updateUserVoteRecords - adds to user votes", () => {
	const user = createProfile({ votes: null });
	const userVotes: UserVotesTable = {};
	const item = createItem({
		id: 123,
		by: "author",
		url: "https://example.com",
	});

	updateUserVoteRecords(user, userVotes, item, "up");

	assertEquals(user.votes?.length, 1);
	assertEquals(user.votes?.[0].id, 123);
	assertEquals(user.votes?.[0].dir, "up");
	assertEquals(userVotes["123"].dir, "up");
});

Deno.test("updateUserVoteRecords - trims to window size", () => {
	const existingVotes = Array.from({ length: 100 }, (_, i) => ({
		time: i,
		id: i,
		by: "author",
		sitename: null,
		dir: "up" as const,
	}));
	const user = createProfile({ votes: existingVotes });
	const userVotes: UserVotesTable = {};
	const item = createItem({ id: 200 });

	updateUserVoteRecords(user, userVotes, item, "up");

	assertEquals(user.votes?.length, VOTE_WINDOW);
	assertEquals(user.votes?.[0].id, 200); // newest first
});

// =============================================================================
// Author karma
// =============================================================================

Deno.test("updateAuthorKarma - increments for upvote", () => {
	const author = createProfile({ karma: 100 });
	updateAuthorKarma(author, "up");
	assertEquals(author.karma, 101);
});

Deno.test("updateAuthorKarma - decrements for downvote", () => {
	const author = createProfile({ karma: 100 });
	updateAuthorKarma(author, "down");
	assertEquals(author.karma, 99);
});

// =============================================================================
// Utilities
// =============================================================================

Deno.test("canDownvote - under limit", () => {
	assertEquals(canDownvote(0.5), true);
	assertEquals(canDownvote(0.65), true);
});

Deno.test("canDownvote - over limit", () => {
	assertEquals(canDownvote(0.66), false);
	assertEquals(canDownvote(1), false);
});

Deno.test("shouldRerank - stories and polls", () => {
	assertEquals(shouldRerank(createItem({ type: "story" })), true);
	assertEquals(shouldRerank(createItem({ type: "poll" })), true);
	assertEquals(shouldRerank(createItem({ type: "comment" })), false);
	assertEquals(shouldRerank(createItem({ type: "pollopt" })), false);
});

// =============================================================================
// canVoteOnItem
// =============================================================================

Deno.test("canVoteOnItem - requires logged in user", () => {
	const item = createItem({ type: "comment" });
	const userVotes: UserVotesTable = {};

	assertEquals(canVoteOnItem(null, item, userVotes, "up"), false);
	assertEquals(canVoteOnItem(null, item, userVotes, "down"), false);
});

Deno.test("canVoteOnItem - upvote on live item", () => {
	const user = createProfile({ id: "voter", karma: 100 });
	const item = createItem({ type: "story" });
	const userVotes: UserVotesTable = {};

	assertEquals(canVoteOnItem(user, item, userVotes, "up"), true);
});

Deno.test("canVoteOnItem - cannot vote on dead item", () => {
	const user = createProfile({ id: "voter", karma: 100 });
	const item = createItem({ type: "comment", dead: true });
	const userVotes: UserVotesTable = {};

	assertEquals(canVoteOnItem(user, item, userVotes, "up"), false);
});

Deno.test("canVoteOnItem - cannot vote twice", () => {
	const user = createProfile({ id: "voter", karma: 100 });
	const item = createItem({ id: 123, type: "comment" });
	const userVotes: UserVotesTable = { "123": { dir: "up", time: seconds() } };

	assertEquals(canVoteOnItem(user, item, userVotes, "up"), false);
});

Deno.test("canVoteOnItem - downvote requires comment", () => {
	const user = createProfile({ id: "voter", karma: DOWNVOTE_THRESHOLD + 1 });
	const story = createItem({ type: "story" });
	const comment = createItem({ type: "comment" });
	const userVotes: UserVotesTable = {};

	assertEquals(canVoteOnItem(user, story, userVotes, "down"), false);
	assertEquals(canVoteOnItem(user, comment, userVotes, "down"), true);
});

Deno.test("canVoteOnItem - downvote requires enough karma", () => {
	const lowKarmaUser = createProfile({
		id: "voter",
		karma: DOWNVOTE_THRESHOLD,
	});
	const highKarmaUser = createProfile({
		id: "voter",
		karma: DOWNVOTE_THRESHOLD + 1,
	});
	const item = createItem({ type: "comment" });
	const userVotes: UserVotesTable = {};

	assertEquals(canVoteOnItem(lowKarmaUser, item, userVotes, "down"), false);
	assertEquals(canVoteOnItem(highKarmaUser, item, userVotes, "down"), true);
});

Deno.test("canVoteOnItem - cannot downvote below minimum score", () => {
	const user = createProfile({ id: "voter", karma: DOWNVOTE_THRESHOLD + 1 });
	const item = createItem({ type: "comment", score: LOWEST_SCORE });
	const userVotes: UserVotesTable = {};

	assertEquals(canVoteOnItem(user, item, userVotes, "down"), false);
});

Deno.test("canVoteOnItem - cannot downvote reply to own comment", () => {
	const user = createProfile({ id: "voter", karma: DOWNVOTE_THRESHOLD + 1 });
	const item = createItem({ type: "comment", by: "replier", parent: 99 });
	const userVotes: UserVotesTable = {};

	// parent by is the voter - cannot downvote
	assertEquals(
		canVoteOnItem(user, item, userVotes, "down", "voter"),
		false,
	);
	// parent by is someone else - can downvote
	assertEquals(
		canVoteOnItem(user, item, userVotes, "down", "otheruser"),
		true,
	);
});

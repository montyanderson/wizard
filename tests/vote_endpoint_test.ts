/**
 * tests for vote endpoint validation
 *
 * these tests verify that the vote endpoint properly validates votes
 * using canVoteOnItem() to prevent vote fraud and abuse
 */

import { assertEquals } from "@std/assert";
import { canVoteOnItem } from "../src/lib/voting.ts";
import { type Item, type Profile, ProfileSchema } from "../src/lib/schemas.ts";
import { seconds } from "../src/lib/ranking.ts";

// helper to create test profile
function createProfile(overrides: Partial<Profile> = {}): Profile {
	return ProfileSchema.parse({
		id: "testuser",
		created: seconds(),
		karma: 250, // above downvote threshold by default
		avg: null,
		weight: 0.5,
		ignore: null,
		email: null,
		showdead: null,
		noprocrast: null,
		firstview: null,
		maxvisit: 20000,
		minaway: 180,
		delay: 0,
		about: null,
		keys: [],
		submitted: [],
		...overrides,
	});
}

// helper to create test item
function createItem(overrides: Partial<Item> = {}): Item {
	return {
		id: 1,
		type: "comment",
		by: "author",
		ip: "127.0.0.1",
		time: seconds(),
		url: null,
		title: null,
		text: "test comment",
		votes: [],
		score: 5,
		sockvotes: 0,
		flags: [],
		dead: false,
		deleted: false,
		parts: [],
		parent: null,
		kids: [],
		keys: [],
		...overrides,
	};
}

// =============================================================================
// upvote tests
// =============================================================================

Deno.test("canVoteOnItem - allows valid upvote", () => {
	const user = createProfile({ karma: 10 }); // even low karma can upvote
	const item = createItem();
	const result = canVoteOnItem(user, item, {}, "up", null);
	assertEquals(result, true);
});

Deno.test("canVoteOnItem - allows upvote on story", () => {
	const user = createProfile();
	const item = createItem({ type: "story" });
	const result = canVoteOnItem(user, item, {}, "up", null);
	assertEquals(result, true);
});

Deno.test("canVoteOnItem - allows upvote on poll", () => {
	const user = createProfile();
	const item = createItem({ type: "poll" });
	const result = canVoteOnItem(user, item, {}, "up", null);
	assertEquals(result, true);
});

// =============================================================================
// downvote karma tests
// =============================================================================

Deno.test("canVoteOnItem - rejects downvote with low karma", () => {
	const user = createProfile({ karma: 10 }); // below 200 threshold
	const item = createItem();
	const result = canVoteOnItem(user, item, {}, "down", null);
	assertEquals(result, false);
});

Deno.test("canVoteOnItem - rejects downvote at threshold", () => {
	const user = createProfile({ karma: 200 }); // exactly at threshold
	const item = createItem();
	const result = canVoteOnItem(user, item, {}, "down", null);
	assertEquals(result, false);
});

Deno.test("canVoteOnItem - allows downvote above threshold", () => {
	const user = createProfile({ karma: 201 }); // just above threshold
	const item = createItem();
	const result = canVoteOnItem(user, item, {}, "down", null);
	assertEquals(result, true);
});

// =============================================================================
// downvote type restriction tests
// =============================================================================

Deno.test("canVoteOnItem - rejects downvote on story", () => {
	const user = createProfile({ karma: 1000 });
	const item = createItem({ type: "story" });
	const result = canVoteOnItem(user, item, {}, "down", null);
	assertEquals(result, false);
});

Deno.test("canVoteOnItem - rejects downvote on poll", () => {
	const user = createProfile({ karma: 1000 });
	const item = createItem({ type: "poll" });
	const result = canVoteOnItem(user, item, {}, "down", null);
	assertEquals(result, false);
});

Deno.test("canVoteOnItem - allows downvote on comment", () => {
	const user = createProfile({ karma: 1000 });
	const item = createItem({ type: "comment" });
	const result = canVoteOnItem(user, item, {}, "down", null);
	assertEquals(result, true);
});

// =============================================================================
// downvote score limit tests
// =============================================================================

Deno.test("canVoteOnItem - rejects downvote at minimum score", () => {
	const user = createProfile({ karma: 1000 });
	const item = createItem({ score: -4 }); // at minimum
	const result = canVoteOnItem(user, item, {}, "down", null);
	assertEquals(result, false);
});

Deno.test("canVoteOnItem - rejects downvote below minimum score", () => {
	const user = createProfile({ karma: 1000 });
	const item = createItem({ score: -5 }); // below minimum
	const result = canVoteOnItem(user, item, {}, "down", null);
	assertEquals(result, false);
});

Deno.test("canVoteOnItem - allows downvote above minimum score", () => {
	const user = createProfile({ karma: 1000 });
	const item = createItem({ score: -3 }); // above minimum
	const result = canVoteOnItem(user, item, {}, "down", null);
	assertEquals(result, true);
});

// =============================================================================
// downvote parent comment tests
// =============================================================================

Deno.test("canVoteOnItem - rejects downvote on reply to own comment", () => {
	const user = createProfile({ id: "alice", karma: 1000 });
	const item = createItem({ by: "bob", parent: 1 });
	const parentBy = "alice"; // alice's comment
	const result = canVoteOnItem(user, item, {}, "down", parentBy);
	assertEquals(result, false);
});

Deno.test("canVoteOnItem - allows downvote on reply to others' comment", () => {
	const user = createProfile({ id: "alice", karma: 1000 });
	const item = createItem({ by: "bob", parent: 1 });
	const parentBy = "charlie"; // someone else's comment
	const result = canVoteOnItem(user, item, {}, "down", parentBy);
	assertEquals(result, true);
});

Deno.test("canVoteOnItem - allows downvote on top-level comment", () => {
	const user = createProfile({ id: "alice", karma: 1000 });
	const item = createItem({ by: "bob", parent: null });
	const result = canVoteOnItem(user, item, {}, "down", null);
	assertEquals(result, true);
});

// =============================================================================
// double voting tests
// =============================================================================

Deno.test("canVoteOnItem - rejects double vote", () => {
	const user = createProfile();
	const item = createItem({ id: 42 });
	const userVotes = { "42": { time: seconds(), dir: "up" as const } };
	const result = canVoteOnItem(user, item, userVotes, "up", null);
	assertEquals(result, false);
});

Deno.test("canVoteOnItem - allows first vote", () => {
	const user = createProfile();
	const item = createItem({ id: 42 });
	const userVotes = {}; // no previous votes
	const result = canVoteOnItem(user, item, userVotes, "up", null);
	assertEquals(result, true);
});

// =============================================================================
// dead item tests
// =============================================================================

Deno.test("canVoteOnItem - rejects vote on dead item", () => {
	const user = createProfile();
	const item = createItem({ dead: true });
	const result = canVoteOnItem(user, item, {}, "up", null);
	assertEquals(result, false);
});

Deno.test("canVoteOnItem - rejects vote on deleted item", () => {
	const user = createProfile();
	const item = createItem({ deleted: true });
	const result = canVoteOnItem(user, item, {}, "up", null);
	assertEquals(result, false);
});

Deno.test("canVoteOnItem - allows vote on live item", () => {
	const user = createProfile();
	const item = createItem({ dead: false, deleted: false });
	const result = canVoteOnItem(user, item, {}, "up", null);
	assertEquals(result, true);
});

// =============================================================================
// edge cases
// =============================================================================

Deno.test("canVoteOnItem - rejects null profile", () => {
	const item = createItem();
	const result = canVoteOnItem(null, item, {}, "up", null);
	assertEquals(result, false);
});

Deno.test("canVoteOnItem - high karma user can downvote", () => {
	const user = createProfile({ karma: 10000 });
	const item = createItem();
	const result = canVoteOnItem(user, item, {}, "down", null);
	assertEquals(result, true);
});

Deno.test("canVoteOnItem - prevents all downvote abuse scenarios", () => {
	// low karma trying to downvote
	assertEquals(
		canVoteOnItem(
			createProfile({ karma: 50 }),
			createItem(),
			{},
			"down",
			null,
		),
		false,
	);

	// downvoting story
	assertEquals(
		canVoteOnItem(
			createProfile({ karma: 1000 }),
			createItem({ type: "story" }),
			{},
			"down",
			null,
		),
		false,
	);

	// downvoting low score item
	assertEquals(
		canVoteOnItem(
			createProfile({ karma: 1000 }),
			createItem({ score: -4 }),
			{},
			"down",
			null,
		),
		false,
	);

	// downvoting reply to own comment
	assertEquals(
		canVoteOnItem(
			createProfile({ id: "alice", karma: 1000 }),
			createItem({ parent: 1 }),
			{},
			"down",
			"alice",
		),
		false,
	);
});

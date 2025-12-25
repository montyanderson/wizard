/**
 * voting system for arc news clone
 *
 * based on arc3.2/news.arc lines 1325-1416 (voting)
 */

import type {
	Item,
	ItemVote,
	Profile,
	UserVote,
	UserVotesTable,
	VoteDirection,
} from "./schemas.ts";
import {
	isAuthor,
	isLive,
	isMetastory,
	seconds,
	sitename,
	userAge,
} from "./ranking.ts";

/**
 * voting constants
 *
 * arc: (= legit-threshold* 0 new-age-threshold* 0 new-karma-threshold* 2)
 *      (= downvote-ratio-limit* .65 recent-votes* nil votewindow* 100)
 *      (= downvote-threshold* 200 downvote-time* 1440)
 *      (= lowest-score* -4)
 */
export const LEGIT_THRESHOLD = 0;
export const NEW_AGE_THRESHOLD = 0;
export const NEW_KARMA_THRESHOLD = 2;
export const DOWNVOTE_RATIO_LIMIT = 0.65;
export const VOTE_WINDOW = 100;
export const DOWNVOTE_THRESHOLD = 200; // min karma to downvote
export const DOWNVOTE_TIME = 1440; // item age in minutes (24 hours)
export const LOWEST_SCORE = -4; // minimum score (can't downvote below this)

/**
 * additional constants
 *
 * arc: (= comment-threshold* -20)
 *      (= reply-decay* 1.8)
 *      (= ip-ban-threshold* 3)
 */
export const COMMENT_THRESHOLD = -20; // karma below this = bad user
export const REPLY_DECAY = 1.8; // exponent for reply depth delays
export const IP_BAN_THRESHOLD = 3; // ignored users from same ip to trigger ban

/**
 * recent votes stored globally for tracking
 */
export interface RecentVote {
	itemId: number;
	time: number;
	ip: string;
	user: string;
	dir: VoteDirection;
	score: number;
}

/**
 * check if user is a legit user (editor or has enough karma)
 *
 * arc: (def legit-user (user)
 *        (or (editor user)
 *            (> (karma user) legit-threshold*)))
 */
export function isLegitUser(
	profile: Profile,
	isEditor: boolean,
): boolean {
	return isEditor || profile.karma > LEGIT_THRESHOLD;
}

/**
 * check if user is a possible sockpuppet
 *
 * arc: (def possible-sockpuppet (user)
 *        (or (ignored user)
 *            (< (uvar user weight) .5)
 *            (and (< (user-age user) new-age-threshold*)
 *                 (< (karma user) new-karma-threshold*))))
 */
export function isPossibleSockpuppet(profile: Profile): boolean {
	// ignored user
	if (profile.ignore) return true;

	// low weight (manually downweighted)
	if (profile.weight < 0.5) return true;

	// new user with low karma
	if (
		userAge(profile) < NEW_AGE_THRESHOLD &&
		profile.karma < NEW_KARMA_THRESHOLD
	) {
		return true;
	}

	return false;
}

/**
 * calculate downvote ratio from recent votes
 *
 * arc: (def downvote-ratio (user (o sample 20))
 *        (ratio [is _.1.3 'down]
 *               (keep [let by ((item (car _)) 'by)
 *                       (nor (is by user) (ignored by))]
 *                     (bestn sample (compare > car:cadr) (tablist (votes user))))))
 *
 * @param votes - user's recent votes with item info
 * @param userId - current user id
 * @param sample - number of votes to sample
 */
export function downvoteRatio(
	votes: Array<{ vote: UserVote; itemBy: string | null; ignored: boolean }>,
	userId: string,
	sample: number = 20,
): number {
	// filter out votes on own items and ignored users
	const validVotes = votes
		.filter((v) => v.itemBy !== userId && !v.ignored)
		.slice(0, sample);

	if (validVotes.length === 0) return 0;

	const downvotes = validVotes.filter((v) => v.vote.dir === "down").length;
	return downvotes / validVotes.length;
}

/**
 * check if user just downvoted the same author n times in a row
 * (karma bombing prevention)
 *
 * arc: (def just-downvoted (user victim (o n 3))
 *        (let prev (firstn n (recent-votes-by user))
 *          (and (is (len prev) n)
 *               (all (fn ((id sec ip voter dir score))
 *                      (and (author victim (item id)) (is dir 'down)))
 *                    prev))))
 *
 * @param recentVotes - recent votes by user
 * @param victimId - potential victim user id
 * @param n - number of consecutive downvotes to check
 */
export function justDownvoted(
	recentVotes: Array<{ itemBy: string | null; dir: VoteDirection }>,
	victimId: string,
	n: number = 3,
): boolean {
	if (recentVotes.length < n) return false;

	const prev = recentVotes.slice(0, n);
	return prev.every((v) => v.itemBy === victimId && v.dir === "down");
}

/**
 * check if vote has already been cast from same ip
 */
export function hasVoteFromIp(item: Item, ip: string): boolean {
	if (!item.votes) return false;
	return item.votes.some((v) => v.ip === ip);
}

/**
 * result of a vote attempt
 */
export interface VoteResult {
	success: boolean;
	error?: string;
	item?: Item;
	profile?: Profile;
}

/**
 * validation result for a vote
 */
export interface VoteValidation {
	valid: boolean;
	reason?: string;
	shouldCountForScore: boolean;
	shouldCountForKarma: boolean;
	isSockpuppetVote: boolean;
}

/**
 * validate if a vote is allowed and how it should be counted
 *
 * arc: vote-for validation logic (lines 1351-1389)
 *
 * @param user - voting user profile
 * @param item - item being voted on
 * @param userVotes - user's existing votes table
 * @param dir - vote direction
 * @param ip - user's current ip
 * @param isEditor - whether user is an editor
 * @param recentVotesData - recent votes for karma bombing check
 * @param noDownsKey - whether user has nodowns key
 * @param noVoteKey - whether user has novote key
 */
export function validateVote(
	user: Profile,
	item: Item,
	userVotes: UserVotesTable,
	dir: VoteDirection,
	ip: string,
	isEditor: boolean,
	recentVotesData: Array<{ itemBy: string | null; dir: VoteDirection }> = [],
	noDownsKey: boolean = false,
	noVoteKey: boolean = false,
): VoteValidation {
	const userId = user.id!;
	const isUserAuthor = isAuthor(userId, item);

	// arc: (unless (or ((votes user) i!id) ...)
	// already voted
	if (userVotes[String(item.id)]) {
		return {
			valid: false,
			reason: "already voted",
			shouldCountForScore: false,
			shouldCountForKarma: false,
			isSockpuppetVote: false,
		};
	}

	// arc: (and (~live i) (isnt user i!by))
	// can't vote on dead items unless author
	if (!isLive(item) && !isUserAuthor) {
		return {
			valid: false,
			reason: "item is dead",
			shouldCountForScore: false,
			shouldCountForKarma: false,
			isSockpuppetVote: false,
		};
	}

	// arc: (and (or (ignored user) (check-key user 'novote)) (isnt user i!by))
	// ignored users or users with novote key can only vote on own items
	if ((user.ignore || noVoteKey) && !isUserAuthor) {
		return {
			valid: false,
			reason: "vote restricted",
			shouldCountForScore: false,
			shouldCountForKarma: false,
			isSockpuppetVote: false,
		};
	}

	// downvote-specific checks
	if (dir === "down") {
		// arc: (~editor user)
		if (!isEditor) {
			// arc: (check-key user 'nodowns)
			if (noDownsKey) {
				return {
					valid: false,
					reason: "downvotes disabled",
					shouldCountForScore: false,
					shouldCountForKarma: false,
					isSockpuppetVote: false,
				};
			}

			// arc: (> (downvote-ratio user) downvote-ratio-limit*)
			// this check requires external data, so we'll return a flag
			// the caller should check downvote ratio separately

			// arc: (just-downvoted user i!by)
			if (item.by && justDownvoted(recentVotesData, item.by)) {
				return {
					valid: false,
					reason: "karma bombing prevented",
					shouldCountForScore: false,
					shouldCountForKarma: false,
					isSockpuppetVote: false,
				};
			}
		}
	}

	// arc: (and (~legit-user user) (isnt user i!by) (find [is (cadr _) ip] i!votes))
	// non-legit users can't vote if same IP already voted
	if (
		!isLegitUser(user, isEditor) && !isUserAuthor && hasVoteFromIp(item, ip)
	) {
		return {
			valid: false,
			reason: "duplicate ip vote",
			shouldCountForScore: false,
			shouldCountForKarma: false,
			isSockpuppetVote: false,
		};
	}

	// vote is valid - determine how it should count
	const isSockpuppet = dir === "up" && isPossibleSockpuppet(user);

	// arc: (unless (or (author user i) (and (is ip i!ip) (~editor user)) (is i!type 'pollopt))
	//        (++ (karma i!by) ...))
	// karma counts unless: author voting on own item, same IP as item creator (non-editor), or pollopt
	const shouldCountForKarma = !isUserAuthor &&
		!(ip === item.ip && !isEditor) &&
		item.type !== "pollopt";

	return {
		valid: true,
		shouldCountForScore: true,
		shouldCountForKarma,
		isSockpuppetVote: isSockpuppet,
	};
}

/**
 * apply a vote to an item (mutates the item)
 *
 * arc: vote-for score/vote modifications (lines 1369-1381)
 *
 * @param item - item to vote on (mutated)
 * @param user - voting user profile (mutated)
 * @param dir - vote direction
 * @param ip - user's ip
 * @param validation - result from validateVote
 * @param isAdmin - whether user is admin
 */
export function applyVote(
	item: Item,
	user: Profile,
	dir: VoteDirection,
	ip: string,
	validation: VoteValidation,
	isAdmin: boolean,
): ItemVote {
	const scoreChange = dir === "up" ? 1 : -1;

	// arc: (++ i!score (case dir up 1 down -1))
	item.score += scoreChange;

	// arc: (when (and (is dir 'up) (possible-sockpuppet user))
	//        (++ i!sockvotes))
	if (validation.isSockpuppetVote) {
		item.sockvotes++;
	}

	// arc: (if (admin user) (pushnew 'nokill i!keys))
	if (isAdmin) {
		if (!item.keys) item.keys = [];
		if (!item.keys.includes("nokill")) {
			item.keys.push("nokill");
		}
	}

	// create the vote record
	// arc: (withs (ip (logins* user) vote (list (seconds) ip user dir i!score))
	const vote: ItemVote = {
		time: seconds(),
		ip,
		user: user.id!,
		dir,
		score: item.score,
	};

	// arc: (push vote i!votes)
	if (!item.votes) item.votes = [];
	item.votes.unshift(vote);

	return vote;
}

/**
 * update user's vote records after voting
 *
 * arc: lines 1382-1388
 *
 * @param user - user profile (mutated)
 * @param userVotes - user's votes table (mutated)
 * @param item - item that was voted on
 * @param dir - vote direction
 */
export function updateUserVoteRecords(
	user: Profile,
	userVotes: UserVotesTable,
	item: Item,
	dir: VoteDirection,
): void {
	const itemId = item.id!;

	// arc: (push (list (seconds) i!id i!by (sitename i!url) dir) (uvar user votes))
	if (!user.votes) user.votes = [];
	user.votes.unshift({
		time: seconds(),
		id: itemId,
		by: item.by ?? "",
		sitename: sitename(item.url),
		dir,
	});

	// arc: (= ((votes* user) i!id) vote)
	const userVote: UserVote = {
		dir,
		time: seconds(),
	};
	userVotes[String(itemId)] = userVote;

	// arc: (zap [firstn votewindow* _] (uvar user votes))
	// keep only recent votes
	if (user.votes.length > VOTE_WINDOW) {
		user.votes = user.votes.slice(0, VOTE_WINDOW);
	}
}

/**
 * update karma for item author after a vote
 *
 * arc: (++ (karma i!by) (case dir up 1 down -1))
 *
 * @param authorProfile - author's profile (mutated)
 * @param dir - vote direction
 */
export function updateAuthorKarma(
	authorProfile: Profile,
	dir: VoteDirection,
): void {
	authorProfile.karma += dir === "up" ? 1 : -1;
}

/**
 * check if user can downvote based on ratio
 *
 * @param ratio - current downvote ratio
 */
export function canDownvote(ratio: number): boolean {
	return ratio <= DOWNVOTE_RATIO_LIMIT;
}

/**
 * check if user can downvote a specific item
 *
 * arc: (def canvote (user i dir)
 *        (and user
 *             (news-type&live i)
 *             (or (is dir 'up) (> i!score lowest-score*))
 *             (no ((votes user) i!id))
 *             (or (is dir 'up)
 *                 (and (acomment i)
 *                      (> (karma user) downvote-threshold*)
 *                      (no (aand i!parent (author user (item it))))))))
 *
 * @param profile - user profile (or null)
 * @param item - item to vote on
 * @param userVotes - user's existing votes
 * @param parentBy - author of parent item (for comment downvote check)
 */
export function canVoteOnItem(
	profile: Profile | null,
	item: Item,
	userVotes: UserVotesTable,
	dir: "up" | "down",
	parentBy: string | null = null,
): boolean {
	// must be logged in
	if (!profile) return false;

	// must be live
	if (!isLive(item)) return false;

	// for downvote, score must be above minimum
	if (dir === "down" && item.score <= LOWEST_SCORE) return false;

	// can't vote twice
	if (userVotes[String(item.id)]) return false;

	// upvotes have no further restrictions
	if (dir === "up") return true;

	// downvotes: comments only
	if (item.type !== "comment") return false;

	// downvotes: user must have enough karma
	if (profile.karma <= DOWNVOTE_THRESHOLD) return false;

	// downvotes: can't downvote replies to own comments
	if (parentBy && parentBy === profile.id) return false;

	return true;
}

/**
 * check if item should be reranked after vote
 *
 * arc: (metastory&adjust-rank i)
 */
export function shouldRerank(item: Item): boolean {
	return isMetastory(item);
}

/**
 * ranking algorithms for arc news clone
 *
 * based on arc3.2/news.arc lines 262-379 (ranking, visibility)
 */

import type { Item, LightweightsTable, Profile } from "./schemas.ts";

/**
 * ranking constants
 *
 * arc: (= gravity* 1.8 timebase* 120 front-threshold* 1
 *         nourl-factor* .4 lightweight-factor* .3 )
 */
export const GRAVITY = 1.8;
export const TIMEBASE = 120; // minutes
export const FRONT_THRESHOLD = 1;
export const NOURL_FACTOR = 0.4;
export const LIGHTWEIGHT_FACTOR = 0.3;
export const MAX_DELAY = 10; // minutes

/**
 * multi-tld countries for sitename parsing
 *
 * arc: (= multi-tld-countries* '("uk" "jp" "au" "in" "ph" "tr" "za" "my" "nz" "br"
 *                                "mx" "th" "sg" "id" "pk" "eg" "il" "at" "pl"))
 */
export const MULTI_TLD_COUNTRIES = [
	"uk",
	"jp",
	"au",
	"in",
	"ph",
	"tr",
	"za",
	"my",
	"nz",
	"br",
	"mx",
	"th",
	"sg",
	"id",
	"pk",
	"eg",
	"il",
	"at",
	"pl",
];

/**
 * long domains for sitename parsing
 *
 * arc: (= long-domains* '("blogspot" "wordpress" "livejournal" "blogs" "typepad"
 *                         "weebly" "posterous" "blog-city" "supersized" "dreamhosters"
 *                         "eurekster" "blogsome" "edogo" "blog" "com"))
 */
export const LONG_DOMAINS = [
	"blogspot",
	"wordpress",
	"livejournal",
	"blogs",
	"typepad",
	"weebly",
	"posterous",
	"blog-city",
	"supersized",
	"dreamhosters",
	"eurekster",
	"blogsome",
	"edogo",
	"blog",
	"com",
];

/**
 * get current time in seconds since epoch
 */
export function seconds(): number {
	return Math.floor(Date.now() / 1000);
}

/**
 * minutes since a timestamp
 *
 * arc: (def minutes-since (t1) (/ (since t1) 60))
 */
export function minutesSince(timestamp: number): number {
	return (seconds() - timestamp) / 60;
}

/**
 * item age in minutes
 *
 * arc: (def item-age (i) (minutes-since i!time))
 */
export function itemAge(item: Item): number {
	return minutesSince(item.time);
}

/**
 * user age in minutes
 *
 * arc: (def user-age (u) (minutes-since (uvar u created)))
 */
export function userAge(profile: Profile): number {
	return minutesSince(profile.created);
}

/**
 * real score (score minus sockpuppet votes)
 *
 * arc: (def realscore (i) (- i!score i!sockvotes))
 */
export function realScore(item: Item): number {
	return item.score - item.sockvotes;
}

/**
 * check if item is a story
 *
 * arc: (def astory (i) (is i!type 'story))
 */
export function isStory(item: Item): boolean {
	return item.type === "story";
}

/**
 * check if item is a comment
 *
 * arc: (def acomment (i) (is i!type 'comment))
 */
export function isComment(item: Item): boolean {
	return item.type === "comment";
}

/**
 * check if item is a poll
 *
 * arc: (def apoll (i) (is i!type 'poll))
 */
export function isPoll(item: Item): boolean {
	return item.type === "poll";
}

/**
 * check if item is a story or poll (metastory)
 *
 * arc: (def metastory (i) (and i (in i!type 'story 'poll)))
 */
export function isMetastory(item: Item | null): boolean {
	return item !== null && (item.type === "story" || item.type === "poll");
}

/**
 * check if item is live (not dead and not deleted)
 *
 * arc: (def live (i) (nor i!dead i!deleted))
 */
export function isLive(item: Item): boolean {
	return !item.dead && !item.deleted;
}

/**
 * check if string is blank (null, undefined, or empty)
 */
export function isBlank(s: string | null | undefined): boolean {
	return s === null || s === undefined || s.trim() === "";
}

/**
 * check if url is valid (starts with http:// or https://)
 */
export function isValidUrl(url: string | null): boolean {
	if (!url) return false;
	return url.startsWith("http://") || url.startsWith("https://");
}

/**
 * parse site from url - extracts domain parts in reverse order
 *
 * arc: (def parse-site (url)
 *        (rev (tokens (cadr (tokens url [in _ #\/ #\?])) #\.)))
 */
export function parseSite(url: string): string[] {
	// remove spaces
	url = url.replace(/\s/g, "");

	// extract the host part (between :// and first / or ?)
	const match = url.match(/^https?:\/\/([^/?]+)/);
	if (!match) return [];

	const host = match[1];
	// split by . and reverse
	return host.split(".").reverse();
}

/**
 * extract site name from url
 *
 * arc: (defmemo sitename (url)
 *        (and (valid-url url)
 *             (let toks (parse-site (rem #\space url))
 *               (if (isa (saferead (car toks)) 'int)
 *                   (tostring (prall toks "" "."))
 *                   (let (t1 t2 t3 . rest) toks
 *                     (if (and (~in t3 nil "www")
 *                              (or (mem t1 multi-tld-countries*)
 *                                  (mem t2 long-domains*)))
 *                         (+ t3 "." t2 "." t1)
 *                         (and t2 (+ t2 "." t1))))))))
 */
export function sitename(url: string | null): string | null {
	if (!isValidUrl(url)) return null;

	const toks = parseSite(url!);
	if (toks.length === 0) return null;

	const [t1, t2, t3] = toks;

	// if first token is a number (IP address), join all with .
	if (!isNaN(parseInt(t1, 10))) {
		return toks.join(".");
	}

	// check for multi-tld countries or long domains
	if (
		t3 &&
		t3 !== "www" &&
		(MULTI_TLD_COUNTRIES.includes(t1) || LONG_DOMAINS.includes(t2))
	) {
		return `${t3}.${t2}.${t1}`;
	}

	// standard case: domain.tld
	if (t2) {
		return `${t2}.${t1}`;
	}

	return null;
}

/**
 * check if url is a lightweight url (image)
 *
 * arc: (defmemo lightweight-url (url)
 *        (in (downcase (last (tokens url #\.))) "png" "jpg" "jpeg"))
 */
export function isLightweightUrl(url: string | null): boolean {
	if (!url) return false;
	const lower = url.toLowerCase();
	return lower.endsWith(".png") || lower.endsWith(".jpg") ||
		lower.endsWith(".jpeg");
}

/**
 * check if item is lightweight content
 *
 * arc: (def lightweight (s)
 *        (or s!dead
 *            (mem 'rally s!keys)  ; title is a rallying cry
 *            (mem 'image s!keys)  ; post is mainly image(s)
 *            (lightweights* (sitename s!url))
 *            (lightweight-url s!url)))
 */
export function isLightweight(
	item: Item,
	lightweights: LightweightsTable,
): boolean {
	if (item.dead) return true;
	if (item.keys?.includes("rally")) return true;
	if (item.keys?.includes("image")) return true;

	const site = sitename(item.url);
	if (site && lightweights[site]) return true;

	if (isLightweightUrl(item.url)) return true;

	return false;
}

/**
 * calculate controversy factor
 * reduces ranking if comment count is high relative to score
 *
 * arc: (def contro-factor (s)
 *        (aif (check (visible-family nil s) [> _ 20])
 *             (min 1 (expt (/ (realscore s) it) 2))
 *             1))
 *
 * @param visibleFamilyCount - number of visible comments in thread
 */
export function controFactor(item: Item, visibleFamilyCount: number): number {
	if (visibleFamilyCount > 20) {
		return Math.min(1, Math.pow(realScore(item) / visibleFamilyCount, 2));
	}
	return 1;
}

/**
 * calculate frontpage rank for an item
 *
 * arc: (def frontpage-rank (s (o scorefn realscore) (o gravity gravity*))
 *        (* (/ (let base (- (scorefn s) 1)
 *                (if (> base 0) (expt base .8) base))
 *              (expt (/ (+ (item-age s) timebase*) 60) gravity))
 *           (if (no (in s!type 'story 'poll))  .5
 *               (blank s!url)                  nourl-factor*
 *               (lightweight s)                (min lightweight-factor*
 *                                                   (contro-factor s))
 *                                              (contro-factor s))))
 *
 * @param item - the item to rank
 * @param scoreFn - function to calculate score (default: realScore)
 * @param gravity - gravity exponent (default: GRAVITY)
 * @param lightweights - lightweight sites table
 * @param visibleFamilyCount - number of visible comments (for controversy)
 */
export function frontpageRank(
	item: Item,
	scoreFn: (i: Item) => number = realScore,
	gravity: number = GRAVITY,
	lightweights: LightweightsTable = {},
	visibleFamilyCount: number = 0,
): number {
	// calculate base score
	const base = scoreFn(item) - 1;
	const adjustedBase = base > 0 ? Math.pow(base, 0.8) : base;

	// calculate time decay
	const ageMinutes = itemAge(item) + TIMEBASE;
	const timeFactor = Math.pow(ageMinutes / 60, gravity);

	// calculate type/content factor
	let contentFactor: number;
	if (item.type !== "story" && item.type !== "poll") {
		contentFactor = 0.5;
	} else if (isBlank(item.url)) {
		contentFactor = NOURL_FACTOR;
	} else if (isLightweight(item, lightweights)) {
		contentFactor = Math.min(
			LIGHTWEIGHT_FACTOR,
			controFactor(item, visibleFamilyCount),
		);
	} else {
		contentFactor = controFactor(item, visibleFamilyCount);
	}

	return (adjustedBase / timeFactor) * contentFactor;
}

/**
 * check if user is the author of an item
 *
 * arc: (def author (u i) (is u i!by))
 */
export function isAuthor(userId: string | null, item: Item): boolean {
	return userId !== null && userId === item.by;
}

/**
 * check if user can see dead items
 *
 * arc: (def seesdead (user)
 *        (or (and user (uvar user showdead) (no (ignored user)))
 *            (editor user)))
 *
 * @param profile - user profile (null if not logged in)
 * @param isEditor - whether user is an editor
 */
export function seesDead(
	profile: Profile | null,
	isEditor: boolean,
): boolean {
	if (isEditor) return true;
	if (profile && profile.showdead && !profile.ignore) return true;
	return false;
}

/**
 * check if a comment is delayed (new comment from user with delay setting)
 *
 * arc: (let mature (table)
 *        (def delayed (i)
 *          (and (no (mature i!id))
 *               (acomment i)
 *               (or (< (item-age i) (min max-delay* (uvar i!by delay)))
 *                   (do (set (mature i!id))
 *                       nil)))))
 *
 * @param item - the comment item
 * @param authorDelay - the author's delay setting
 * @param matureIds - set of item ids that have matured (passed delay)
 */
export function isDelayed(
	item: Item,
	authorDelay: number,
	matureIds: Set<number>,
): boolean {
	if (item.id === null) return false;
	if (matureIds.has(item.id)) return false;
	if (!isComment(item)) return false;

	const delayMinutes = Math.min(MAX_DELAY, authorDelay);
	if (itemAge(item) < delayMinutes) {
		return true;
	}

	// item has matured
	matureIds.add(item.id);
	return false;
}

/**
 * check if user can see an item
 *
 * arc: (def cansee (user i)
 *        (if i!deleted   (admin user)
 *            i!dead      (or (author user i) (seesdead user))
 *            (delayed i) (author user i)
 *            t))
 *
 * @param userId - current user id (null if not logged in)
 * @param item - the item to check
 * @param isAdmin - whether user is admin
 * @param userSeesDead - whether user can see dead items
 * @param authorDelay - delay setting for item author
 * @param matureIds - set of mature item ids
 */
export function canSee(
	userId: string | null,
	item: Item,
	isAdmin: boolean,
	userSeesDead: boolean,
	authorDelay: number = 0,
	matureIds: Set<number> = new Set(),
): boolean {
	// deleted items: only admins
	if (item.deleted) {
		return isAdmin;
	}

	// dead items: author or users who see dead
	if (item.dead) {
		return isAuthor(userId, item) || userSeesDead;
	}

	// delayed comments: only author
	if (isDelayed(item, authorDelay, matureIds)) {
		return isAuthor(userId, item);
	}

	// live items: everyone
	return true;
}

/**
 * filter items to only those visible to user
 *
 * arc: (def visible (user is)
 *        (keep [cansee user _] is))
 */
export function filterVisible(
	items: Item[],
	userId: string | null,
	isAdmin: boolean,
	userSeesDead: boolean,
	getAuthorDelay: (authorId: string | null) => number = () => 0,
	matureIds: Set<number> = new Set(),
): Item[] {
	return items.filter((item) =>
		canSee(
			userId,
			item,
			isAdmin,
			userSeesDead,
			getAuthorDelay(item.by),
			matureIds,
		)
	);
}

/**
 * count visible family members (item + all visible descendants)
 *
 * arc: (def visible-family (user i)
 *        (+ (if (cansee user i) 1 0)
 *           (sum [visible-family user (item _)] i!kids)))
 *
 * @param item - root item
 * @param getItem - function to load item by id
 * @param canSeeItem - function to check if item is visible
 */
export async function visibleFamilyCount(
	item: Item,
	getItem: (id: number) => Promise<Item | null>,
	canSeeItem: (item: Item) => boolean,
): Promise<number> {
	let count = canSeeItem(item) ? 1 : 0;

	if (item.kids) {
		for (const kidId of item.kids) {
			const kid = await getItem(kidId);
			if (kid) {
				count += await visibleFamilyCount(kid, getItem, canSeeItem);
			}
		}
	}

	return count;
}

/**
 * get entire family tree (item + all descendants)
 *
 * arc: (def family (i) (cons i (mappend family:item i!kids)))
 */
export async function getFamily(
	item: Item,
	getItem: (id: number) => Promise<Item | null>,
): Promise<Item[]> {
	const family: Item[] = [item];

	if (item.kids) {
		for (const kidId of item.kids) {
			const kid = await getItem(kidId);
			if (kid) {
				const kidFamily = await getFamily(kid, getItem);
				family.push(...kidFamily);
			}
		}
	}

	return family;
}

/**
 * get top n items sorted by score function
 *
 * arc: (def bestn n (compare > scorefn) (latest-items metastory nil consider))
 */
export function bestN<T>(
	items: T[],
	n: number,
	scoreFn: (item: T) => number,
): T[] {
	return [...items]
		.sort((a, b) => scoreFn(b) - scoreFn(a))
		.slice(0, n);
}

/**
 * retrieve n items that pass a test
 *
 * arc: (def retrieve n test items)
 */
export function retrieve<T>(
	items: T[],
	n: number,
	test: (item: T) => boolean,
): T[] {
	const result: T[] = [];
	for (const item of items) {
		if (test(item)) {
			result.push(item);
			if (result.length >= n) break;
		}
	}
	return result;
}

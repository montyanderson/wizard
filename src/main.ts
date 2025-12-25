/**
 * main entry point for arc news clone
 *
 * based on arc3.2/news.arc lines 1-90
 */

import {
	createServer,
	createServerConfig,
	type Request,
	Router,
} from "./lib/server.ts";
import { AuthManager } from "./lib/auth.ts";
import { loadJson, saveJson } from "./lib/storage.ts";
import {
	type BannedIpsTable,
	BannedIpsTableSchema,
	type BannedSitesTable,
	BannedSitesTableSchema,
	type CommentKeywords,
	CommentKeywordsSchema,
	type Item,
	ItemSchema,
	type PasswordTable,
	PasswordTableSchema,
	type Profile,
	ProfileSchema,
	type ScrubRules,
	ScrubRulesSchema,
	type SessionsTable,
	SessionsTableSchema,
	type SiteBanEntry,
	type SiteConfig,
	SiteConfigSchema,
	type UserVotesTable,
	UserVotesTableSchema,
} from "./lib/schemas.ts";
import {
	black,
	bold,
	br,
	br2,
	centre,
	type Colour,
	colour,
	colourStripe,
	escapeHtml,
	fontColour,
	form,
	genTag,
	grey,
	hexRep,
	hexToColour,
	hspace,
	input,
	link,
	nbsp,
	para,
	passwordInput,
	plural,
	row,
	sand,
	spaceRow,
	spanClass,
	spanId,
	stripTags,
	submit,
	table,
	tag,
	td,
	tdColour,
	textAge,
	textarea,
	tr,
	trtd,
	underlink,
	vspace,
	withBars,
	zeroTable,
} from "./lib/html.ts";
import {
	bestN,
	filterVisible,
	frontpageRank,
	itemAge,
	minutesSince,
	realScore,
	seconds,
	sitename,
	userAge,
} from "./lib/ranking.ts";
import { canVoteOnItem, COMMENT_THRESHOLD, REPLY_DECAY } from "./lib/voting.ts";

// =============================================================================
// Configuration
// =============================================================================

/**
 * arc: (= this-site*    "My Forum"
 *         site-url*     "http://news.yourdomain.com/"
 *         parent-url*   "http://www.yourdomain.com"
 *         favicon-url*  ""
 *         site-desc*    "What this site is about."
 *         site-color*   (color 180 180 180)
 *         border-color* (color 180 180 180)
 *         prefer-url*   t)
 */
const config: SiteConfig = (await loadJson(
	"data/config.json",
	SiteConfigSchema,
)) ?? SiteConfigSchema.parse({});

// arc: (= up-url* "grayarrow.gif" down-url* "graydown.gif" logo-url* "arc.png")
const upUrl = "grayarrow.gif";
const downUrl = "graydown.gif";
const logoUrl = config.logoUrl;

// arc: (= caching* 1 perpage* 30 threads-perpage* 10 maxend* 210)
const perpage = 30;
const threadsPerpage = 10;
const maxend = 210;

// arc: (= user-changetime* 120 editor-changetime* 1440)
const userChangetime = 120; // minutes - authors can edit own items
const editorChangetime = 1440; // minutes - editors can edit any item (24h)

// arc: (= flag-threshold* 30 flag-kill-threshold* 7 many-flags* 1)
const flagThreshold = 30; // karma needed to flag
const flagKillThreshold = 7; // flags needed to auto-kill
const manyFlags = 1; // threshold for showing flag count to admins

// arc: (= nleaders* 20 leader-threshold* 1)
const nleaders = 20;
const leaderThreshold = 1;

// arc: (= poll-threshold* 20)
const pollThreshold = 20;

// arc: (= bar* " | ")
const bar = " | ";

// arc: (= formatdoc* "Blank lines separate paragraphs...")
const formatdoc = `Blank lines separate paragraphs.
<p> Text after a blank line that is indented by two or more spaces is reproduced verbatim.  (This is intended for code.)
<p> Text surrounded by asterisks is italicized, if the character after the first asterisk isn't whitespace.
<p> Urls become links, except in the text field of a submission.<br><br>`;

// =============================================================================
// Data Directories
// =============================================================================

/**
 * arc: (= newsdir*  "arc/news/"
 *         storydir* "arc/news/story/"
 *         profdir*  "arc/news/profile/"
 *         votedir*  "arc/news/vote/")
 */
// data directories (configurable via environment variables for testing)
const baseDir = Deno.env.get("NEWS_DATA_DIR") ?? "data/news/";
const newsDir = baseDir.endsWith("/") ? baseDir : baseDir + "/";
const storyDir = `${newsDir}story/`;
const profDir = `${newsDir}profile/`;
const voteDir = `${newsDir}vote/`;

// =============================================================================
// State
// =============================================================================

let stories: Item[] = [];
let comments: Item[] = [];
const items: Map<number, Item> = new Map();
let maxId = 0;
let rankedStories: Item[] = [];
let auth: AuthManager;

// arc: (= profs* (table))
const profiles: Map<string, Profile> = new Map();

// arc: (= votes* (table))
const votes: Map<string, UserVotesTable> = new Map();

// arc: (diskvar scrubrules* (+ newsdir* "scrubrules"))
let scrubrules: ScrubRules = [];

// arc: (disktable banned-sites* (+ newsdir* "banned-sites"))
let bannedSites: BannedSitesTable = {};

// arc: (disktable banned-ips* (+ newsdir* "banned-ips"))
let bannedIps: BannedIpsTable = {};

// arc: (diskvar comment-kill* (+ newsdir* "comment-kill"))
let commentKill: CommentKeywords = [];

// arc: (diskvar comment-ignore* (+ newsdir* "comment-ignore"))
let commentIgnore: CommentKeywords = [];

// =============================================================================
// Load/Save
// =============================================================================

async function ensureDir(path: string): Promise<void> {
	try {
		await Deno.mkdir(path, { recursive: true });
	} catch (e) {
		if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
	}
}

async function loadItems(): Promise<void> {
	console.log("load items...");
	await ensureDir(storyDir);

	try {
		const entries: number[] = [];
		for await (const entry of Deno.readDir(storyDir)) {
			if (entry.isFile && entry.name.endsWith(".json")) {
				const id = parseInt(entry.name.replace(".json", ""), 10);
				if (!isNaN(id)) entries.push(id);
			}
		}

		entries.sort((a, b) => b - a);
		if (entries.length > 0) maxId = entries[0];

		const loadedStories: Item[] = [];
		const loadedComments: Item[] = [];

		for (const id of entries.slice(0, 15000)) {
			const item = await loadJson<Item>(
				`${storyDir}${id}.json`,
				ItemSchema,
			);
			if (item) {
				items.set(id, item);
				if (item.type === "story" || item.type === "poll") {
					loadedStories.push(item);
				} else if (item.type === "comment") {
					loadedComments.push(item);
				}
			}
		}

		stories = loadedStories.reverse();
		comments = loadedComments.reverse();
		console.log(`loaded ${items.size} items`);
	} catch (e) {
		if (!(e instanceof Deno.errors.NotFound)) throw e;
		console.log("no items found, starting fresh");
	}

	genTopstories();
}

function genTopstories(): void {
	// arc: (def gen-topstories ()
	//        (= ranked-stories* (rank-stories 180 1000 (memo frontpage-rank))))
	const candidates = stories.slice(0, 1000);
	rankedStories = candidates
		.filter((s) => !s.dead && !s.deleted)
		.sort((a, b) => frontpageRank(b) - frontpageRank(a))
		.slice(0, 180);
}

async function loadAuth(): Promise<void> {
	await ensureDir(newsDir);
	await ensureDir(profDir);
	await ensureDir(voteDir);

	// arc: hpasswords* stored in (+ arcdir* "hpw")
	const passwords = (await loadJson<PasswordTable>(
		`${newsDir}hpw.json`,
		PasswordTableSchema,
	)) ?? {};
	// arc: cookie->user* stored in (+ arcdir* "cooks")
	const sessions = (await loadJson<SessionsTable>(
		`${newsDir}cooks.json`,
		SessionsTableSchema,
	)) ?? {};

	// load admins from file or use empty list
	let admins: string[] = [];
	try {
		const adminsText = await Deno.readTextFile(`${newsDir}admins`);
		admins = adminsText.split(/\s+/).filter((s) => s.length > 0);
	} catch {
		// no admins file
	}

	auth = new AuthManager(passwords, sessions, admins);

	// load scrubrules
	// arc: (diskvar scrubrules* (+ newsdir* "scrubrules"))
	scrubrules = (await loadJson<ScrubRules>(
		`${newsDir}scrubrules.json`,
		ScrubRulesSchema,
	)) ??
		[];

	// load banned sites
	// arc: (disktable banned-sites* (+ newsdir* "banned-sites"))
	bannedSites = (await loadJson<BannedSitesTable>(
		`${newsDir}banned-sites.json`,
		BannedSitesTableSchema,
	)) ?? {};

	// load banned ips
	// arc: (disktable banned-ips* (+ newsdir* "banned-ips"))
	bannedIps = (await loadJson<BannedIpsTable>(
		`${newsDir}banned-ips.json`,
		BannedIpsTableSchema,
	)) ?? {};

	// load comment keyword lists
	// arc: (diskvar comment-kill* (+ newsdir* "comment-kill"))
	commentKill = (await loadJson<CommentKeywords>(
		`${newsDir}comment-kill.json`,
		CommentKeywordsSchema,
	)) ?? [];

	// arc: (diskvar comment-ignore* (+ newsdir* "comment-ignore"))
	commentIgnore = (await loadJson<CommentKeywords>(
		`${newsDir}comment-ignore.json`,
		CommentKeywordsSchema,
	)) ?? [];
}

async function saveScrubrules(): Promise<void> {
	await saveJson(`${newsDir}scrubrules.json`, scrubrules, ScrubRulesSchema);
}

async function saveBannedSites(): Promise<void> {
	await saveJson(
		`${newsDir}banned-sites.json`,
		bannedSites,
		BannedSitesTableSchema,
	);
}

async function saveBannedIps(): Promise<void> {
	await saveJson(
		`${newsDir}banned-ips.json`,
		bannedIps,
		BannedIpsTableSchema,
	);
}

async function saveCommentKill(): Promise<void> {
	await saveJson(
		`${newsDir}comment-kill.json`,
		commentKill,
		CommentKeywordsSchema,
	);
}

async function saveCommentIgnore(): Promise<void> {
	await saveJson(
		`${newsDir}comment-ignore.json`,
		commentIgnore,
		CommentKeywordsSchema,
	);
}

async function saveAuth(): Promise<void> {
	// arc: hpasswords* stored in (+ arcdir* "hpw")
	await saveJson(
		`${newsDir}hpw.json`,
		auth.getPasswords(),
		PasswordTableSchema,
	);
	// arc: cookie->user* stored in (+ arcdir* "cooks")
	await saveJson(
		`${newsDir}cooks.json`,
		auth.getSessions(),
		SessionsTableSchema,
	);
}

// =============================================================================
// Profile Management
// =============================================================================

/**
 * arc: (def profile (u)
 *        (or (profs* u)
 *            (aand (goodname u)
 *                  (file-exists (+ profdir* u))
 *                  (= (profs* u) (temload 'profile it)))))
 */
async function loadProfile(username: string): Promise<Profile | null> {
	// check cache first
	const cached = profiles.get(username);
	if (cached) return cached;

	// try to load from disk
	const profile = await loadJson<Profile>(
		`${profDir}${username}.json`,
		ProfileSchema,
	);
	if (profile) {
		profiles.set(username, profile);
	}
	return profile;
}

/**
 * arc: (def save-prof (u) (save-table (profs* u) (+ profdir* u)))
 */
async function saveProfile(profile: Profile): Promise<void> {
	if (!profile.id) throw new Error("Profile must have id");
	profiles.set(profile.id, profile);
	await saveJson(`${profDir}${profile.id}.json`, profile, ProfileSchema);
}

/**
 * arc: (def init-user (u)
 *        (= (votes* u) (table)
 *           (profs* u) (inst 'profile 'id u))
 *        (save-votes u)
 *        (save-prof u)
 *        u)
 */
async function initUser(username: string): Promise<Profile> {
	const profile: Profile = ProfileSchema.parse({
		id: username,
	});
	profiles.set(username, profile);
	await saveProfile(profile);
	return profile;
}

/**
 * arc: (def ensure-news-user (u)
 *        (if (profile u) u (init-user u)))
 */
async function ensureNewsUser(username: string): Promise<Profile> {
	const existing = await loadProfile(username);
	if (existing) return existing;
	return initUser(username);
}

// =============================================================================
// User Votes Management
// =============================================================================

/**
 * arc: (def votes (user)
 *        (or (votes* u)
 *            (aand (file-exists (+ votedir* u))
 *                  (= (votes* u) (load-table it)))))
 */
async function loadUserVotes(username: string): Promise<UserVotesTable> {
	// check cache first
	const cached = votes.get(username);
	if (cached) return cached;

	// try to load from disk
	const userVotes = (await loadJson<UserVotesTable>(
		`${voteDir}${username}.json`,
		UserVotesTableSchema,
	)) ?? {};

	votes.set(username, userVotes);
	return userVotes;
}

/**
 * arc: (def save-votes (u) (save-table (votes* u) (+ votedir* u)))
 */
async function saveUserVotes(username: string): Promise<void> {
	const userVotes = votes.get(username) ?? {};
	await saveJson(
		`${voteDir}${username}.json`,
		userVotes,
		UserVotesTableSchema,
	);
}

/**
 * record a vote in the user's vote table
 *
 * arc: (= ((votes* user) i!id) vote)
 */
function recordUserVote(
	username: string,
	itemId: number,
	dir: "up" | "down",
): void {
	let userVotes = votes.get(username);
	if (!userVotes) {
		userVotes = {};
		votes.set(username, userVotes);
	}
	userVotes[String(itemId)] = {
		dir,
		time: seconds(),
	};
}

/**
 * check if user has voted on an item (sync, uses cache only)
 * for accurate results, call loadUserVotes first
 */
function hasUserVoted(username: string, itemId: number): boolean {
	const userVotes = votes.get(username);
	if (!userVotes) {
		// fallback: check item.votes if user votes not in cache
		const item = items.get(itemId);
		if (item?.votes) {
			return item.votes.some((v) => v.user === username);
		}
		return false;
	}
	return String(itemId) in userVotes;
}

// =============================================================================
// Page Templates
// =============================================================================

/**
 * arc: (mac whitepage body
 *        `(tag html
 *           (tag (body bgcolor white alink linkblue) ,@body)))
 *
 * simple white page with no header, used for login pages
 */
function whitepage(body: string): string {
	const linkblue = "#0000be";
	return `<html><body bgcolor="white" alink="${linkblue}">${body}</body></html>`;
}

/**
 * arc: (mac npage (title . body) ...)
 */
function npage(title: string, body: string): string {
	// arc: (mac npage (title . body) ...)
	// viewport meta tag for mobile full-width layout (like hacker news)
	return `<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" type="text/css" href="news.css">
<link rel="shortcut icon" href="${config.faviconUrl}">
<script>${votejs}</script>
<title>${escapeHtml(title)}</title>
</head>
<body>
<center>
${
		table(body, {
			id: "hnmain",
			border: 0,
			cellpadding: 0,
			cellspacing: 0,
			width: "85%",
			bgcolor: sand,
		})
	}
</center>
</body>
</html>`;
}

/**
 * javascript for voting
 *
 * arc: (= votejs* "...")
 */
const votejs = `
function byId(id) {
  return document.getElementById(id);
}

function vote(node) {
  var v = node.id.split(/_/);
  var item = v[1];

  var score = byId('score_' + item);
  var newscore = parseInt(score.innerHTML) + (v[0] == 'up' ? 1 : -1);
  score.innerHTML = newscore + (newscore == 1 ? ' point' : ' points');

  byId('up_'   + item).style.visibility = 'hidden';
  byId('down_' + item).style.visibility = 'hidden';

  var ping = new Image();
  ping.src = node.href;

  return false;
}`;

/**
 * get main colour for user
 *
 * arc: (def main-color (user) ...)
 */
function mainColour(user: string | null): Colour {
	if (user) {
		// could look up user's topcolor preference
	}
	return config.siteColour;
}

/**
 * arc: (defmemo grayrange (s)
 *        (gray (min 230 (round (expt (* (+ (abs s) 2) 900) .6)))))
 *
 * returns gray color for negative-scored comments
 * lower (more negative) scores = lighter gray (harder to read)
 */
function grayrange(score: number): Colour {
	const value = Math.min(
		230,
		Math.round(Math.pow((Math.abs(score) + 2) * 900, 0.6)),
	);
	return grey(value);
}

/**
 * arc: (def comment-color (c)
 *        (if (> c!score 0) black (grayrange c!score)))
 *
 * returns color for comment text based on score
 */
function commentColour(item: Item): Colour {
	if (item.score > 0) {
		return black;
	}
	return grayrange(item.score);
}

/**
 * arc: (def pagetop (switch lid label (o title) (o user) (o whence)) ...)
 */
function pagetop(
	switchType: "full" | null,
	_lid: string | null,
	label: string | null,
	title: string | undefined,
	user: string | null,
	whence: string,
): string {
	const mainCol = mainColour(user);

	let content = "";

	// logo
	const logo = td(
		tag(
			"a",
			{ href: config.parentUrl },
			genTag("img", {
				src: logoUrl,
				width: 18,
				height: 18,
				style: `border:1px #${hexRep(config.borderColour)} solid;`,
			}),
		),
		{ style: "width:18px;padding-right:4px" },
	);

	if (switchType === "full") {
		// full header with nav
		const navItems: string[] = [];
		navItems.push(toplink("new", "newest", label));
		if (user) {
			navItems.push(toplink("threads", `threads?id=${user}`, label));
		}
		navItems.push(toplink("comments", "newcomments", label));

		// arc: (toplink "leaders" "leaders" label)
		navItems.push(toplink("leaders", "leaders", label));

		// arc: (when (noob user) (toplink "welcome" welcome-url* label))
		// show welcome link to users < 48 hours old
		if (user) {
			const profile = profiles.get(user);
			if (profile && userAge(profile) < 2880) {
				navItems.push(toplink("welcome", "welcome", label));
			}
		}

		navItems.push(link("submit"));

		const nav = td(
			spanClass(
				"pagetop",
				bold(link(config.thisSite, "news")) + hspace(10) +
					withBars(navItems),
			),
			{ style: "line-height:12pt; height:10px;" },
		);

		const right = td(
			spanClass("pagetop", topright(user, whence)),
			{ style: "text-align:right;padding-right:4px;" },
		);

		content = tr(logo + nav + right);
	} else {
		// simple header with just label
		const labelTd = td(
			spanClass("pagetop", bold(label || "")),
			{ style: "line-height:12pt; height:10px;" },
		);
		content = tr(logo + labelTd);
	}

	const headerTable = table(content, {
		border: 0,
		cellpadding: 0,
		cellspacing: 0,
		width: "100%",
		style: "padding:2px",
	});

	return tr(tdColour(mainCol, headerTable)) + spaceRow(10);
}

/**
 * arc: (def toplink (name dest label) ...)
 */
function toplink(
	name: string,
	dest: string,
	currentLabel: string | null,
): string {
	if (name === currentLabel) {
		return spanClass("topsel", link(name, dest));
	}
	return link(name, dest);
}

/**
 * arc: (def topright (user whence (o showkarma t))
 *        (when user
 *          (userlink user user nil)
 *          (when showkarma (pr "&nbsp;(@(karma user))"))
 *          (pr "&nbsp;|&nbsp;"))
 *        ...)
 */
function topright(
	user: string | null,
	whence: string,
	showkarma = true,
): string {
	if (user) {
		const profile = profiles.get(user);
		const karma = profile?.karma ?? 1;
		const karmaStr = showkarma ? `${nbsp()}(${karma})` : "";
		return link(user, `user?id=${user}`) + karmaStr + nbsp() + bar +
			link("logout", `logout?whence=${encodeURIComponent(whence)}`);
	}
	return link("login", `login?whence=${encodeURIComponent(whence)}`);
}

/**
 * arc: (mac longpage (user t1 lid label title whence . body) ...)
 */
function longpage(
	user: string | null,
	_t1: number,
	lid: string | null,
	label: string | null,
	title: string | undefined,
	whence: string,
	body: string,
): string {
	const pageTitle = config.thisSite + (title ? bar + title : "");
	const content = pagetop("full", lid, label, title, user, whence) +
		trtd(body) +
		trtd(vspace(10) + colourStripe(mainColour(user)) + br());
	return npage(pageTitle, content);
}

/**
 * arc: (mac shortpage (user lid label title whence . body) ...)
 */
function shortpage(
	user: string | null,
	lid: string | null,
	label: string | null,
	title: string | undefined,
	whence: string,
	body: string,
): string {
	const pageTitle = config.thisSite + (title ? bar + title : "");
	const content = pagetop("full", lid, label, title, user, whence) +
		trtd(body);
	return npage(pageTitle, content);
}

/**
 * arc: (mac minipage (label . body) ...)
 */
function minipage(label: string, body: string): string {
	const pageTitle = config.thisSite + bar + label;
	const content = pagetop(null, null, label, undefined, null, "") +
		trtd(body);
	return npage(pageTitle, content);
}

/**
 * arc: (def msgpage (user msg (o title)) ...)
 * displays a message in admin style with optional title
 */
function msgpage(user: string | null, msg: string, title?: string): string {
	// arc: (widtable 500 msg) for long messages
	const widtable = (w: number, content: string): string =>
		tag("table", { width: w }, tr(td(content)));

	// arc: (if (len> msg 80) (widtable 500 msg) (pr msg))
	const msgContent = msg.length > 80 ? widtable(500, msg) : msg;

	// arc: (spanclass admin (center ...))
	const body = tag("span", { class: "admin" }, centre(msgContent)) + br2();

	return minipage(title ?? "Message", body);
}

// =============================================================================
// Item Display
// =============================================================================

/**
 * arc: (def display-items (user items label title whence ...) ...)
 */
function displayItems(
	user: string | null,
	itemList: Item[],
	_label: string | null,
	_title: string | undefined,
	whence: string,
	start: number = 0,
	end: number = perpage,
	number: boolean = true,
): string {
	let n = start;
	const rows = itemList.slice(start, end).map((item) => {
		const num = number ? ++n : null;
		return displayItem(num, item, user, whence);
	}).join("");

	// more link
	// arc: (morelink display-items items label title end newend number)
	let more = "";
	const newEnd = end + perpage;
	if (newEnd <= maxend && end < itemList.length) {
		// calculate next page number (1-indexed)
		const nextPage = Math.floor(newEnd / perpage);
		// handle whence that may already have query params
		const separator = whence.includes("?") ? "&" : "?";
		const moreUrl = `${whence}${separator}p=${nextPage}`;
		more = spaceRow(10) + tr(
			td("", { colspan: number ? 2 : 1 }) +
				td(
					tag("a", { href: moreUrl, rel: "nofollow" }, "More"),
					{ class: "title" },
				),
		);
	}

	return zeroTable(rows + more);
}

/**
 * arc: (def display-item (n i user here (o inlist))
 *        ((displayfn* (i 'type)) n i user here inlist))
 *
 * dispatches to display-story or display-comment based on type
 */
function displayItem(
	num: number | null,
	item: Item,
	user: string | null,
	whence: string,
): string {
	if (item.type === "comment") {
		return displayItemComment(num, item, user, whence);
	}
	return displayStory(num, item, user, whence);
}

/**
 * arc: (def display-story (i s user whence) ...)
 */
function displayStory(
	num: number | null,
	item: Item,
	user: string | null,
	whence: string,
): string {
	const numCell = num
		? td(`${num}.`, { align: "right", valign: "top", class: "title" })
		: "";

	const voteCell = td(votelinks(item, user, whence), { valign: "top" });
	const titleCell = titleline(item, user);

	// arc: (itemline s user) (commentlink s user) (when (apoll s) (addoptlink s user)) (editlink s user) (unless i (flaglink s user whence))
	// flaglink only shown when not in list mode (num is null)
	const subtext = td(
		itemline(item, user) +
			commentlink(item, user) +
			(item.type === "poll" ? addoptLink(item, user) : "") +
			(num === null ? flagLink(item, user, whence) : ""),
		{ class: "subtext" },
	);

	return tr(numCell + voteCell + titleCell) +
		tr(td("", { colspan: num ? 2 : 1 }) + subtext) +
		spaceRow(5);
}

/**
 * arc: (= (displayfn* 'comment) (fn (n i user here inlist)
 *        (display-comment n i user here nil 0 nil inlist)))
 *
 * display a comment in item listing context (not tree context)
 */
function displayItemComment(
	num: number | null,
	item: Item,
	user: string | null,
	whence: string,
): string {
	const numCell = num
		? td(`${num}.`, { align: "right", valign: "top", class: "title" })
		: "";

	// get parent author for downvote restriction check
	const parentItem = item.parent ? items.get(item.parent) : null;
	const parentBy = parentItem?.by ?? null;

	// get user profile for karma check (if user is logged in)
	const userProfile = user ? profiles.get(user) ?? null : null;

	// arc: display-comment for comments in list uses downtoo
	const voteCell = td(
		votelinks(item, user, whence, true, userProfile, parentBy),
		{ valign: "top" },
	);

	const byUser = item.by || "unknown";
	// arc: (def itemline (i user) (when (cansee user i) (when (news-type i) (itemscore i user)) (byline i user)))
	// arc: (def itemscore (i (o user)) (tag (span id (+ "score_" i!id)) (pr (plural ... "point"))))
	const scoreSpan = spanId(
		`score_${item.id}`,
		plural(item.score, "point"),
	);
	const header = spanClass(
		"comhead",
		scoreSpan + " " +
			link(byUser, `user?id=${byUser}`) +
			" " + textAge(minutesSince(item.time)) +
			" " + bar + " " +
			link("link", `item?id=${item.id}`) +
			(item.parent
				? " " + bar + " " + link("parent", `item?id=${item.parent}`)
				: ""),
	);

	const text = spanClass("comment", escapeHtml(item.text || ""));

	const reply = tag(
		"font",
		{ size: 1 },
		underlink("reply", `reply?id=${item.id}`),
	);

	const contentTd = td(
		tag(
			"div",
			{ style: "margin-top:2px; margin-bottom:-10px; " },
			header,
		) +
			br() +
			text +
			para() +
			reply,
		{ class: "default" },
	);

	return tr(numCell + voteCell + contentTd) + spaceRow(5);
}

// arc: (= votewid* 14)
const votewid = 14;

// arc: (= downvote-threshold* 200 downvote-time* 1440)
const downvoteThreshold = 200;
const downvoteTime = 1440; // minutes (24 hours)
const lowestScore = -4;

// arc: (= comment-threshold* -20)
// using COMMENT_THRESHOLD from voting.ts

/**
 * arc: (def votelinks (i user whence (o downtoo))
 *        (center
 *          (if (and (cansee user i)
 *                   (or (no user)
 *                       (no ((votes user) i!id))))
 *               (do (votelink i user whence 'up)
 *                   (if (and downtoo
 *                            (or (admin user)
 *                                (< (item-age i) downvote-time*))
 *                            (canvote user i 'down))
 *                       (do (br) (votelink i user whence 'down))
 *                       (tag (span id (+ "down_" i!id)))))
 *              (author user i)
 *               (do (fontcolor orange (pr "*")) (br) (hspace votewid*))
 *              (hspace votewid*))))
 *
 * @param downtoo - whether to show downvote arrow (true for comments)
 * @param userProfile - user's profile for karma check (or null)
 * @param parentBy - author of parent item (for downvote restriction check)
 */
function votelinks(
	item: Item,
	user: string | null,
	whence: string,
	downtoo: boolean = false,
	userProfile: Profile | null = null,
	parentBy: string | null = null,
): string {
	// arc: ((votes user) i!id) - check user's vote table
	// use cached user votes if available, otherwise fall back to item.votes
	const hasVoted = user ? hasUserVoted(user, item.id!) : false;

	// arc: (author user i) - check if user is the author
	const isItemAuthor = user && item.by === user;

	if (isItemAuthor) {
		// author sees orange * instead of vote arrows
		// arc: (fontcolor orange (pr "*")) (br) (hspace votewid*)
		return centre(
			tag("font", { color: "#" + hexRep(colour(255, 102, 0)) }, "*") +
				br() +
				hspace(votewid),
		);
	}

	if (!hasVoted) {
		// can vote - show upvote arrow
		const upVoteUrl = `vote?for=${item.id}&dir=up&whence=${
			encodeURIComponent(whence)
		}`;
		const upArrow = tag("a", {
			id: user ? `up_${item.id}` : undefined,
			onclick: user ? "return vote(this)" : undefined,
			href: upVoteUrl,
		}, genTag("img", { src: upUrl, border: 0, vspace: 3, hspace: 2 }));

		// check if should show downvote arrow
		// arc: (and downtoo
		//           (or (admin user)
		//               (< (item-age i) downvote-time*))
		//           (canvote user i 'down))
		let downArrow = "";
		if (downtoo && user && userProfile) {
			const isAdmin = auth.isAdmin(user);
			const itemAge = minutesSince(item.time);
			const canShowDown = isAdmin || itemAge < downvoteTime;

			// arc: (canvote user i 'down) checks:
			// - item is comment
			// - user has enough karma (> downvote-threshold*)
			// - score above lowest
			// - not downvoting reply to own comment
			const canDownvote = canShowDown &&
				item.type === "comment" &&
				userProfile.karma > downvoteThreshold &&
				item.score > lowestScore &&
				parentBy !== user;

			if (canDownvote) {
				const downVoteUrl = `vote?for=${item.id}&dir=down&whence=${
					encodeURIComponent(whence)
				}`;
				downArrow = br() + tag(
					"a",
					{
						id: `down_${item.id}`,
						onclick: "return vote(this)",
						href: downVoteUrl,
					},
					genTag("img", {
						src: downUrl,
						border: 0,
						vspace: 3,
						hspace: 2,
					}),
				);
			} else {
				// placeholder span so js can find it
				downArrow = tag("span", { id: `down_${item.id}` }, "");
			}
		} else {
			downArrow = tag("span", { id: `down_${item.id}` }, "");
		}

		return centre(upArrow + downArrow);
	}

	// already voted - show empty space
	return centre(hspace(votewid));
}

/**
 * arc: (def titleline (s url user whence) ...)
 */
function titleline(item: Item, _user: string | null): string {
	const url = item.url;
	const href = url || `item?id=${item.id}`;
	const titleLink = tag("a", { href }, escapeHtml(item.title || ""));

	let site = "";
	if (url) {
		const sn = sitename(url);
		if (sn) {
			site = spanClass("comhead", ` (${sn})`);
		}
	}

	return td(titleLink + site, { class: "title" });
}

/**
 * arc: (def itemline (i user) ...)
 */
function itemline(item: Item, user: string | null): string {
	const score = spanId(`score_${item.id}`, plural(item.score, "point"));
	const byUser = item.by || "unknown";
	const by = ` by ${link(byUser, `user?id=${byUser}`)}`;
	const age = ` ${textAge(minutesSince(item.time))} `;
	return score + by + age + editLink(item, user);
}

/**
 * arc: (def commentlink (i user) ...)
 */
function commentlink(item: Item, _user: string | null): string {
	const kids = item.kids || [];
	const n = kids.length;
	const text = n > 0 ? plural(n, "comment") : "discuss";
	return bar + tag("a", { href: `item?id=${item.id}` }, text);
}

// =============================================================================
// Login Page
// =============================================================================

/**
 * arc: (def login-page (switch (o msg nil) (o afterward hello-page))
 *        (whitepage
 *          (pagemessage msg)
 *          (when (in switch 'login 'both)
 *            (login-form "Login" switch login-handler afterward)
 *            ...)))
 */
function loginPage(whence: string, msg?: string): string {
	const body = (msg ? para(msg) + br() : "") +
		bold("Login") +
		br2() +
		form(
			"login",
			tag(
				"table",
				{ border: 0 },
				tr(td("username:") + td(input("u", "", 20))) +
					tr(td("password:") + td(passwordInput("p", 20))) +
					tr(td("") + td(submit("login"))),
			) +
				genTag("input", {
					type: "hidden",
					name: "whence",
					value: whence,
				}),
		) +
		br2() +
		link(
			"Create Account",
			`login?create=t&whence=${encodeURIComponent(whence)}`,
		);
	return whitepage(body);
}

function createAccountPage(whence: string, msg?: string): string {
	const body = (msg ? para(msg) + br() : "") +
		bold("Create Account") +
		br2() +
		form(
			"login",
			tag(
				"table",
				{ border: 0 },
				tr(td("username:") + td(input("u", "", 20))) +
					tr(td("password:") + td(passwordInput("p", 20))) +
					tr(td("") + td(submit("create account"))),
			) +
				genTag("input", {
					type: "hidden",
					name: "whence",
					value: whence,
				}) +
				genTag("input", {
					type: "hidden",
					name: "creating",
					value: "t",
				}),
		);
	return whitepage(body);
}

// =============================================================================
// CSS
// =============================================================================

const newsCss = `
body  { font-family:Verdana; font-size:10pt; color:#828282; }
td    { font-family:Verdana; font-size:10pt; color:#828282; }

.admin td   { font-family:Verdana; font-size:8.5pt; color:#000000; }
.subtext td { font-family:Verdana; font-size:  7pt; color:#828282; }

input    { font-family:Courier; font-size:10pt; color:#000000; }
input[type="submit"] { font-family:Verdana; }
textarea { font-family:Courier; font-size:10pt; color:#000000; }

a:link    { color:#000000; text-decoration:none; }
a:visited { color:#828282; text-decoration:none; }

.default { font-family:Verdana; font-size: 10pt; color:#828282; }
.admin   { font-family:Verdana; font-size:8.5pt; color:#000000; }
.title   { font-family:Verdana; font-size: 10pt; color:#828282; }
.adtitle { font-family:Verdana; font-size:  9pt; color:#828282; }
.subtext { font-family:Verdana; font-size:  7pt; color:#828282; }
.yclinks { font-family:Verdana; font-size:  8pt; color:#828282; }
.pagetop { font-family:Verdana; font-size: 10pt; color:#222222; }
.comhead { font-family:Verdana; font-size:  8pt; color:#828282; }
.comment { font-family:Verdana; font-size:  9pt; }
.dead    { font-family:Verdana; font-size:  9pt; color:#dddddd; }

.comment a:link, .comment a:visited { text-decoration:underline;}
.dead a:link, .dead a:visited { color:#dddddd; }
.pagetop a:visited { color:#000000;}
.topsel a:link, .topsel a:visited { color:#ffffff; }

.subtext a:link, .subtext a:visited { color:#828282; }
.subtext a:hover { text-decoration:underline; }

.comhead a:link, .subtext a:visited { color:#828282; }
.comhead a:hover { text-decoration:underline; }

.default p { margin-top: 8px; margin-bottom: 0px; }

.pagebreak {page-break-before:always}

pre { overflow: auto; padding: 2px; max-width:600px; }
pre:hover {overflow:auto}
`;

// =============================================================================
// Routes
// =============================================================================

function setupRoutes(router: Router): void {
	// arc: (newsop news () (newspage user))
	router.defop("news", async (req) => {
		const user = getUser(req);
		const profile = user ? await loadProfile(user) : null;
		if (!(await checkProcrast(profile))) {
			return htmlWithStatus(
				minipage("Noprocrast", procrastMsg(profile!, "news")),
				200,
			);
		}
		const { start, end } = parsePageParam(req);
		return newspage(user, start, end);
	});

	// default route
	router.defop("", async (req) => {
		const user = getUser(req);
		const profile = user ? await loadProfile(user) : null;
		if (!(await checkProcrast(profile))) {
			return htmlWithStatus(
				minipage("Noprocrast", procrastMsg(profile!, "news")),
				200,
			);
		}
		const { start, end } = parsePageParam(req);
		return newspage(user, start, end);
	});

	// arc: (newsop newest () (newestpage user))
	router.defop("newest", async (req) => {
		const user = getUser(req);
		const profile = user ? await loadProfile(user) : null;
		if (!(await checkProcrast(profile))) {
			return htmlWithStatus(
				minipage("Noprocrast", procrastMsg(profile!, "newest")),
				200,
			);
		}
		const { start, end } = parsePageParam(req);
		return newestpage(user, start, end);
	});

	// arc: (newsop best () (bestpage user))
	router.defop("best", (req) => {
		const user = getUser(req);
		const { start, end } = parsePageParam(req);
		return bestpage(user, start, end);
	});

	// arc: (newsop bestcomments () (bestcpage user))
	router.defop("bestcomments", (req) => {
		const user = getUser(req);
		const { start, end } = parsePageParam(req);
		return bestcpage(user, start, end);
	});

	// arc: (newsop active () (active-page user))
	router.defop("active", (req) => {
		const user = getUser(req);
		const { start, end } = parsePageParam(req);
		return activePage(user, start, end);
	});

	// arc: (newsop noobstories () (noobspage user stories*))
	router.defop("noobstories", (req) => {
		const user = getUser(req);
		const { start, end } = parsePageParam(req);
		return noobsPage(user, stories, "noobstories", start, end);
	});

	// arc: (newsop noobcomments () (noobspage user comments*))
	router.defop("noobcomments", (req) => {
		const user = getUser(req);
		const { start, end } = parsePageParam(req);
		return noobsPage(user, comments, "noobcomments", start, end);
	});

	// arc: (newsop lists () ...)
	router.defop("lists", (req) => {
		const user = getUser(req);
		return listsPage(user);
	});

	// arc: (newsop saved (id) ...)
	router.defop("saved", async (req) => {
		const user = getUser(req);
		const id = req.args.get("id");
		if (!id) {
			return htmlWithStatus(minipage("Error", "No user specified."), 400);
		}
		if (!(await loadProfile(id))) {
			return htmlWithStatus(minipage("Error", "No such user."), 404);
		}
		return await savedPage(user, id);
	});

	// arc: (newsop welcome () (pr "Welcome to " this-site* ", " user "!"))
	router.defop("welcome", (req) => {
		const user = getUser(req);
		return htmlWithStatus(
			minipage(
				"Welcome",
				`Welcome to ${escapeHtml(config.thisSite)}${
					user ? `, ${escapeHtml(user)}` : ""
				}!`,
			),
			200,
		);
	});

	// arc: (newsop submitlink (u t) ...)
	router.defop("submitlink", async (req) => {
		const user = getUser(req);
		const url = req.args.get("u") || "";
		const title = req.args.get("t") || "";
		if (!user) {
			return htmlWithStatus(
				loginPage(
					`submitlink?u=${encodeURIComponent(url)}&t=${
						encodeURIComponent(title)
					}`,
					"You have to be logged in to submit.",
				),
				200,
			);
		}
		return await submitPage(user, url, title, true);
	});

	// arc: (defop news.css req (pr "..."))
	router.defop("news.css", () => ({
		status: 200,
		headers: new Map([["Content-Type", "text/css; charset=utf-8"]]),
		body: newsCss,
	}), 86400);

	// login page
	router.defop("login", async (req) => {
		const whence = req.args.get("whence") || "news";
		const create = req.args.get("create") === "t";
		const creating = req.args.get("creating") === "t";

		if (req.method === "POST") {
			const username = req.args.get("u") || "";
			const password = req.args.get("p") || "";

			if (creating) {
				// create account
				const result = await auth.createAccount(username, password);
				if (!result.success) {
					return htmlWithStatus(
						createAccountPage(whence, result.error),
						200,
					);
				}
				// arc: init-user creates profile for new user
				await initUser(username);
				// log in after creating
				const loginResult = await auth.login(
					username,
					password,
					req.ip,
				);
				if (loginResult.success) {
					await saveAuth();
					return redirectWithCookie(whence, loginResult.token);
				}
			} else {
				// login
				const result = await auth.login(username, password, req.ip);
				if (result.success) {
					// arc: ensure-news-user creates profile if not exists
					await ensureNewsUser(username);
					await saveAuth();
					return redirectWithCookie(whence, result.token);
				}
				return htmlWithStatus(loginPage(whence, result.error), 200);
			}
		}

		if (create) {
			return htmlWithStatus(createAccountPage(whence), 200);
		}
		return htmlWithStatus(loginPage(whence), 200);
	});

	// logout
	router.defop("logout", (req) => {
		const user = getUser(req);
		const whence = req.args.get("whence") || "news";
		if (user) {
			auth.logout(user);
			saveAuth();
		}
		return redirectWithClearCookie(whence);
	});

	// item page
	router.defop("item", (req) => {
		const user = getUser(req);
		const id = parseInt(req.args.get("id") || "0", 10);
		const item = items.get(id);
		if (!item) {
			return htmlWithStatus(minipage("Error", "No such item."), 404);
		}
		return itemPage(user, item);
	});

	// user page
	// arc: (newsop user (id) (if (only.profile id) (user-page user id) (pr "No such user.")))
	router.defop("user", async (req) => {
		const user = getUser(req);
		const id = req.args.get("id") || "";
		if (!(await loadProfile(id))) {
			return htmlWithStatus(minipage("Error", "No such user."), 404);
		}
		return await userPage(user, id, req.args, req.method === "POST");
	});

	// submit page
	router.defop("submit", async (req) => {
		const user = getUser(req);
		if (!user) {
			return htmlWithStatus(
				loginPage("submit", "You have to be logged in to submit."),
				200,
			);
		}

		if (req.method === "POST") {
			const rawTitle = req.args.get("t") || "";
			const url = req.args.get("u") || "";
			const text = req.args.get("x") || "";

			if (!rawTitle) {
				return submitPage(
					user,
					url,
					"",
					true,
					text,
					"Please enter a title.",
				);
			}

			// arc: (def process-title (s) (let s2 (multisubst scrubrules* s) ...))
			const title = processTitle(rawTitle);

			// arc: (submit-item user ... (vote-for by i))
			// create item with score 0, then add author's vote
			const id = ++maxId;
			const now = seconds();
			const item: Item = {
				id,
				type: "story",
				by: user,
				ip: req.ip,
				time: now,
				url: url || null,
				title,
				text: text || null,
				votes: [
					// arc: (vote-for user i) adds author's vote
					{ time: now, ip: req.ip, user, dir: "up", score: 1 },
				],
				score: 1, // score becomes 1 after author's auto-vote
				sockvotes: 0,
				flags: [],
				dead: false,
				deleted: false,
				parts: [],
				parent: null,
				kids: [],
				keys: [],
			};

			// arc: (story-ban-test user i ip url)
			await storyBanTest(user, item, req.ip, url);

			items.set(id, item);
			stories.unshift(item);
			await saveJson(`${storyDir}${id}.json`, item, ItemSchema);
			genTopstories();

			return redirect(`item?id=${id}`);
		}

		return submitPage(user);
	});

	// vote endpoint
	// arc: (newsop vote (by for dir auth whence) ...)
	router.defop("vote", async (req) => {
		const user = getUser(req);
		const itemId = parseInt(req.args.get("for") || "0", 10);
		const dir = req.args.get("dir") as "up" | "down";
		const whence = req.args.get("whence") || "news";

		const item = items.get(itemId);
		if (!item) {
			return htmlWithStatus(minipage("Error", "No such item."), 404);
		}

		if (dir !== "up" && dir !== "down") {
			return htmlWithStatus(
				minipage("Error", "Can't make that vote."),
				400,
			);
		}

		if (!user) {
			return htmlWithStatus(
				loginPage(whence, "You have to be logged in to vote."),
				200,
			);
		}

		// load user profile for validation
		const profile = await loadProfile(user);
		if (!profile) {
			return htmlWithStatus(
				minipage("Error", "User profile not found."),
				404,
			);
		}

		// arc: (unless (or ((votes user) i!id) ...) - check user's vote table
		const userVotes = await loadUserVotes(user);

		// get parent author for downvote validation
		let parentBy: string | null = null;
		if (item.parent) {
			const parent = items.get(item.parent);
			parentBy = parent?.by ?? null;
		}

		// arc: (canvote user i dir) - validate vote
		if (!canVoteOnItem(profile, item, userVotes, dir, parentBy)) {
			return htmlWithStatus(
				minipage("Error", "Can't make that vote."),
				403,
			);
		}

		// apply vote to item
		item.score += dir === "up" ? 1 : -1;
		if (!item.votes) item.votes = [];
		item.votes.push({
			time: seconds(),
			ip: req.ip,
			user,
			dir,
			score: item.score,
		});

		// arc: (= ((votes* user) i!id) vote) (save-votes user)
		recordUserVote(user, itemId, dir);

		await saveJson(`${storyDir}${item.id}.json`, item, ItemSchema);
		await saveUserVotes(user);
		genTopstories();

		return redirect(whence);
	});

	// comment endpoint
	router.defop("comment", async (req) => {
		const user = getUser(req);
		const parentId = parseInt(req.args.get("parent") || "0", 10);
		const whence = req.args.get("whence") || "news";

		const parent = items.get(parentId);
		if (!parent) {
			return htmlWithStatus(minipage("Error", "No such item."), 404);
		}

		if (!user) {
			return htmlWithStatus(
				loginPage(whence, "You have to be logged in to comment."),
				200,
			);
		}

		if (req.method === "POST") {
			const text = req.args.get("text") || "";
			if (!text.trim()) {
				return commentPage(
					user,
					parent,
					whence,
					"Please enter a comment.",
				);
			}

			// arc: (submit-item user ... (vote-for by i))
			// create comment with author's vote
			const id = ++maxId;
			const now = seconds();
			const comment: Item = {
				id,
				type: "comment",
				by: user,
				ip: req.ip,
				time: now,
				url: null,
				title: null,
				text,
				votes: [
					// arc: (vote-for user i) adds author's vote
					{ time: now, ip: req.ip, user, dir: "up", score: 1 },
				],
				score: 1, // score becomes 1 after author's auto-vote
				sockvotes: 0,
				flags: [],
				dead: false,
				deleted: false,
				parts: [],
				parent: parentId,
				kids: [],
				keys: [],
			};

			// arc: (comment-ban-test user c ip text comment-kill* comment-ignore*)
			await commentBanTest(user, comment, req.ip, text);

			// arc: (if (bad-user user) (kill c 'ignored/karma))
			// auto-kill comments from bad users (ignored or karma < -20)
			if (badUser(user)) {
				comment.dead = true;
			}

			items.set(id, comment);
			comments.unshift(comment);
			if (!parent.kids) parent.kids = [];
			parent.kids.push(id);

			await saveJson(`${storyDir}${id}.json`, comment, ItemSchema);
			await saveJson(`${storyDir}${parentId}.json`, parent, ItemSchema);

			return redirect(`item?id=${parentId}`);
		}

		return commentPage(user, parent, whence);
	});

	// reply endpoint (alias for comment on a comment)
	router.defop("reply", async (req) => {
		const user = getUser(req);
		const parentId = parseInt(req.args.get("id") || "0", 10);
		const whence = `item?id=${parentId}`;

		const parent = items.get(parentId);
		if (!parent) {
			return htmlWithStatus(minipage("Error", "No such item."), 404);
		}

		if (!user) {
			return htmlWithStatus(
				loginPage(whence, "You have to be logged in to reply."),
				200,
			);
		}

		if (req.method === "POST") {
			const text = req.args.get("text") || "";
			if (!text.trim()) {
				return replyPage(user, parent, "Please enter a comment.");
			}

			// arc: (submit-item user ... (vote-for by i))
			// create comment with author's vote
			const id = ++maxId;
			const now = seconds();
			const comment: Item = {
				id,
				type: "comment",
				by: user,
				ip: req.ip,
				time: now,
				url: null,
				title: null,
				text,
				votes: [
					// arc: (vote-for user i) adds author's vote
					{ time: now, ip: req.ip, user, dir: "up", score: 1 },
				],
				score: 1, // score becomes 1 after author's auto-vote
				sockvotes: 0,
				flags: [],
				dead: false,
				deleted: false,
				parts: [],
				parent: parentId,
				kids: [],
				keys: [],
			};

			// arc: (comment-ban-test user c ip text comment-kill* comment-ignore*)
			await commentBanTest(user, comment, req.ip, text);

			// arc: (if (bad-user user) (kill c 'ignored/karma))
			// auto-kill comments from bad users (ignored or karma < -20)
			if (badUser(user)) {
				comment.dead = true;
			}

			items.set(id, comment);
			comments.unshift(comment);
			if (!parent.kids) parent.kids = [];
			parent.kids.push(id);

			await saveJson(`${storyDir}${id}.json`, comment, ItemSchema);
			await saveJson(`${storyDir}${parentId}.json`, parent, ItemSchema);

			// redirect to the parent story
			const rootParent = findRootParent(parent);
			return redirect(`item?id=${rootParent.id}`);
		}

		return replyPage(user, parent);
	});

	// newcomments page
	router.defop("newcomments", (req) => {
		const user = getUser(req);
		const { start, end } = parsePageParam(req);
		return newcommentsPage(user, start, end);
	});

	// arc: (newsop submitted (id) (if (only.profile id) (submittedpage user id) (pr "No such user.")))
	router.defop("submitted", async (req) => {
		const user = getUser(req);
		const id = req.args.get("id");
		if (!id) {
			return htmlWithStatus(minipage("Error", "No user specified."), 400);
		}
		if (!(await loadProfile(id))) {
			return htmlWithStatus(minipage("Error", "No such user."), 404);
		}
		const { start, end } = parsePageParam(req);
		return submittedPage(user, id, start, end);
	});

	// arc: (newsop threads (id) (if (only.profile id) (threads-page user id) (pr "No such user.")))
	router.defop("threads", async (req) => {
		const user = getUser(req);
		const id = req.args.get("id");
		if (!id) {
			return htmlWithStatus(minipage("Error", "No user specified."), 400);
		}
		if (!(await loadProfile(id))) {
			return htmlWithStatus(minipage("Error", "No such user."), 404);
		}
		const { start, end } = parsePageParam(req, threadsPerpage);
		return threadsPage(user, id, start, end);
	});

	// arc: (newsop leaders () (leaderspage user))
	router.defop("leaders", (req) => {
		const user = getUser(req);
		return leadersPage(user);
	});

	// arc: (newsop rss () (rsspage nil))
	// arc: (newscache rsspage user 90
	//        (rss-stories (retrieve perpage* live ranked-stories*)))
	router.defop("rss", () => {
		// arc: (retrieve perpage* live ranked-stories*)
		const liveStories = rankedStories.filter((s) => !s.dead && !s.deleted)
			.slice(0, perpage);
		return {
			status: 200,
			headers: new Map([
				["Content-Type", "application/rss+xml; charset=utf-8"],
			]),
			body: rssStories(liveStories),
		};
	}, 90); // 90 second cache

	// arc: (newsop edit (id)
	//        (let i (safe-item id)
	//          (if (and i
	//                   (cansee user i)
	//                   (editable-type i)
	//                   (or (news-type i) (admin user) (author user i)))
	//              (edit-page user i)
	//              (pr "No such item."))))
	router.defop("edit", async (req) => {
		const user = getUser(req);
		const id = parseInt(req.args.get("id") || "0", 10);

		const item = items.get(id);
		if (!item) {
			return htmlWithStatus(minipage("Error", "No such item."), 404);
		}

		if (!user) {
			return htmlWithStatus(
				loginPage(`edit?id=${id}`, "You have to be logged in to edit."),
				200,
			);
		}

		if (!canEdit(user, item)) {
			return htmlWithStatus(
				minipage("Error", "You can't edit this."),
				403,
			);
		}

		if (req.method === "POST") {
			// handle edit submission
			if (item.type === "story") {
				const title = req.args.get("title");
				const url = req.args.get("url");
				const text = req.args.get("text");

				if (title !== null) item.title = title || null;
				if (url !== null) item.url = url || null;
				if (text !== null) item.text = text || null;
			} else if (item.type === "comment") {
				const text = req.args.get("text");
				if (text !== null) item.text = text || null;
			}

			await saveJson(`${storyDir}${item.id}.json`, item, ItemSchema);
			genTopstories();

			return redirect(`item?id=${item.id}`);
		}

		return editPage(user, item);
	});

	// flag endpoint
	// arc: flaglink action (toggling flag and auto-kill check)
	router.defop("flag", async (req) => {
		const user = getUser(req);
		const id = parseInt(req.args.get("id") || "0", 10);
		const whence = req.args.get("whence") || "news";

		const item = items.get(id);
		if (!item) {
			return htmlWithStatus(minipage("Error", "No such item."), 404);
		}

		if (!user) {
			return htmlWithStatus(
				loginPage(whence, "You have to be logged in to flag."),
				200,
			);
		}

		if (!canFlag(user, item)) {
			return htmlWithStatus(
				minipage("Error", "You can't flag this."),
				403,
			);
		}

		// arc: (togglemem user i!flags)
		toggleFlag(user, item);

		// arc: auto-kill check
		if (shouldAutoKill(item)) {
			killItem(item);
		}

		await saveJson(`${storyDir}${item.id}.json`, item, ItemSchema);
		genTopstories();

		return redirect(whence);
	});

	// arc: (newsop newpoll ()
	//        (if (and user (> (karma user) poll-threshold*))
	//            (newpoll-page user)
	//            (pr "Sorry, you need @poll-threshold* karma to create a poll.")))
	router.defop("newpoll", async (req) => {
		const user = getUser(req);

		if (!user) {
			return htmlWithStatus(
				loginPage(
					"newpoll",
					"You have to be logged in to create a poll.",
				),
				200,
			);
		}

		if (!canCreatePoll(user)) {
			return htmlWithStatus(
				minipage(
					"Error",
					`Sorry, you need ${pollThreshold} karma to create a poll.`,
				),
				403,
			);
		}

		if (req.method === "POST") {
			const rawTitle = req.args.get("t") || "";
			const text = req.args.get("x") || "";
			const opts = req.args.get("o") || "";

			// arc: validations
			if (!rawTitle || !opts) {
				return newpollPage(
					user,
					rawTitle,
					text,
					opts,
					"Please provide a title and choices.",
				);
			}

			const optList = paras(opts);
			if (optList.length < 2) {
				return newpollPage(
					user,
					rawTitle,
					text,
					opts,
					"A poll must have at least two options.",
				);
			}

			// arc: (atlet p (create-poll (multisubst scrubrules* title) text opts user ip) ...)
			const title = processTitle(rawTitle);
			const poll = await createPoll(title, text, optList, user, req.ip);
			return redirect(`item?id=${poll.id}`);
		}

		return newpollPage(user);
	});

	// arc: (def add-pollopt-page (p user) ...)
	router.defop("addopt", async (req) => {
		const user = getUser(req);
		const pollId = parseInt(req.args.get("id") || "0", 10);

		const poll = items.get(pollId);
		if (!poll || poll.type !== "poll") {
			return htmlWithStatus(minipage("Error", "No such poll."), 404);
		}

		if (!user) {
			return htmlWithStatus(
				loginPage(
					`addopt?id=${pollId}`,
					"You have to be logged in to add a choice.",
				),
				200,
			);
		}

		// only author or admin can add options
		if (!auth.isAdmin(user) && poll.by !== user) {
			return htmlWithStatus(
				minipage("Error", "You can't add options to this poll."),
				403,
			);
		}

		if (req.method === "POST") {
			const text = req.args.get("x") || "";
			if (!text.trim()) {
				return addoptPage(user, pollId, "Please enter some text.");
			}

			// arc: (add-pollopt user p text ip)
			const opt = await createPollopt(pollId, text.trim(), user, req.ip);
			if (!poll.parts) poll.parts = [];
			poll.parts.push(opt.id!);
			await saveJson(`${storyDir}${pollId}.json`, poll, ItemSchema);

			return redirect(`item?id=${pollId}`);
		}

		return addoptPage(user, pollId);
	});

	// ==========================================================================
	// Admin routes (editor/admin only)
	// ==========================================================================

	// arc: (edop flagged ()
	//        (display-selected-items user [retrieve maxend* flagged _] "flagged"))
	router.defop("flagged", (req) => {
		const user = getUser(req);
		if (!user || !isEditor(user)) {
			return htmlWithStatus(minipage("Error", "Not authorised."), 403);
		}
		return flaggedPage(user);
	});

	// arc: (edop killed ()
	//        (display-selected-items user [retrieve maxend* !dead _] "killed"))
	router.defop("killed", (req) => {
		const user = getUser(req);
		if (!user || !isEditor(user)) {
			return htmlWithStatus(minipage("Error", "Not authorised."), 403);
		}
		return killedPage(user);
	});

	// arc: (defopa newsadmin req (newsadmin-page user))
	router.defop("newsadmin", (req) => {
		const user = getUser(req);
		if (!user || !auth.isAdmin(user)) {
			return htmlWithStatus(minipage("Error", "Not authorised."), 403);
		}
		return newsadminPage(user);
	});

	// arc: killallby form from newsadmin page
	router.defop("killallby", async (req) => {
		const user = getUser(req);
		if (!user || !auth.isAdmin(user)) {
			return htmlWithStatus(minipage("Error", "Not authorised."), 403);
		}

		const subject = req.args.get("id") || "";
		if (!subject) {
			return newsadminPage(user);
		}

		// check if user exists
		const subjectProfile = profiles.get(subject);
		if (!subjectProfile) {
			return htmlWithStatus(
				minipage("Error", `No such user: ${escapeHtml(subject)}`),
				404,
			);
		}

		// kill all submissions by this user
		const killedCount = await killAllBy(subject);
		genTopstories();

		// redirect to their submitted page to show results
		return redirect(`submitted?id=${encodeURIComponent(subject)}`);
	});

	// arc: (todisk comment-kill* val) - update comment-kill keywords
	router.defop("commentkill", async (req) => {
		const user = getUser(req);
		if (!user || !auth.isAdmin(user)) {
			return htmlWithStatus(minipage("Error", "Not authorised."), 403);
		}

		if (req.method === "POST") {
			const keywordsText = req.args.get("keywords") || "";
			// split by newlines, filter empty, trim
			commentKill = keywordsText
				.split("\n")
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
			await saveCommentKill();
		}

		return redirect("newsadmin");
	});

	// arc: (todisk comment-ignore* val) - update comment-ignore keywords
	router.defop("commentignore", async (req) => {
		const user = getUser(req);
		if (!user || !auth.isAdmin(user)) {
			return htmlWithStatus(minipage("Error", "Not authorised."), 403);
		}

		if (req.method === "POST") {
			const keywordsText = req.args.get("keywords") || "";
			// split by newlines, filter empty, trim
			commentIgnore = keywordsText
				.split("\n")
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
			await saveCommentIgnore();
		}

		return redirect("newsadmin");
	});

	// arc: (defopa scrubrules req (scrub-page (get-user req) scrubrules*))
	router.defop("scrubrules", async (req) => {
		const user = getUser(req);
		if (!user || !auth.isAdmin(user)) {
			return htmlWithStatus(minipage("Error", "Not authorised."), 403);
		}

		if (req.method === "POST") {
			const fromText = req.args.get("from") || "";
			const toText = req.args.get("to") || "";

			// split by newlines
			const froms = fromText.split("\n").map((s) => s.trim());
			const tos = toText.split("\n").map((s) => s.trim());

			// filter out empty lines from both sides together
			const validPairs: Array<{ find: string; replace: string }> = [];
			const maxLen = Math.max(froms.length, tos.length);
			for (let i = 0; i < maxLen; i++) {
				const from = froms[i] || "";
				const to = tos[i] || "";
				if (from || to) {
					validPairs.push({ find: from, replace: to });
				}
			}

			// check lengths match after filtering
			const nonEmptyFroms = froms.filter((s) => s);
			const nonEmptyTos = tos.filter((s) => s);

			if (nonEmptyFroms.length !== nonEmptyTos.length) {
				return scrubPage(
					user,
					scrubrules,
					"To and from should be same length.",
				);
			}

			// update scrubrules
			scrubrules = [];
			for (let i = 0; i < nonEmptyFroms.length; i++) {
				scrubrules.push({
					find: nonEmptyFroms[i],
					replace: nonEmptyTos[i],
				});
			}

			await saveScrubrules();
			return scrubPage(user, scrubrules, "Changes saved.");
		}

		return scrubPage(user, scrubrules);
	});

	// arc: (adop editors ()
	//        (tab (each u (users [is (uvar _ auth) 1])
	//          (row (userlink user u)))))
	router.defop("editors", async (req) => {
		const user = getUser(req);
		if (!user || !auth.isAdmin(user)) {
			return htmlWithStatus(minipage("Error", "Not authorised."), 403);
		}
		return editorsPage(user);
	});

	// arc: (adop badguys ()
	//        (tab (each u (sort (compare > [uvar _ created])
	//                           (users [ignored _]))
	//          (row (userlink user u nil)))))
	router.defop("badguys", async (req) => {
		const user = getUser(req);
		if (!user || !auth.isAdmin(user)) {
			return htmlWithStatus(minipage("Error", "Not authorised."), 403);
		}
		return badguysPage(user);
	});

	// arc: (adop badsites () ...)
	router.defop("badsites", async (req) => {
		const user = getUser(req);
		if (!user || !auth.isAdmin(user)) {
			return htmlWithStatus(minipage("Error", "Not authorised."), 403);
		}
		return badsitesPage(user);
	});

	// setban - set site ban status (admin only)
	router.defop("setban", async (req) => {
		const user = getUser(req);
		if (!user || !auth.isAdmin(user)) {
			return htmlWithStatus(minipage("Error", "Not authorised."), 403);
		}
		const site = req.args.get("site");
		const banVal = req.args.get("ban");
		if (!site) {
			return htmlWithStatus(minipage("Error", "Missing site."), 400);
		}
		const ban = banVal === "kill"
			? "kill"
			: banVal === "ignore"
			? "ignore"
			: null;
		await setSiteBan(user, site, ban);
		return redirect("badsites");
	});

	// arc: (adop badips () ...)
	router.defop("badips", async (req) => {
		const user = getUser(req);
		if (!user || !auth.isAdmin(user)) {
			return htmlWithStatus(minipage("Error", "Not authorised."), 403);
		}
		return badipsPage(user);
	});

	// setipban - set ip ban status (admin only)
	router.defop("setipban", async (req) => {
		const user = getUser(req);
		if (!user || !auth.isAdmin(user)) {
			return htmlWithStatus(minipage("Error", "Not authorised."), 403);
		}
		const ip = req.args.get("ip");
		const banVal = req.args.get("ban");
		if (!ip) {
			return htmlWithStatus(minipage("Error", "Missing ip."), 400);
		}
		await setIpBan(user, ip, banVal === "1");
		return redirect("badips");
	});

	// arc: (defop formatdoc req (msgpage (get-user req) formatdoc* "Formatting Options"))
	router.defop("formatdoc", (req) => {
		const user = getUser(req);
		return htmlWithStatus(
			msgpage(user, formatdoc, "Formatting Options"),
			200,
		);
	});

	// arc: (defop whoami req ...)
	router.defop("whoami", (req) => {
		const user = getUser(req);
		if (user) {
			// arc: (prs it 'at req!ip)
			return htmlWithStatus(
				minipage("Who Am I", `${user} at ${req.ip}`),
				200,
			);
		} else {
			// arc: (pr "You are not logged in. ") (w/link (login-page 'both) (pr "Log in")) (pr ".")
			return htmlWithStatus(
				minipage(
					"Who Am I",
					`You are not logged in. ${link("login", "Log in")}.`,
				),
				200,
			);
		}
	});

	// arc: (defop mismatch req (mismatch-message))
	// arc: (def mismatch-message () (prn "Dead link: users don't match."))
	router.defop("mismatch", (req) => {
		const user = getUser(req);
		return htmlWithStatus(
			minipage("Mismatch", "Dead link: users don't match."),
			200,
		);
	});

	// arc: (defop topcolors req ...)
	router.defop("topcolors", async (req) => {
		const user = getUser(req);
		// arc: (dedup (map downcase (trues [uvar _ topcolor] (users))))
		const colours: Set<string> = new Set();
		const profFiles = [];
		for await (const entry of Deno.readDir(profDir)) {
			if (entry.isFile && entry.name.endsWith(".json")) {
				profFiles.push(entry.name);
			}
		}
		for (const file of profFiles) {
			try {
				const profile = await loadJson<Profile>(
					`${profDir}${file}`,
					ProfileSchema,
				);
				if (profile?.topcolor) {
					colours.add(profile.topcolor.toLowerCase());
				}
			} catch {
				// skip invalid profiles
			}
		}

		// arc: (tab (each c ... (tr (td c) (tdcolor (hex>color c) (hspace 30)))))
		let rows = "";
		for (const c of colours) {
			const col = hexToColour(c);
			if (col) {
				rows += tr(td(c) + tdColour(col, hspace(30)));
			}
		}
		const body = tag("table", {}, rows);
		return htmlWithStatus(minipage("Custom Colours", body), 200);
	});

	// arc: (defopr favicon.ico req favicon-url*)
	router.defop("favicon.ico", () => {
		if (config.faviconUrl) {
			return redirect(config.faviconUrl);
		}
		return { body: "", status: 404, headers: new Map<string, string>() };
	});

	// arc: (defopg resetpw req (resetpw-page (get-user req)))
	router.defop("resetpw", async (req) => {
		const user = getUser(req);
		if (!user) {
			return htmlWithStatus(
				loginPage("resetpw", "Please log in."),
				200,
			);
		}

		if (req.method === "POST") {
			const newpw = req.args.get("p") || "";
			// arc: (if (len< newpw 4) (resetpw-page user "Passwords should be..."))
			if (newpw.length < 4) {
				return resetpwPage(
					user,
					"Passwords should be a least 4 characters long. Please choose another.",
				);
			}
			// arc: (set-pw user newpw)
			await auth.setPassword(user, newpw);
			await saveAuth();
			// arc: (newspage user) - redirect to news after success
			return redirect("news");
		}

		return resetpwPage(user);
	});
}

/**
 * find the root story for a comment
 */
function findRootParent(item: Item): Item {
	if (item.parent === null) return item;
	const parent = items.get(item.parent);
	if (!parent) return item;
	return findRootParent(parent);
}

function newspage(
	user: string | null,
	start: number = 0,
	end: number = perpage,
): ReturnType<typeof htmlWithStatus> {
	const topstories = rankedStories.filter((s) =>
		realScore(s) >= 1 && !s.dead && !s.deleted
	).slice(0, maxend);

	const body = displayItems(
		user,
		topstories,
		null,
		undefined,
		"news",
		start,
		end,
	);
	return htmlWithStatus(
		longpage(user, Date.now(), null, null, undefined, "news", body),
		200,
	);
}

function newestpage(
	user: string | null,
	start: number = 0,
	end: number = perpage,
): ReturnType<typeof htmlWithStatus> {
	const newest = stories.filter((s) => !s.dead && !s.deleted).slice(
		0,
		maxend,
	);
	const body = displayItems(
		user,
		newest,
		"new",
		"New Links",
		"newest",
		start,
		end,
	);
	return htmlWithStatus(
		longpage(user, Date.now(), null, "new", "New Links", "newest", body),
		200,
	);
}

/**
 * arc: (newsop best () (bestpage user))
 * arc: (def beststories (user n)
 *        (bestn n (compare > realscore) (visible user stories*)))
 */
function bestpage(
	user: string | null,
	start: number = 0,
	end: number = perpage,
): ReturnType<typeof htmlWithStatus> {
	// sort stories by realscore descending, take top maxend
	const best = [...stories]
		.filter((s) => !s.dead && !s.deleted)
		.sort((a, b) => realScore(b) - realScore(a))
		.slice(0, maxend);

	const body = displayItems(
		user,
		best,
		"best",
		"Top Links",
		"best",
		start,
		end,
	);
	return htmlWithStatus(
		longpage(user, Date.now(), null, "best", "Top Links", "best", body),
		200,
	);
}

/**
 * arc: (newsop bestcomments () (bestcpage user))
 * arc: (def bestcomments (user n)
 *        (bestn n (compare > realscore) (visible user comments*)))
 */
function bestcpage(
	user: string | null,
	start: number = 0,
	end: number = perpage,
): ReturnType<typeof htmlWithStatus> {
	// sort comments by realscore descending, take top maxend
	const best = [...comments]
		.filter((c) => !c.dead && !c.deleted)
		.sort((a, b) => realScore(b) - realScore(a))
		.slice(0, maxend);

	const body = displayItems(
		user,
		best,
		"best comments",
		"Best Comments",
		"bestcomments",
		start,
		end,
	);
	return htmlWithStatus(
		longpage(
			user,
			Date.now(),
			null,
			"best comments",
			"Best Comments",
			"bestcomments",
			body,
		),
		200,
	);
}

/**
 * arc: (= active-threshold* 1500)
 * arc: (def active-rank (s)
 *        (sum [max 0 (- active-threshold* (item-age _))]
 *             (cdr (family s))))
 * arc: (def family (i) (cons i (mappend family:item i!kids)))
 */
const activeThreshold = 1500; // minutes

function family(item: Item): Item[] {
	const result: Item[] = [item];
	if (item.kids) {
		for (const kidId of item.kids) {
			const kid = items.get(kidId);
			if (kid) {
				result.push(...family(kid));
			}
		}
	}
	return result;
}

function activeRank(story: Item): number {
	const fam = family(story);
	// sum of max(0, activeThreshold - age) for all descendants (cdr = skip the story itself)
	return fam.slice(1).reduce((sum, item) => {
		return sum + Math.max(0, activeThreshold - itemAge(item));
	}, 0);
}

/**
 * arc: (newsop active () (active-page user))
 * arc: (def actives (user (o n maxend*) (o consider 2000))
 *        (visible user (rank-stories n consider (memo active-rank))))
 */
function activePage(
	user: string | null,
	start: number = 0,
	end: number = perpage,
): ReturnType<typeof htmlWithStatus> {
	// rank stories by active-rank (recent comment activity)
	const active = [...stories]
		.filter((s) => !s.dead && !s.deleted && s.type === "story")
		.map((s) => ({ story: s, rank: activeRank(s) }))
		.filter((x) => x.rank > 0)
		.sort((a, b) => b.rank - a.rank)
		.slice(0, maxend)
		.map((x) => x.story);

	const body = displayItems(
		user,
		active,
		"active",
		"Active Threads",
		"active",
		start,
		end,
	);
	return htmlWithStatus(
		longpage(
			user,
			Date.now(),
			null,
			"active",
			"Active Threads",
			"active",
			body,
		),
		200,
	);
}

/**
 * arc: (def bynoob (i)
 *        (< (- (user-age i!by) (item-age i)) 2880))
 *
 * item was submitted when user was <48 hours old
 */
function byNoob(item: Item): boolean {
	if (!item.by) return false;
	const profile = profiles.get(item.by);
	if (!profile) return false;
	// user age at time of submission = user age now - item age
	const userAgeAtSubmit = userAge(profile) - itemAge(item);
	return userAgeAtSubmit < 2880; // 48 hours in minutes
}

/**
 * arc: (newsop noobstories () (noobspage user stories*))
 * arc: (newsop noobcomments () (noobspage user comments*))
 * arc: (def noobspage (user source)
 *        (listpage user (msec) (noobs user maxend* source) "noobs" "New Accounts"))
 * arc: (def noobs (user n source)
 *        (retrieve n [and (cansee user _) (bynoob _)] source))
 */
function noobsPage(
	user: string | null,
	source: Item[],
	routeName: string,
	start: number = 0,
	end: number = perpage,
): ReturnType<typeof htmlWithStatus> {
	const noobs = source
		.filter((item) => !item.dead && !item.deleted && byNoob(item))
		.slice(0, maxend);

	const body = displayItems(
		user,
		noobs,
		"noobs",
		"New Accounts",
		routeName,
		start,
		end,
	);
	return htmlWithStatus(
		longpage(
			user,
			Date.now(),
			null,
			"noobs",
			"New Accounts",
			routeName,
			body,
		),
		200,
	);
}

/**
 * arc: (newsop lists ()
 *        (longpage user (msec) nil "lists" "Lists" "lists"
 *          (sptab
 *            (row (link "best")         "Highest voted recent links.")
 *            (row (link "active")       "Most active current discussions.")
 *            (row (link "bestcomments") "Highest voted recent comments.")
 *            (row (link "noobstories")  "Submissions from new accounts.")
 *            (row (link "noobcomments") "Comments from new accounts.")
 *            (when (admin user)
 *              (map row:link '(optimes topips flagged killed badguys badlogins goodlogins))))))
 */
function listsPage(user: string | null): ReturnType<typeof htmlWithStatus> {
	let body = "<table border=0 cellpadding=2 cellspacing=0>";
	body += row(link("best", "best") + td("Highest voted recent links."));
	body += row(
		link("active", "active") + td("Most active current discussions."),
	);
	body += row(
		link("bestcomments", "bestcomments") +
			td("Highest voted recent comments."),
	);
	body += row(
		link("noobstories", "noobstories") +
			td("Submissions from new accounts."),
	);
	body += row(
		link("noobcomments", "noobcomments") +
			td("Comments from new accounts."),
	);

	if (auth.isAdmin(user)) {
		body += row(link("flagged", "flagged") + td(""));
		body += row(link("killed", "killed") + td(""));
	}
	body += "</table>";

	return htmlWithStatus(
		longpage(user, Date.now(), null, "lists", "Lists", "lists", body),
		200,
	);
}

/**
 * arc: (newsop saved (id)
 *        (if (only.profile id)
 *            (savedpage user id)
 *            (pr "No such user.")))
 * arc: (def savedpage (user subject)
 *        (if (or (is user subject) (admin user))
 *            (listpage user (msec)
 *                      (sort (compare < item-age) (voted-stories user subject))
 *                     "saved" "Saved Links" (saved-url subject))
 *            (pr "Can't display that.")))
 * arc: (def voted-stories (user subject)
 *        (keep [and (astory _) (cansee user _)]
 *              (map item (keys (votes subject)))))
 */
async function savedPage(
	user: string | null,
	subject: string,
): Promise<ReturnType<typeof htmlWithStatus>> {
	// only the user themselves or admin can see saved items
	if (user !== subject && !auth.isAdmin(user)) {
		return htmlWithStatus(minipage("Error", "Can't display that."), 403);
	}

	// get user's votes
	const userVotes = await loadUserVotes(subject);
	const votedItemIds = Object.keys(userVotes).map((id) => parseInt(id, 10));

	// filter to stories only and sort by age (newest first)
	const votedStories = votedItemIds
		.map((id) => items.get(id))
		.filter((item): item is Item =>
			item !== undefined && item.type === "story" && !item.dead &&
			!item.deleted
		)
		.sort((a, b) => itemAge(a) - itemAge(b));

	const body = displayItems(
		user,
		votedStories,
		"saved",
		"Saved Links",
		`saved?id=${subject}`,
	);
	return htmlWithStatus(
		longpage(
			user,
			Date.now(),
			null,
			"saved",
			"Saved Links",
			`saved?id=${subject}`,
			body,
		),
		200,
	);
}

function itemPage(
	user: string | null,
	item: Item,
): ReturnType<typeof htmlWithStatus> {
	// arc: (def item-page (user i) ...)
	const whence = `item?id=${item.id}`;
	let body = displayItem(null, item, user, whence);

	// show item text if it's a story or poll with text but no url
	// arc: (display-item-text i user)
	if (
		(item.type === "story" || item.type === "poll") && !item.url &&
		item.text
	) {
		body += spaceRow(2) + tr(td("") + td(escapeHtml(item.text)));
	}

	// arc: (when (apoll i)
	//        (spacerow 10)
	//        (tr (td)
	//            (td (tab (display-pollopts i user here)))))
	if (item.type === "poll") {
		body += spaceRow(10);
		body += tr(
			td("") +
				td(table(displayPollopts(item, user, whence), { border: 0 })),
		);
	}

	// comment form for stories and polls
	// arc: (row "" (comment-form i user here))
	if (item.type === "story" || item.type === "poll") {
		body += spaceRow(10);
		body += tr(td("") + td(commentForm(item, user, whence)));
	}

	// arc: item and form are in one tab, then (br2), then comments in separate tab
	let content = table(body, { border: 0 });
	content += br2();

	// display comments in separate table
	// arc: (tab (display-subcomments i user here))
	if (item.kids && item.kids.length > 0) {
		content += table(displayComments(item, user, whence), { border: 0 });
		content += br2();
	}

	return htmlWithStatus(
		longpage(
			user,
			Date.now(),
			null,
			null,
			item.title || undefined,
			whence,
			content,
		),
		200,
	);
}

/**
 * comment form
 *
 * arc: (def comment-form (parent user whence (o text)) ...)
 */
function commentForm(
	parent: Item,
	user: string | null,
	whence: string,
): string {
	if (!user) {
		return link("login", `login?whence=${encodeURIComponent(whence)}`) +
			" to comment";
	}

	return form(
		`comment?parent=${parent.id}&whence=${encodeURIComponent(whence)}`,
		textarea("text", 6, 60, "") +
			br() + br() +
			submit(parent.type === "comment" ? "reply" : "add comment"),
	);
}

/**
 * display comments tree
 *
 * arc: (def display-subcomments (c user whence (o indent 0))
 *        (each k (sort (compare > frontpage-rank:item) c!kids)
 *          (display-comment-tree (item k) user whence indent)))
 */
function displayComments(
	parent: Item,
	user: string | null,
	whence: string,
	indent: number = 0,
): string {
	const kidIds = parent.kids || [];
	if (kidIds.length === 0) return "";

	// get kid items and sort by frontpage-rank (descending)
	const kids: Item[] = [];
	for (const kidId of kidIds) {
		const kid = items.get(kidId);
		if (kid && !kid.dead && !kid.deleted) {
			kids.push(kid);
		}
	}

	// sort by frontpage-rank descending (best comments first)
	kids.sort((a, b) => frontpageRank(b) - frontpageRank(a));

	let result = "";
	for (const kid of kids) {
		result += displayComment(kid, user, whence, indent);
		result += displayComments(kid, user, whence, indent + 1);
	}
	return result;
}

/**
 * display a single comment
 *
 * arc: (def display-1comment (c user whence indent showpar)
 *        (row (tab (display-comment nil c user whence t indent showpar showpar))))
 *
 * arc: (def display-comment (n c user whence (o astree) (o indent 0) ...)
 *        (tr (display-item-number n)
 *            (when astree (td (hspace (* indent 40))))
 *            (tag (td valign 'top) (votelinks c user whence t))
 *            (display-comment-body ...)))
 */
function displayComment(
	comment: Item,
	user: string | null,
	whence: string,
	indent: number,
): string {
	const indentPx = indent * 40;
	const byUser = comment.by || "unknown";

	const header = spanClass(
		"comhead",
		link(byUser, `user?id=${byUser}`) +
			" " + textAge(minutesSince(comment.time)) +
			" " + bar + " " +
			link("link", `item?id=${comment.id}`) +
			(comment.parent
				? " " + bar + " " + link("parent", `item?id=${comment.parent}`)
				: ""),
	);

	// arc: (fontcolor (comment-color c) (pr c!text))
	const textContent = fontColour(
		commentColour(comment),
		escapeHtml(comment.text || ""),
	);
	const text = spanClass("comment", textContent);

	// arc: (if (and (~mem 'neutered c!keys) (replyable c indent) (comments-active c))
	//        (underline (replylink c whence))
	//        (fontcolor sand (pr "-----")))
	// show reply link only if replyable based on indent/age
	const replyContent = replyable(comment, indent)
		? underlink("reply", `reply?id=${comment.id}`)
		: fontColour(sand, "-----");
	const reply = tag("font", { size: 1 }, replyContent);

	// arc: (tag (td class 'default) ...)
	const contentTd = td(
		tag(
			"div",
			{ style: "margin-top:2px; margin-bottom:-10px; " },
			header,
		) +
			br() +
			text +
			para() +
			reply,
		{ class: "default" },
	);

	// get parent author for downvote restriction check
	const parentItem = comment.parent ? items.get(comment.parent) : null;
	const parentBy = parentItem?.by ?? null;

	// get user profile for karma check (if user is logged in)
	const userProfile = user ? profiles.get(user) ?? null : null;

	// arc: display-comment creates a tr with indent td, votelinks td, and content td
	// arc: (votelinks c user whence t) - comments get downtoo=true
	const commentRow = tr(
		td(hspace(indentPx)) +
			td(votelinks(comment, user, whence, true, userProfile, parentBy), {
				valign: "top",
			}) +
			contentTd,
	);

	// arc: display-1comment wraps in (row (tab ...))
	// which is: <tr><td><table border=0>...</table></td></tr>
	return row(table(commentRow, { border: 0 }));
}

/**
 * comment page (for adding comments)
 */
function commentPage(
	user: string | null,
	parent: Item,
	whence: string,
	msg?: string,
): ReturnType<typeof htmlWithStatus> {
	const body = (msg ? para(msg) + br() : "") +
		table(displayItem(null, parent, user, whence), { border: 0 }) +
		spaceRow(10) +
		commentForm(parent, user, whence);

	// arc: (addcomment-page ...) uses (minipage "Add Comment" (tab ...))
	// no centre wrapping
	return htmlWithStatus(
		minipage("Add Comment", body),
		200,
	);
}

/**
 * reply page (for replying to comments)
 *
 * arc: reply op uses addcomment-page which uses display-item
 * arc: (newsop reply (id whence) ... (addcomment-page i user whence))
 */
function replyPage(
	user: string | null,
	parent: Item,
	msg?: string,
): ReturnType<typeof htmlWithStatus> {
	const whence = `item?id=${parent.id}`;

	// arc: addcomment-page uses (tab (display-item nil parent user here) (spacerow 10) (row "" form))
	const body = (msg ? para(msg) + br() : "") +
		table(
			displayItem(null, parent, user, whence) +
				spaceRow(10) +
				row("", commentForm(parent, user, whence)),
			{ border: 0 },
		);

	// arc: addcomment-page uses (minipage "Add Comment" ...)
	return htmlWithStatus(
		minipage("Add Comment", body),
		200,
	);
}

/**
 * newcomments page
 *
 * arc: (newsop newcomments ()
 *        (listpage user (msec) (visible user (firstn maxend* comments*))
 *                  "comments" "New Comments"))
 */
function newcommentsPage(
	user: string | null,
	start: number = 0,
	end: number = perpage,
): ReturnType<typeof htmlWithStatus> {
	const recentComments = comments.filter((c) => !c.dead && !c.deleted).slice(
		0,
		maxend,
	);

	let body = "";
	for (const comment of recentComments.slice(start, end)) {
		body += displayCommentWithContext(comment, user);
	}

	// more link
	const newEnd = end + perpage;
	if (newEnd <= maxend && end < recentComments.length) {
		const nextPage = Math.floor(newEnd / perpage);
		body += spaceRow(10) + tr(
			td(
				tag(
					"a",
					{ href: `newcomments?p=${nextPage}`, rel: "nofollow" },
					"More",
				),
				{ class: "title" },
			),
		);
	}

	return htmlWithStatus(
		longpage(
			user,
			Date.now(),
			null,
			"comments",
			"New Comments",
			"newcomments",
			zeroTable(body),
		),
		200,
	);
}

/**
 * display a comment with "on:" context link
 */
function displayCommentWithContext(
	comment: Item,
	user: string | null,
): string {
	const byUser = comment.by || "unknown";
	const root = findRootParent(comment);

	const header = spanClass(
		"comhead",
		link(byUser, `user?id=${byUser}`) +
			" " + textAge(minutesSince(comment.time)) +
			" " + bar + " " +
			link("link", `item?id=${comment.id}`) +
			" " + bar + " on: " +
			link(ellipsize(root.title || "", 50), `item?id=${root.id}`),
	);

	// arc: (fontcolor (comment-color c) (pr c!text))
	const textContent = fontColour(
		commentColour(comment),
		escapeHtml(comment.text || ""),
	);
	const text = spanClass("comment", textContent);

	return tr(
		td(
			tag(
				"div",
				{ style: "margin-top:2px; margin-bottom:-10px; " },
				header,
			) +
				br() +
				text,
			{ class: "default" },
		),
	) + spaceRow(15);
}

/**
 * ellipsize a string
 *
 * arc: (def ellipsize (str (o limit 80)) ...)
 */
function ellipsize(str: string, limit: number = 80): string {
	if (str.length <= limit) return str;
	return str.slice(0, limit - 3) + "...";
}

/**
 * arc: (def metastory (i) (and i (in i!type 'story 'poll)))
 */
function metastory(item: Item): boolean {
	return item.type === "story" || item.type === "poll";
}

// =============================================================================
// Edit functionality
// =============================================================================

/**
 * check if user is editor (simplified: admin only for now)
 *
 * arc: (def editor (u) (and u (or (admin u) (> (uvar u auth) 0))))
 * TODO: add profile-based auth check
 */
function isEditor(user: string | null): boolean {
	if (!user) return false;
	return auth.isAdmin(user);
}

/**
 * check if item is owned and changeable by user
 *
 * arc: (def own-changeable-item (user i)
 *        (and (author user i)
 *             (~mem 'locked i!keys)
 *             (no i!deleted)
 *             (or (everchange* i!type)
 *                 (< (item-age i) user-changetime*))))
 */
function ownChangeableItem(user: string | null, item: Item): boolean {
	if (!user || item.by !== user) return false;
	if (item.keys?.includes("locked")) return false;
	if (item.deleted) return false;
	// arc: everchange* types can always be edited, but we don't have those
	return minutesSince(item.time) < userChangetime;
}

/**
 * check if user can edit item
 *
 * arc: (def canedit (user i)
 *        (or (admin user)
 *            (and (~noedit* i!type)
 *                 (editor user)
 *                 (< (item-age i) editor-changetime*))
 *            (own-changeable-item user i)))
 */
function canEdit(user: string | null, item: Item): boolean {
	if (!user) return false;
	// admin can always edit
	if (auth.isAdmin(user)) return true;
	// editor can edit within time window
	if (isEditor(user) && minutesSince(item.time) < editorChangetime) {
		return true;
	}
	// author can edit own items within time window
	return ownChangeableItem(user, item);
}

/**
 * generate edit link if user can edit
 *
 * arc: (def editlink (i user)
 *        (when (canedit user i)
 *          (pr bar*)
 *          (link "edit" (edit-url i))))
 */
function editLink(item: Item, user: string | null): string {
	if (!canEdit(user, item)) return "";
	return bar + link("edit", `edit?id=${item.id}`);
}

// =============================================================================
// Flag functionality
// =============================================================================

/**
 * check if user can flag an item
 *
 * arc: (when (and user
 *              (isnt user i!by)
 *              (or (admin user) (> (karma user) flag-threshold*)))
 */
function canFlag(user: string | null, item: Item): boolean {
	if (!user) return false;
	if (user === item.by) return false;
	const profile = profiles.get(user);
	if (!profile) return false;
	return auth.isAdmin(user) || profile.karma > flagThreshold;
}

/**
 * check if user has flagged an item
 */
function hasFlagged(user: string, item: Item): boolean {
	if (!item.flags) return false;
	return item.flags.includes(user);
}

/**
 * toggle flag on item (add or remove user's flag)
 *
 * arc: (togglemem user i!flags)
 */
function toggleFlag(user: string, item: Item): void {
	if (!item.flags) item.flags = [];
	const idx = item.flags.indexOf(user);
	if (idx >= 0) {
		item.flags.splice(idx, 1);
	} else {
		item.flags.push(user);
	}
}

/**
 * check if an admin has voted on this item
 *
 * arc: (~find admin:!2 i!vote)
 */
function hasAdminVote(item: Item): boolean {
	if (!item.votes) return false;
	return item.votes.some((v) => auth.isAdmin(v.user));
}

/**
 * kill an item (mark as dead)
 *
 * arc: (def kill (i why) (= i!dead t) (save-item i))
 */
function killItem(item: Item): void {
	item.dead = true;
}

/**
 * kill all submissions by a user
 *
 * arc: (def killallby (user)
 *        (map [kill _ 'all] (submissions user)))
 */
async function killAllBy(subject: string): Promise<number> {
	const userItems = submissions(subject);
	let killedCount = 0;
	for (const item of userItems) {
		if (!item.dead) {
			killItem(item);
			await saveJson(`${storyDir}${item.id}.json`, item, ItemSchema);
			killedCount++;
		}
	}
	return killedCount;
}

/**
 * check if item should be auto-killed due to flags
 *
 * arc: (when (and (~mem 'nokill i!keys)
 *               (len> i!flags flag-kill-threshold*)
 *               (< (realscore i) 10)
 *               (~find admin:!2 i!vote))
 *        (kill i 'flags))
 */
function shouldAutoKill(item: Item): boolean {
	if (item.keys?.includes("nokill")) return false;
	if (!item.flags || item.flags.length <= flagKillThreshold) return false;
	if (realScore(item) >= 10) return false;
	if (hasAdminVote(item)) return false;
	return true;
}

/**
 * generate flag link for an item
 *
 * arc: (def flaglink (i user whence) ...)
 */
function flagLink(item: Item, user: string | null, whence: string): string {
	if (!canFlag(user, item)) return "";

	const flagged = hasFlagged(user!, item);
	const text = flagged ? "unflag" : "flag";

	let result = bar +
		link(text, `flag?id=${item.id}&whence=${encodeURIComponent(whence)}`);

	// arc: (when (and (admin user) (len> i!flags many-flags*))
	//        (pr bar* (plural (len i!flags) "flag") " "))
	if (auth.isAdmin(user!) && item.flags && item.flags.length > manyFlags) {
		result += bar + plural(item.flags.length, "flag") + " ";
	}

	return result;
}

/**
 * edit page for an item
 */
function editPage(
	user: string,
	item: Item,
	msg?: string,
): ReturnType<typeof htmlWithStatus> {
	const whence = `edit?id=${item.id}`;

	let body = "";

	// show item being edited
	body += table(displayItem(null, item, user, whence), { border: 0 });

	// show item text if story with text
	if (item.type === "story" && item.text) {
		body += spaceRow(2) + tr(td("") + td(escapeHtml(item.text)));
	}

	body += br2();

	if (msg) {
		body += para(msg) + br();
	}

	// edit form
	const formContent = tag(
		"table",
		{ border: 0 },
		(item.type === "story"
			? tr(td("title") + td(input("title", item.title || "", 50))) +
				tr(td("url") + td(input("url", item.url || "", 50))) +
				tr(
					td("text") +
						td(textarea("text", 4, 50, item.text || "")),
				)
			: "") +
			(item.type === "comment"
				? tr(
					td("text") +
						td(textarea("text", 6, 60, item.text || "")),
				)
				: "") +
			tr(td("") + td(submit("update"))),
	);

	body += form(`edit?id=${item.id}`, formContent);

	return htmlWithStatus(
		shortpage(user, null, null, "Edit", whence, body),
		200,
	);
}

/**
 * get submissions for a user
 *
 * arc: (def submissions (user (o limit))
 *        (map item (firstn limit (uvar user submitted))))
 *
 * since we don't track user submitted list, filter stories by author
 */
function submissions(subject: string): Item[] {
	return stories.filter((s) => s.by === subject);
}

/**
 * submitted page
 *
 * arc: (def submitted-page (user subject)
 *        (if (profile subject)
 *            (with (label (+ subject "'s submissions")
 *                   here  (submitted-url subject))
 *              (longpage user (msec) nil label label here
 *                (if (or (no (ignored subject))
 *                        (is user subject)
 *                        (seesdead user))
 *                    (aif (keep [and (metastory _) (cansee user _)]
 *                               (submissions subject))
 *                         (display-items user it label label here 0 perpage* t)))))))
 */
function submittedPage(
	user: string | null,
	subject: string,
	start: number = 0,
	end: number = perpage,
): ReturnType<typeof htmlWithStatus> {
	const label = `${subject}'s submissions`;
	const here = `submitted?id=${subject}`;

	// arc: (keep [and (metastory _) (cansee user _)] (submissions subject))
	const userSubmissions = submissions(subject).filter((s) =>
		metastory(s) && !s.dead && !s.deleted
	);

	const body = displayItems(
		user,
		userSubmissions,
		label,
		label,
		here,
		start,
		end,
	);
	return htmlWithStatus(
		longpage(user, Date.now(), null, label, label, here, body),
		200,
	);
}

/**
 * get ancestors of a comment
 */
function ancestors(item: Item): Item[] {
	const result: Item[] = [];
	let current = item;
	while (current.parent !== null) {
		const parent = items.get(current.parent);
		if (!parent) break;
		result.push(parent);
		current = parent;
	}
	return result;
}

/**
 * check if a comment is replyable based on depth and age
 *
 * arc: (def replyable (c indent)
 *        (or (< indent 2)
 *            (> (item-age c) (expt (- indent 1) reply-decay*))))
 *
 * delays by indent: 0=0min, 1=0min, 2=1min, 3=3min, 4=7min, 5=12min...
 */
function replyable(comment: Item, indent: number): boolean {
	// top-level comments (indent 0 or 1) are always replyable
	if (indent < 2) return true;

	// deeper comments require age-based delay
	const requiredAge = Math.pow(indent - 1, REPLY_DECAY);
	return itemAge(comment) > requiredAge;
}

/**
 * check if user is bad (ignored or low karma)
 *
 * arc: (def bad-user (u)
 *        (or (ignored u) (< (karma u) comment-threshold*)))
 */
function badUser(username: string): boolean {
	const profile = profiles.get(username);
	if (!profile) return false;
	return profile.ignore || (profile.karma < COMMENT_THRESHOLD);
}

/**
 * test story against banned sites and ips
 *
 * arc: (def story-ban-test (user i ip url)
 *        (site-ban-test user i url)
 *        (ip-ban-test i ip)
 *        (hook 'story-ban-test user i ip url))
 */
async function storyBanTest(
	user: string,
	item: Item,
	ip: string,
	url: string | null,
): Promise<void> {
	// site-ban-test: check if site is banned
	// arc: (def site-ban-test (user i url)
	//        (whenlet ban (banned-sites* (sitename url))
	//          (if (caris ban 'ignore) (ignore nil user 'site-ban))
	//          (kill i 'site-ban)))
	if (url) {
		const site = sitename(url);
		if (site) {
			const ban = bannedSites[site];
			if (ban) {
				// if ban type is 'ignore', auto-ignore the user
				if (ban.ban === "ignore") {
					const profile = profiles.get(user);
					if (profile) {
						profile.ignore = true;
						await saveProfile(profile);
					}
				}
				// kill the item regardless of ban type
				item.dead = true;
			}
		}
	}

	// ip-ban-test: check if ip is banned
	// arc: (def ip-ban-test (i ip) (if (banned-ips* ip) (kill i 'banned-ip)))
	if (bannedIps[ip]) {
		item.dead = true;
	}
}

/**
 * test comment against banned keywords
 *
 * arc: (def comment-ban-test (user i ip string kill-list ignore-list)
 *        (when (some [posmatch _ string] ignore-list)
 *          (ignore nil user 'comment-ban))
 *        (when (or (banned-ips* ip) (some [posmatch _ string] kill-list))
 *          (kill i 'comment-ban)))
 */
async function commentBanTest(
	user: string,
	item: Item,
	ip: string,
	text: string,
): Promise<void> {
	// check ignore list - if text contains any ignore keyword, ignore the user
	// arc: (when (some [posmatch _ string] ignore-list) (ignore nil user 'comment-ban))
	const lowerText = text.toLowerCase();
	if (
		commentIgnore.some((keyword) =>
			lowerText.includes(keyword.toLowerCase())
		)
	) {
		const profile = profiles.get(user);
		if (profile) {
			profile.ignore = true;
			await saveProfile(profile);
		}
	}

	// check kill list - if ip is banned or text contains kill keyword, kill the item
	// arc: (when (or (banned-ips* ip) (some [posmatch _ string] kill-list)) (kill i 'comment-ban))
	if (
		bannedIps[ip] ||
		commentKill.some((keyword) => lowerText.includes(keyword.toLowerCase()))
	) {
		item.dead = true;
	}
}

/**
 * check if comment is a reply to same user's comment
 *
 * arc: (def subcomment (c)
 *        (some [and (acomment _) (is _!by c!by) (no _!deleted)]
 *              (ancestors c)))
 */
function subcomment(c: Item): boolean {
	return ancestors(c).some((a) =>
		a.type === "comment" && a.by === c.by && !a.deleted
	);
}

/**
 * get user's comments (top-level thread starters, not subcomments)
 *
 * arc: (def comments (user (o limit))
 *        (retrieve limit [and (acomment _) (is _!by u) (live _)] stories*))
 */
function userComments(subject: string, limit?: number): Item[] {
	const userCmts = comments.filter((c) =>
		c.type === "comment" && c.by === subject && !c.dead && !c.deleted
	);
	return limit ? userCmts.slice(0, limit) : userCmts;
}

/**
 * display comment with its subtree for threads page
 *
 * arc: (def display-comment-tree (c user whence (o indent 0) (o initialpar))
 *        (when (cansee-descendant user c)
 *          (display-1comment c user whence indent initialpar)
 *          (display-subcomments c user whence (+ indent 1))))
 */
function displayCommentTree(
	comment: Item,
	user: string | null,
	whence: string,
	indent: number = 0,
	showpar: boolean = false,
): string {
	// display the comment itself
	let result = displayCommentInThread(comment, user, whence, indent, showpar);

	// display subcomments
	const kids = comment.kids || [];
	for (const kidId of kids) {
		const kid = items.get(kidId);
		if (!kid || kid.dead || kid.deleted) continue;
		result += displayCommentTree(kid, user, whence, indent + 1, false);
	}
	return result;
}

/**
 * display a single comment in thread context with parent link option
 *
 * arc: (def display-1comment (c user whence indent showpar)
 *        (row (tab (display-comment nil c user whence t indent showpar showpar))))
 */
function displayCommentInThread(
	comment: Item,
	user: string | null,
	whence: string,
	indent: number,
	showpar: boolean,
): string {
	const indentPx = indent * 40;
	const byUser = comment.by || "unknown";

	// build header with optional parent story link
	let headerParts = link(byUser, `user?id=${byUser}`) +
		" " + textAge(minutesSince(comment.time)) +
		" " + bar + " " +
		link("link", `item?id=${comment.id}`);

	if (comment.parent) {
		headerParts += " " + bar + " " +
			link("parent", `item?id=${comment.parent}`);
	}

	// arc: showpar adds "on: <story title>" link
	if (showpar && comment.parent) {
		const root = findRootParent(comment);
		if (root && root.title) {
			headerParts += " " + bar + " on: " +
				link(ellipsize(root.title, 50), `item?id=${root.id}`);
		}
	}

	const header = spanClass("comhead", headerParts);
	// arc: (fontcolor (comment-color c) (pr c!text))
	const textContent = fontColour(
		commentColour(comment),
		escapeHtml(comment.text || ""),
	);
	const text = spanClass("comment", textContent);
	const reply = tag(
		"font",
		{ size: 1 },
		underlink("reply", `reply?id=${comment.id}`),
	);

	const contentTd = td(
		tag(
			"div",
			{ style: "margin-top:2px; margin-bottom:-10px; " },
			header,
		) +
			br() +
			text +
			para() +
			reply,
		{ class: "default" },
	);

	// get parent author for downvote restriction check
	const parentItem = comment.parent ? items.get(comment.parent) : null;
	const parentBy = parentItem?.by ?? null;

	// get user profile for karma check (if user is logged in)
	const userProfile = user ? profiles.get(user) ?? null : null;

	// arc: (votelinks c user whence t) - comments get downtoo=true
	const commentRow = tr(
		td(hspace(indentPx)) +
			td(votelinks(comment, user, whence, true, userProfile, parentBy), {
				valign: "top",
			}) +
			contentTd,
	);

	// arc: display-1comment wraps in (row (tab ...))
	return row(table(commentRow, { border: 0 }));
}

/**
 * display threads for a user
 *
 * arc: (def display-threads (user comments label title whence
 *                        (o start 0) (o end threads-perpage*))
 *        (tab
 *          (each c (cut comments start end)
 *            (display-comment-tree c user whence 0 t))
 *          (when end
 *            (let newend (+ end threads-perpage*)
 *              (when (and (<= newend maxend*) (< end (len comments)))
 *                (spacerow 10)
 *                (row (tab (tr (td (hspace 0))
 *                              (td (hspace votewid*))
 *                              (tag (td class 'title)
 *                                (morelink ...)))))))))
 */
function displayThreads(
	user: string | null,
	threadComments: Item[],
	_label: string,
	_title: string,
	whence: string,
	start: number = 0,
	end: number = threadsPerpage,
): string {
	let result = "";
	for (const c of threadComments.slice(start, end)) {
		result += displayCommentTree(c, user, whence, 0, true);
	}

	// more link
	// arc: (morelink display-threads comments label title end newend)
	const newEnd = end + threadsPerpage;
	if (newEnd <= maxend && end < threadComments.length) {
		const nextPage = Math.floor(newEnd / threadsPerpage);
		// handle whence that may already have query params (threads?id=user)
		const separator = whence.includes("?") ? "&" : "?";
		const moreUrl = `${whence}${separator}p=${nextPage}`;
		// arc layout: row (tab (tr (td (hspace 0)) (td (hspace votewid*)) (tag (td class 'title) ...)))
		result += spaceRow(10) + row(
			table(
				tr(
					td(hspace(0)) +
						td(hspace(10)) + // votewid* = 10 in arc
						td(
							tag(
								"a",
								{ href: moreUrl, rel: "nofollow" },
								"More",
							),
							{ class: "title" },
						),
				),
				{ border: 0 },
			),
		);
	}

	return table(result, { border: 0 });
}

/**
 * threads page
 *
 * arc: (def threads-page (user subject)
 *        (if (profile subject)
 *            (withs (title (+ subject "'s comments")
 *                    label (if (is user subject) "threads" title)
 *                    here  (threads-url subject))
 *              (longpage user (msec) nil label title here
 *                (awhen (keep [and (cansee user _) (~subcomment _)]
 *                             (comments subject maxend*))
 *                  (display-threads user it label title here))))
 *            (prn "No such user.")))
 */
function threadsPage(
	user: string | null,
	subject: string,
	start: number = 0,
	end: number = threadsPerpage,
): ReturnType<typeof htmlWithStatus> {
	const title = `${subject}'s comments`;
	// arc: label is "threads" if viewing own, otherwise title
	const label = user === subject ? "threads" : title;
	const here = `threads?id=${subject}`;

	// arc: (keep [and (cansee user _) (~subcomment _)] (comments subject maxend*))
	// filter to top-level comments only (not replies to own comments)
	const threadComments = userComments(subject, maxend).filter((c) =>
		!c.dead && !c.deleted && !subcomment(c)
	);

	const body = displayThreads(
		user,
		threadComments,
		label,
		title,
		here,
		start,
		end,
	);
	return htmlWithStatus(
		longpage(user, Date.now(), null, label, title, here, body),
		200,
	);
}

/**
 * get leading users sorted by karma
 *
 * arc: (def leading-users ()
 *        (sort (compare > [karma _])
 *              (users [and (> (karma _) leader-threshold*) (~admin _)])))
 */
function leadingUsers(): Profile[] {
	const leaders: Profile[] = [];
	for (const profile of profiles.values()) {
		if (profile.karma > leaderThreshold && !auth.isAdmin(profile.id!)) {
			leaders.push(profile);
		}
	}
	leaders.sort((a, b) => b.karma - a.karma);
	return leaders;
}

// =============================================================================
// Poll Support
// =============================================================================

/**
 * split text into paragraphs (blank line separated)
 *
 * arc: (paras opts) - split by blank lines
 */
function paras(text: string): string[] {
	return text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) =>
		p.length > 0
	);
}

/**
 * check if user can create polls
 *
 * arc: (and user (> (karma user) poll-threshold*))
 */
function canCreatePoll(user: string | null): boolean {
	if (!user) return false;
	const profile = profiles.get(user);
	if (!profile) return false;
	return profile.karma > pollThreshold;
}

/**
 * create a poll option
 *
 * arc: (def create-pollopt (p url title text user ip)
 *        (let o (inst 'item 'type 'pollopt 'id (new-item-id)
 *                       'url url 'title title 'text text 'parent p!id
 *                       'by user 'ip ip)
 *          (save-item o)
 *          (= (items* o!id) o)
 *          o))
 */
async function createPollopt(
	pollId: number,
	text: string,
	user: string,
	ip: string,
): Promise<Item> {
	const id = ++maxId;
	const now = seconds();
	const opt: Item = {
		id,
		type: "pollopt",
		by: user,
		ip,
		time: now,
		url: null,
		title: null,
		text,
		votes: [{ time: now, ip, user, dir: "up", score: 1 }],
		score: 1,
		sockvotes: 0,
		flags: [],
		dead: false,
		deleted: false,
		parts: [],
		parent: pollId,
		kids: [],
		keys: [],
	};

	items.set(id, opt);
	await saveJson(`${storyDir}${id}.json`, opt, ItemSchema);
	return opt;
}

/**
 * create a poll with options
 *
 * arc: (def create-poll (title text opts user ip)
 *        (newslog ip user 'create-poll title)
 *        (let p (inst 'item 'type 'poll 'id (new-item-id)
 *                       'title title 'text text 'by user 'ip ip)
 *          (= p!parts (map get!id (map [create-pollopt p nil nil _ user ip]
 *                                      (paras opts))))
 *          (save-item p)
 *          (= (items* p!id) p)
 *          (push p stories*)
 *          p))
 */
async function createPoll(
	title: string,
	text: string,
	opts: string[],
	user: string,
	ip: string,
): Promise<Item> {
	const id = ++maxId;
	const now = seconds();

	// create the poll item first
	const poll: Item = {
		id,
		type: "poll",
		by: user,
		ip,
		time: now,
		url: null,
		title,
		text: text || null,
		votes: [{ time: now, ip, user, dir: "up", score: 1 }],
		score: 1,
		sockvotes: 0,
		flags: [],
		dead: false,
		deleted: false,
		parts: [],
		parent: null,
		kids: [],
		keys: [],
	};

	// create poll options
	const partIds: number[] = [];
	for (const optText of opts) {
		const opt = await createPollopt(id, optText, user, ip);
		partIds.push(opt.id!);
	}
	poll.parts = partIds;

	items.set(id, poll);
	stories.unshift(poll);
	await saveJson(`${storyDir}${id}.json`, poll, ItemSchema);
	genTopstories();

	return poll;
}

/**
 * display a poll option
 *
 * arc: (def display-pollopt (n o user whence) ...)
 */
function displayPollopt(
	num: number | null,
	opt: Item,
	user: string | null,
	whence: string,
): string {
	const numCell = num ? td(`${num}.`, { align: "right", valign: "top" }) : "";

	const voteCell = td(votelinks(opt, user, whence), { valign: "top" });

	// arc: (fontcolor black (pr o!text))
	const textContent = tag(
		"font",
		{ color: "black" },
		escapeHtml(opt.text || ""),
	);

	const optCell = td(
		tag("div", { style: "margin-top:1px;margin-bottom:0px" }, textContent),
		{ class: "comment" },
	);

	const scoreRow = tr(
		(num ? td("") : "") +
			td("") +
			td(
				spanClass("comhead", itemScore(opt) + editLink(opt, user)),
				{ class: "default" },
			),
	);

	return tr(numCell + voteCell + optCell) + scoreRow + spaceRow(7);
}

/**
 * display poll options
 *
 * arc: (def display-pollopts (p user whence)
 *        (each o (visible user (map item p!parts))
 *          (display-pollopt nil o user whence)
 *          (spacerow 7)))
 */
function displayPollopts(
	poll: Item,
	user: string | null,
	whence: string,
): string {
	let result = "";
	if (poll.parts) {
		for (const optId of poll.parts) {
			const opt = items.get(optId);
			if (!opt || opt.dead || opt.deleted) continue;
			result += displayPollopt(null, opt, user, whence);
		}
	}
	return result;
}

/**
 * item score text
 *
 * arc: (def itemscore (i) ...)
 */
function itemScore(item: Item): string {
	// arc: pollopt uses realscore, others use score
	const score = item.type === "pollopt" ? realScore(item) : item.score;
	return plural(score, "point");
}

/**
 * add choice link for poll authors
 *
 * arc: (def addoptlink (p user)
 *        (when (or (admin user) (author user p))
 *          (pr bar*)
 *          (onlink "add choice" (add-pollopt-page p user))))
 */
function addoptLink(poll: Item, user: string | null): string {
	if (!user) return "";
	if (!auth.isAdmin(user) && poll.by !== user) return "";
	return bar + link("add choice", `addopt?id=${poll.id}`);
}

/**
 * new poll page
 *
 * arc: (def newpoll-page (user (o title "Poll: ") (o text "") (o opts "") (o msg)) ...)
 */
function newpollPage(
	_user: string,
	title: string = "Poll: ",
	text: string = "",
	opts: string = "",
	msg?: string,
): ReturnType<typeof htmlWithStatus> {
	const body = (msg ? para(msg) + br() : "") +
		form(
			"newpoll",
			tag(
				"table",
				{ border: 0 },
				tr(td("title") + td(input("t", title, 50))) +
					tr(td("text") + td(textarea("x", 4, 50, text))) +
					tr(td("") + td("Use blank lines to separate choices:")) +
					tr(td("choices") + td(textarea("o", 7, 50, opts))) +
					tr(td("") + td(submit("create poll"))),
			),
		);
	return htmlWithStatus(minipage("New Poll", body), 200);
}

/**
 * add poll option page
 *
 * arc: (def add-pollopt-page (p user) ...)
 */
function addoptPage(
	_user: string,
	pollId: number,
	msg?: string,
): ReturnType<typeof htmlWithStatus> {
	const body = (msg ? para(msg) + br() : "") +
		form(
			`addopt?id=${pollId}`,
			tag(
				"table",
				{ border: 0 },
				tr(td("text") + td(textarea("x", 4, 50, ""))) +
					tr(td("") + td(submit("add choice"))),
			),
		);
	return htmlWithStatus(minipage("Add Poll Choice", body), 200);
}

// =============================================================================
// Procrastination Mode
// =============================================================================

/**
 * reset procrastination timers for a user
 *
 * arc: (def reset-procrast (user)
 *        (= (uvar user lastview) (= (uvar user firstview) (seconds)))
 *        (save-prof user))
 */
async function resetProcrast(profile: Profile): Promise<void> {
	const now = seconds();
	profile.firstview = now;
	profile.lastview = now;
	await saveProfile(profile);
}

/**
 * check if user is allowed to view page (procrastination check)
 *
 * arc: (def check-procrast (user)
 *        (or (no user)
 *            (no (uvar user noprocrast))
 *            (let now (seconds)
 *              (unless (uvar user firstview)
 *                (reset-procrast user))
 *              (or (when (< (/ (- now (uvar user firstview)) 60)
 *                           (uvar user maxvisit))
 *                    (= (uvar user lastview) now)
 *                    (save-prof user)
 *                    t)
 *                  (when (> (/ (- now (uvar user lastview)) 60)
 *                           (uvar user minaway))
 *                    (reset-procrast user)
 *                    t)))))
 */
async function checkProcrast(profile: Profile | null): Promise<boolean> {
	// no user = always allowed
	if (!profile) return true;

	// noprocrast not set = allowed
	if (!profile.noprocrast) return true;

	const now = seconds();

	// if no firstview, reset and allow
	if (!profile.firstview) {
		await resetProcrast(profile);
		return true;
	}

	const minutesSinceFirstView = (now - profile.firstview) / 60;
	const minutesSinceLastView = (now - (profile.lastview || 0)) / 60;

	// still within maxvisit window?
	if (minutesSinceFirstView < profile.maxvisit) {
		profile.lastview = now;
		await saveProfile(profile);
		return true;
	}

	// been away long enough (minaway)?
	if (minutesSinceLastView > profile.minaway) {
		await resetProcrast(profile);
		return true;
	}

	// blocked by procrastination
	return false;
}

/**
 * generate procrastination message page
 *
 * arc: (def procrast-msg (user whence) ...)
 */
function procrastMsg(profile: Profile, whence: string): string {
	const minutesLeft = Math.ceil(
		profile.minaway - minutesSince(profile.lastview || 0),
	);

	const body = bold("Get back to work!") +
		para(
			`Sorry, you can't see this page. Based on the anti-procrastination ` +
				`parameters you set in your profile, you'll be able to use the site ` +
				`again in ${plural(minutesLeft, "minute")}.`,
		) +
		para(
			"(If you got this message after submitting something, don't worry, " +
				"the submission was processed.)",
		) +
		para(
			"To change your anti-procrastination settings, go to your profile " +
				"by clicking on your username. If <tt>noprocrast</tt> is set to " +
				"<tt>yes</tt>, you'll be limited to sessions of <tt>maxvisit</tt> " +
				"minutes, with <tt>minaway</tt> minutes between them.",
		) +
		para() +
		underlink("retry", whence) +
		br2();

	return body;
}

// =============================================================================
// Admin Pages
// =============================================================================

/**
 * check if item is flagged (live, no nokill key, more than many flags)
 *
 * arc: (def flagged (i)
 *        (and (live i)
 *             (~mem 'nokill i!keys)
 *             (len> i!flags many-flags*)))
 */
function isFlagged(item: Item): boolean {
	if (item.dead || item.deleted) return false;
	if (item.keys?.includes("nokill")) return false;
	if (!item.flags || item.flags.length <= manyFlags) return false;
	return true;
}

/**
 * flagged items page
 *
 * arc: (edop flagged ()
 *        (display-selected-items user [retrieve maxend* flagged _] "flagged"))
 */
function flaggedPage(user: string): ReturnType<typeof htmlWithStatus> {
	const flaggedStories = stories.filter((s) => isFlagged(s)).slice(0, maxend);
	const flaggedComments = comments.filter((c) => isFlagged(c)).slice(
		0,
		maxend,
	);

	const body = displaySelectedItems(
		user,
		flaggedStories,
		flaggedComments,
		"flagged",
	);
	return htmlWithStatus(
		longpage(user, Date.now(), null, "flagged", "Flagged", "flagged", body),
		200,
	);
}

/**
 * killed items page
 *
 * arc: (edop killed ()
 *        (display-selected-items user [retrieve maxend* !dead _] "killed"))
 */
function killedPage(user: string): ReturnType<typeof htmlWithStatus> {
	const killedStories = stories.filter((s) => s.dead).slice(0, maxend);
	const killedComments = comments.filter((c) => c.dead).slice(0, maxend);

	const body = displaySelectedItems(
		user,
		killedStories,
		killedComments,
		"killed",
	);
	return htmlWithStatus(
		longpage(user, Date.now(), null, "killed", "Killed", "killed", body),
		200,
	);
}

/**
 * display selected items (stories and comments with separator)
 *
 * arc: (def display-selected-items (user f whence)
 *        (display-items user (f stories*) nil nil whence)
 *        (vspace 35)
 *        (color-stripe textgray)
 *        (vspace 35)
 *        (display-items user (f comments*) nil nil whence))
 */
function displaySelectedItems(
	user: string,
	storyList: Item[],
	commentList: Item[],
	whence: string,
): string {
	const storiesHtml = displayItems(user, storyList, null, undefined, whence);
	const separator = vspace(35) + colourStripe(colour(130, 130, 130)) +
		vspace(35);
	const commentsHtml = displayItems(
		user,
		commentList,
		null,
		undefined,
		whence,
	);

	return storiesHtml + separator + commentsHtml;
}

/**
 * newsadmin page (basic version)
 *
 * arc: simplified admin page showing links to admin functions
 */
function newsadminPage(user: string): ReturnType<typeof htmlWithStatus> {
	const adminLinks = [
		link("flagged items", "flagged"),
		link("killed items", "killed"),
		link("leaders", "leaders"),
		link("editors", "editors"),
		link("bad guys", "badguys"),
		link("bad sites", "badsites"),
		link("bad ips", "badips"),
		link("scrubrules", "scrubrules"),
	];

	// arc: (aform ... (single-input "" 'id 20 "kill all by"))
	const killAllByForm = form(
		"killallby",
		input("id", "", 20) + " " + submit("kill all by"),
	);

	// arc: (bigtoks comment-kill comment-kill*) - keywords that kill comments
	const commentKillForm = form(
		"commentkill",
		"comment-kill (one per line):" + br() +
			textarea("keywords", 5, 40, commentKill.join("\n")) + br() +
			submit("update"),
	);

	// arc: (bigtoks comment-ignore comment-ignore*) - keywords that ignore users
	const commentIgnoreForm = form(
		"commentignore",
		"comment-ignore (one per line):" + br() +
			textarea("keywords", 5, 40, commentIgnore.join("\n")) + br() +
			submit("update"),
	);

	const body = tag("h3", {}, "Admin") +
		para(withBars(adminLinks)) +
		br2() +
		killAllByForm +
		br2() +
		commentKillForm +
		br2() +
		commentIgnoreForm +
		br2() +
		para(`Logged in as: ${user}`);

	return htmlWithStatus(
		shortpage(user, null, null, "newsadmin", "newsadmin", body),
		200,
	);
}

/**
 * editors page - list users with editor privileges
 *
 * arc: (adop editors ()
 *        (tab (each u (users [is (uvar _ auth) 1])
 *          (row (userlink user u)))))
 */
function editorsPage(user: string): ReturnType<typeof htmlWithStatus> {
	// get all profiles with auth === 1 (editors, not admins)
	const editors: Profile[] = [];
	for (const profile of profiles.values()) {
		if (profile.auth === 1) {
			editors.push(profile);
		}
	}

	let rows = "";
	for (const editor of editors) {
		rows += row(link(editor.id!, `user?id=${editor.id}`));
	}

	const body = table(rows, { border: 0 }) || para("No editors.");

	return htmlWithStatus(
		shortpage(user, null, null, "editors", "Editors", body),
		200,
	);
}

/**
 * badguys page - list ignored users sorted by creation date
 *
 * arc: (adop badguys ()
 *        (tab (each u (sort (compare > [uvar _ created])
 *                           (users [ignored _]))
 *          (row (userlink user u nil)))))
 */
function badguysPage(user: string): ReturnType<typeof htmlWithStatus> {
	// get all ignored profiles, sorted by created desc
	const badguys: Profile[] = [];
	for (const profile of profiles.values()) {
		if (profile.ignore) {
			badguys.push(profile);
		}
	}
	badguys.sort((a, b) => (b.created || 0) - (a.created || 0));

	let rows = "";
	for (const badguy of badguys) {
		rows += row(link(badguy.id!, `user?id=${badguy.id}`));
	}

	const body = table(rows, { border: 0 }) || para("No ignored users.");

	return htmlWithStatus(
		shortpage(user, null, null, "badguys", "Bad Guys", body),
		200,
	);
}

/**
 * set site ban
 *
 * arc: (def set-site-ban (user site ban (o info))
 *        (= (banned-sites* site) (and ban (list ban user (seconds) info)))
 *        (todisk banned-sites*))
 */
async function setSiteBan(
	user: string,
	site: string,
	ban: "kill" | "ignore" | null,
): Promise<void> {
	if (ban) {
		bannedSites[site] = {
			ban,
			user,
			time: seconds(),
			info: null,
		};
	} else {
		delete bannedSites[site];
	}
	await saveBannedSites();
}

/**
 * get killed sites - sites with dead items
 *
 * arc: (defcache killedsites 300
 *        (let bads (table [each-loaded-item i
 *                    (awhen (and i!dead (sitename i!url))
 *                      (push i (_ it)))])
 *          ...))
 */
function getKilledSites(): Map<string, Item[]> {
	const siteItems = new Map<string, Item[]>();

	for (const item of [...stories, ...comments]) {
		if (item.dead && item.url) {
			const site = sitename(item.url);
			if (site) {
				const existing = siteItems.get(site) || [];
				existing.push(item);
				siteItems.set(site, existing);
			}
		}
	}

	return siteItems;
}

/**
 * days since a timestamp
 */
function daysSince(time: number): number {
	return (seconds() - time) / (60 * 60 * 24);
}

/**
 * badsites page - admin page showing sites with banned/killed content
 *
 * arc: (adop badsites ()
 *        (sptab
 *          (row "Dead" "Days" "Site" "O" "K" "I" "Users")
 *          (each (site deads) ...)))
 */
function badsitesPage(user: string): ReturnType<typeof htmlWithStatus> {
	// collect all sites with killed items or bans
	const killedSites = getKilledSites();
	const allSites = new Set<string>([
		...killedSites.keys(),
		...Object.keys(bannedSites),
	]);

	// build rows
	let rows = tr(
		td("Dead") + td("Days") + td("Site") +
			td("O") + td("K") + td("I") + td("Users"),
	);

	// sort sites by number of dead items (desc)
	const sortedSites = [...allSites].sort((a, b) => {
		const aDeads = killedSites.get(a)?.length ?? 0;
		const bDeads = killedSites.get(b)?.length ?? 0;
		return bDeads - aDeads;
	});

	for (const site of sortedSites) {
		const deads = killedSites.get(site) || [];
		const ban = bannedSites[site];
		const banType = ban?.ban ?? null;

		// dead count
		const deadCount = deads.length > 0 ? String(deads.length) : "";

		// days since most recent kill
		const daysSinceKill = deads.length > 0
			? String(Math.round(daysSince(deads[0].time)))
			: "";

		// users who submitted killed items
		const users = [...new Set(deads.map((d) => d.by).filter((b) => b))];
		const userLinks = users.map((u) => link(u!, `user?id=${u}`)).join(" ");

		// O/K/I links (clear/kill/ignore)
		// arc uses colour to show current state: gray.220 if not selected, specific colour if selected
		const gray = "#dcdcdc";
		const oLink = link(
			`<font color="${banType === null ? "black" : gray}">x</font>`,
			`setban?site=${encodeURIComponent(site)}&ban=`,
		);
		const kLink = link(
			`<font color="${banType === "kill" ? "darkred" : gray}">x</font>`,
			`setban?site=${encodeURIComponent(site)}&ban=kill`,
		);
		const iLink = link(
			`<font color="${banType === "ignore" ? "darkred" : gray}">x</font>`,
			`setban?site=${encodeURIComponent(site)}&ban=ignore`,
		);

		rows += tr(
			td(deadCount, { align: "right" }) +
				td(daysSinceKill, { align: "right" }) +
				td(site) +
				td(oLink) +
				td(kLink) +
				td(iLink) +
				td(userLinks),
		);
	}

	const body = table(rows, { border: 0, cellspacing: 3 });

	return htmlWithStatus(
		shortpage(user, null, null, "badsites", "Bad Sites", body),
		200,
	);
}

/**
 * set ip ban
 *
 * arc: (def set-ip-ban (user ip yesno (o info))
 *        (= (banned-ips* ip) (and yesno (list user (seconds) info)))
 *        (todisk banned-ips*))
 */
async function setIpBan(
	user: string,
	ip: string,
	yesno: boolean,
): Promise<void> {
	if (yesno) {
		bannedIps[ip] = {
			user,
			time: seconds(),
			info: null,
		};
	} else {
		delete bannedIps[ip];
	}
	await saveBannedIps();
}

/**
 * get items grouped by ip, separated into dead and live
 *
 * arc: (defcache badips 300
 *        (with (bads (table) goods (table))
 *          (each-loaded-item s
 *            (if (and s!dead (commentable s))
 *                (push s (bads  s!ip))
 *                (push s (goods s!ip))))
 *          (list bads goods)))
 */
function getBadIps(): {
	bads: Map<string, Item[]>;
	goods: Map<string, Item[]>;
} {
	const bads = new Map<string, Item[]>();
	const goods = new Map<string, Item[]>();

	for (const item of [...stories, ...comments]) {
		if (!item.ip) continue;
		if (item.dead) {
			const existing = bads.get(item.ip) || [];
			existing.push(item);
			bads.set(item.ip, existing);
		} else {
			const existing = goods.get(item.ip) || [];
			existing.push(item);
			goods.set(item.ip, existing);
		}
	}

	return { bads, goods };
}

/**
 * badips page - admin page showing ips with banned content
 *
 * arc: (adop badips ()
 *        (withs ((bads goods) (badips)
 *                (subs ips)   (sorted-badips bads goods))
 *          (sptab
 *            (row "IP" "Days" "Dead" "Live" "Users")
 *            ...)))
 */
function badipsPage(user: string): ReturnType<typeof htmlWithStatus> {
	const { bads, goods } = getBadIps();

	// collect all ips with bad items or explicit bans
	const allIps = new Set<string>([
		...bads.keys(),
		...Object.keys(bannedIps),
	]);

	// filter to ips with at least 2 dead items or explicit ban
	const filteredIps = [...allIps].filter(
		(ip) => (bads.get(ip)?.length ?? 0) >= 2 || bannedIps[ip],
	);

	// sort by number of dead items (desc)
	filteredIps.sort((a, b) => {
		const aBads = bads.get(a)?.length ?? 0;
		const bBads = bads.get(b)?.length ?? 0;
		return bBads - aBads;
	});

	// build rows
	let rows = tr(
		td("IP") + td("Days") + td("Dead") + td("Live") + td("Users"),
	);

	for (const ip of filteredIps) {
		const badItems = bads.get(ip) || [];
		const goodItems = goods.get(ip) || [];
		const isBanned = !!bannedIps[ip];

		// days since most recent activity
		const allItems = [...badItems, ...goodItems];
		const mostRecentTime = allItems.length > 0
			? Math.max(...allItems.map((i) => i.time))
			: 0;
		const days = mostRecentTime > 0
			? String(Math.round(daysSince(mostRecentTime)))
			: "";

		// users who submitted from this ip
		const users = [...new Set(allItems.map((i) => i.by).filter((b) => b))];
		const userLinks = users.map((u) => link(u!, `user?id=${u}`)).join(" ");

		// ip link - click to toggle ban
		const ipLink = link(
			`<font color="${isBanned ? "darkred" : "black"}">${
				escapeHtml(ip)
			}</font>`,
			`setipban?ip=${encodeURIComponent(ip)}&ban=${isBanned ? "0" : "1"}`,
		);

		rows += tr(
			td(ipLink) +
				td(days, { align: "right" }) +
				td(String(badItems.length), { align: "right" }) +
				td(String(goodItems.length), { align: "right" }) +
				td(userLinks),
		);
	}

	const body = table(rows, { border: 0, cellspacing: 3 });

	return htmlWithStatus(
		shortpage(user, null, null, "badips", "Bad IPs", body),
		200,
	);
}

/**
 * scrubrules page - admin page for editing title find/replace rules
 *
 * arc: (defopa scrubrules req (scrub-page (get-user req) scrubrules*))
 *
 * arc: (def scrub-page (user rules (o msg nil))
 *        (minipage "Scrubrules"
 *          (when msg (pr msg) (br2))
 *          (uform user req
 *            (with (froms (lines (arg req "from"))
 *                   tos   (lines (arg req "to")))
 *              (if (is (len froms) (len tos))
 *                  (do (todisk scrubrules* (map list froms tos))
 *                      (scrub-page user scrubrules* "Changes saved."))
 *                  (scrub-page user rules "To and from should be same length.")))
 *            (pr "From: ")
 *            (tag (textarea name 'from
 *                          cols (apply max 20 (map len (map car rules)))
 *                          rows (+ (len rules) 3))
 *              (apply pr #\newline (intersperse #\newline (map car rules))))
 *            (pr " To: ")
 *            (tag (textarea name 'to
 *                          cols (apply max 20 (map len (map cadr rules)))
 *                          rows (+ (len rules) 3))
 *              (apply pr #\newline (intersperse #\newline (map cadr rules))))
 *            (br2)
 *            (submit "update"))))
 */
function scrubPage(
	user: string,
	rules: ScrubRules,
	msg?: string,
): ReturnType<typeof htmlWithStatus> {
	// calculate textarea dimensions
	const fromCols = Math.max(20, ...rules.map((r) => r.find.length));
	const toCols = Math.max(20, ...rules.map((r) => r.replace.length));
	const rows = rules.length + 3;

	// get the from/to values as newline-separated strings
	const fromText = rules.map((r) => r.find).join("\n");
	const toText = rules.map((r) => r.replace).join("\n");

	const msgHtml = msg ? escapeHtml(msg) + br2() : "";

	// arc: (tag (textarea name 'from cols ... rows ...) (apply pr ...))
	// textarea signature: (name, rows, cols, content)
	const formBody = `From: ${textarea("from", rows, fromCols, fromText)} To: ${
		textarea("to", rows, toCols, toText)
	}${br2()}${submit("update")}`;

	// arc: (uform user req ...) - form with hidden fnid for user validation
	const hiddenFnid = genTag("input", {
		type: "hidden",
		name: "fnid",
		value: user,
	});
	const body = msgHtml + form("scrubrules", hiddenFnid + formBody);

	return htmlWithStatus(minipage("Scrubrules", body), 200);
}

// =============================================================================
// RSS Feed
// =============================================================================

/**
 * generate RSS feed for stories
 *
 * arc: (def rss-stories (stories)
 *        (tag (rss version "2.0")
 *          (tag channel
 *            (tag title (pr this-site*))
 *            (tag link (pr site-url*))
 *            (tag description (pr site-desc*))
 *            (each s stories
 *              (tag item
 *                (let comurl (+ site-url* (item-url s!id))
 *                  (tag title    (pr (eschtml s!title)))
 *                  (tag link     (pr (if (blank s!url) comurl (eschtml s!url))))
 *                  (tag comments (pr comurl))
 *                  (tag description
 *                    (cdata (link "Comments" comurl)))))))))
 */
function rssStories(storyList: Item[]): string {
	let itemsXml = "";
	for (const s of storyList) {
		const comurl = config.siteUrl + `item?id=${s.id}`;
		const linkUrl = s.url ? escapeHtml(s.url) : comurl;
		itemsXml += `    <item>
      <title>${escapeHtml(s.title || "")}</title>
      <link>${linkUrl}</link>
      <comments>${comurl}</comments>
      <description><![CDATA[<a href="${comurl}">Comments</a>]]></description>
    </item>\n`;
	}

	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeHtml(config.thisSite)}</title>
    <link>${escapeHtml(config.siteUrl)}</link>
    <description>${escapeHtml(config.siteDesc)}</description>
${itemsXml}  </channel>
</rss>`;
}

/**
 * leaders page
 *
 * arc: (newscache leaderspage user 1000
 *        (longpage user (msec) nil "leaders" "Leaders" "leaders"
 *          (sptab
 *            (let i 0
 *              (each u (firstn nleaders* (leading-users))
 *                (tr (tdr:pr (++ i) ".")
 *                    (td (userlink user u nil))
 *                    (tdr:pr (karma u))
 *                    (when (admin user)
 *                      (tdr:prt (only.num (uvar u avg) 2 t t))))
 *                (if (is i 10) (spacerow 30)))))))
 */
function leadersPage(
	user: string | null,
): ReturnType<typeof htmlWithStatus> {
	const leaders = leadingUsers().slice(0, nleaders);

	let rows = "";
	let i = 0;
	for (const leader of leaders) {
		i++;
		rows += tr(
			td(`${i}.`, { align: "right" }) +
				td(link(leader.id!, `user?id=${leader.id}`)) +
				td(String(leader.karma), { align: "right" }),
		);
		// arc: (if (is i 10) (spacerow 30))
		if (i === 10) {
			rows += spaceRow(30);
		}
	}

	const body = table(rows, { border: 0, cellspacing: 0 });
	return htmlWithStatus(
		longpage(user, Date.now(), null, "leaders", "Leaders", "leaders", body),
		200,
	);
}

// arc: (= topcolor-threshold* 250)
const topcolourThreshold = 250;

/**
 * field type enum for profile form
 */
type FieldType =
	| "string"
	| "int"
	| "posint"
	| "num"
	| "yesno"
	| "mdtext2"
	| "hexcol";

/**
 * profile field definition
 */
interface ProfileField {
	type: FieldType;
	name: string;
	value: string | number | boolean | null;
	visible: boolean;
	editable: boolean;
}

/**
 * arc: (def user-fields (user subject) ...)
 * returns field definitions for the profile form
 */
function userFields(
	user: string | null,
	subject: string,
	profile: Profile,
): ProfileField[] {
	const userIsEditor = isEditor(user);
	const isAdmin = user !== null && auth.isAdmin(user);
	const isOwner = user === subject;
	// arc: k = (and w (> (karma user) topcolor-threshold*))
	const canChangeColour = isOwner && profile.karma > topcolourThreshold;
	// arc: u = (or a w)
	const canEdit = isAdmin || isOwner;
	// arc: m = (or a (and (member user) w))
	const isMember = profile.member === true;
	const canEditName = isAdmin || (isMember && isOwner);

	const createdAge = textAge(minutesSince(profile.created));
	const resetpwLink = isOwner ? underlink("reset password", "resetpw") : "";
	const savedLink = canEdit ? savedLinkFor(user, subject) : "";

	// arc: ((type name value visible editable) ...)
	return [
		{
			type: "string",
			name: "user",
			value: subject,
			visible: true,
			editable: false,
		},
		{
			type: "string",
			name: "name",
			value: profile.name,
			visible: canEditName,
			editable: canEditName,
		},
		{
			type: "string",
			name: "created",
			value: createdAge,
			visible: true,
			editable: false,
		},
		{
			type: "string",
			name: "password",
			value: resetpwLink,
			visible: isOwner,
			editable: false,
		},
		{
			type: "string",
			name: "saved",
			value: savedLink,
			visible: canEdit,
			editable: false,
		},
		{
			type: "int",
			name: "auth",
			value: profile.auth,
			visible: userIsEditor,
			editable: isAdmin,
		},
		{
			type: "yesno",
			name: "member",
			value: profile.member,
			visible: isAdmin,
			editable: isAdmin,
		},
		{
			type: "posint",
			name: "karma",
			value: profile.karma,
			visible: true,
			editable: isAdmin,
		},
		{
			type: "num",
			name: "avg",
			value: profile.avg,
			visible: isAdmin,
			editable: false,
		},
		{
			type: "yesno",
			name: "ignore",
			value: profile.ignore,
			visible: userIsEditor,
			editable: userIsEditor,
		},
		{
			type: "num",
			name: "weight",
			value: profile.weight,
			visible: isAdmin,
			editable: isAdmin,
		},
		{
			type: "mdtext2",
			name: "about",
			value: profile.about,
			visible: true,
			editable: canEdit,
		},
		{
			type: "string",
			name: "email",
			value: profile.email,
			visible: canEdit,
			editable: canEdit,
		},
		{
			type: "yesno",
			name: "showdead",
			value: profile.showdead,
			visible: canEdit,
			editable: canEdit,
		},
		{
			type: "yesno",
			name: "noprocrast",
			value: profile.noprocrast,
			visible: canEdit,
			editable: canEdit,
		},
		{
			type: "string",
			name: "firstview",
			value: profile.firstview?.toString() ?? "",
			visible: isAdmin,
			editable: false,
		},
		{
			type: "string",
			name: "lastview",
			value: profile.lastview?.toString() ?? "",
			visible: isAdmin,
			editable: false,
		},
		{
			type: "posint",
			name: "maxvisit",
			value: profile.maxvisit,
			visible: canEdit,
			editable: canEdit,
		},
		{
			type: "posint",
			name: "minaway",
			value: profile.minaway,
			visible: canEdit,
			editable: canEdit,
		},
		{
			type: "hexcol",
			name: "topcolor",
			value: profile.topcolor ?? hexRep(config.siteColour),
			visible: canChangeColour,
			editable: canChangeColour,
		},
		{
			type: "int",
			name: "delay",
			value: profile.delay,
			visible: canEdit,
			editable: canEdit,
		},
	];
}

/**
 * arc: (def saved-link (user subject) ...)
 */
function savedLinkFor(user: string | null, subject: string): string {
	if (!user) return "";
	if (!auth.isAdmin(user) && user !== subject) return "";
	const userVotes = votes.get(subject);
	if (!userVotes) return "";
	const storyVotes = Object.entries(userVotes).filter(([id, vote]) => {
		const item = items.get(parseInt(id, 10));
		return item && item.type === "story" && vote.dir === "up";
	});
	const n = storyVotes.length;
	if (n === 0) return "";
	if (n > 500) return underlink("many", `saved?id=${subject}`);
	return underlink(String(n), `saved?id=${subject}`);
}

/**
 * arc: (def varfield (typ id val) ...) - editable input field
 */
function varField(
	typ: FieldType,
	name: string,
	val: string | number | boolean | null,
): string {
	const strVal = val === null || val === undefined ? "" : String(val);
	const numWid = 16;
	const formWid = 60;

	switch (typ) {
		case "string":
			return genTag("input", {
				type: "text",
				name,
				value: strVal,
				size: formWid,
			});
		case "num":
		case "int":
		case "posint":
			return genTag("input", {
				type: "text",
				name,
				value: strVal,
				size: numWid,
			});
		case "yesno":
			return tag(
				"select",
				{ name },
				tag(
					"option",
					{ value: "yes", selected: val === true ? true : undefined },
					"yes",
				) +
					tag(
						"option",
						{
							value: "no",
							selected: val !== true ? true : undefined,
						},
						"no",
					),
			);
		case "mdtext2": {
			const text = strVal;
			const rows = Math.max(4, text.split("\n").length + 1);
			return (
				tag(
					"textarea",
					{ name, cols: formWid, rows, wrap: "virtual" },
					escapeHtml(text),
				) +
				" " +
				tag("font", { size: -2 }, link("help", "formatdoc"))
			);
		}
		case "hexcol":
			return genTag("input", { type: "text", name, value: strVal });
		default:
			return escapeHtml(strVal);
	}
}

/**
 * arc: (def varline (typ id val) ...) - read-only display
 */
function varLine(
	typ: FieldType,
	_name: string,
	val: string | number | boolean | null,
): string {
	if (val === null || val === undefined) return "";
	switch (typ) {
		case "yesno":
			return val === true ? "yes" : "no";
		case "string":
		case "mdtext2":
			// for string type with HTML (like resetpw link), don't escape
			if (typeof val === "string" && val.includes("<")) {
				return val;
			}
			return escapeHtml(String(val));
		default:
			return escapeHtml(String(val));
	}
}

/**
 * arc: (def showvars (fields) ...) - render fields as table rows
 */
function showVars(fields: ProfileField[]): string {
	let rows = "";
	for (const field of fields) {
		if (!field.visible) continue;
		const label = td(field.name + ":");
		const value = field.editable
			? varField(field.type, field.name, field.value)
			: varLine(field.type, field.name, field.value);
		rows += tr(label + td(value));
	}
	return rows;
}

/**
 * arc: (def vars-form (user fields f done) ...)
 * generates profile form HTML
 */
function varsForm(
	subject: string,
	fields: ProfileField[],
	hasEditable: boolean,
): string {
	const tableContent = showVars(fields);
	const formContent = tag("table", { border: 0 }, tableContent) +
		(hasEditable ? br() + submit("update") : "");

	if (hasEditable) {
		return form(`user?id=${subject}`, formContent);
	}
	return tag("table", { border: 0 }, tableContent);
}

/**
 * arc: (def readvar (typ str) ...) - parse form value to typed value
 */
function readVar(
	typ: FieldType,
	str: string,
): string | number | boolean | null {
	switch (typ) {
		case "string":
		case "hexcol":
			return stripTags(str);
		case "num": {
			const n = parseFloat(str);
			return isNaN(n) ? null : n;
		}
		case "int": {
			const n = parseInt(str, 10);
			return isNaN(n) ? null : n;
		}
		case "posint": {
			const n = parseInt(str, 10);
			return isNaN(n) || n <= 0 ? null : n;
		}
		case "yesno":
			return str === "yes";
		case "mdtext2":
			return stripTags(str.replace(/\r/g, ""));
		default:
			return str;
	}
}

/**
 * arc: (def user-page (user subject) ...)
 */
async function userPage(
	user: string | null,
	subject: string,
	args?: Map<string, string>,
	isPost?: boolean,
): Promise<ReturnType<typeof htmlWithStatus>> {
	// arc: ensure-news-user creates profile if missing
	const profile = await ensureNewsUser(subject);

	// generate field definitions
	const fields = userFields(user, subject, profile);
	const hasEditable = fields.some((f) => f.editable);

	// handle POST - update profile
	if (isPost && args && user) {
		for (const field of fields) {
			if (!field.editable) continue;
			const newVal = args.get(field.name);
			if (newVal !== undefined) {
				const parsed = readVar(field.type, newVal);
				if (parsed !== null) {
					// arc: (= (prof name) val)
					// update profile with parsed value
					switch (field.name) {
						case "name":
							profile.name = parsed as string;
							break;
						case "auth":
							profile.auth = parsed as number;
							break;
						case "member":
							profile.member = parsed as boolean;
							break;
						case "karma":
							profile.karma = parsed as number;
							break;
						case "ignore":
							profile.ignore = parsed as boolean;
							break;
						case "weight":
							profile.weight = parsed as number;
							break;
						case "about":
							profile.about = parsed as string;
							break;
						case "email":
							profile.email = parsed as string;
							break;
						case "showdead":
							profile.showdead = parsed as boolean;
							break;
						case "noprocrast":
							profile.noprocrast = parsed as boolean;
							break;
						case "maxvisit":
							profile.maxvisit = parsed as number;
							break;
						case "minaway":
							profile.minaway = parsed as number;
							break;
						case "topcolor":
							profile.topcolor = parsed as string;
							break;
						case "delay":
							profile.delay = parsed as number;
							break;
					}
				}
			}
		}
		// arc: (save-prof subject)
		profile.id = subject;
		await saveProfile(profile);
		// refresh fields after update
		const updatedFields = userFields(user, subject, profile);
		const body = varsForm(subject, updatedFields, hasEditable);
		const links = profileLinks(subject, profile);
		return htmlWithStatus(
			shortpage(
				user,
				null,
				null,
				`Profile: ${subject}`,
				`user?id=${subject}`,
				body + br2() + links,
			),
			200,
		);
	}

	// GET - show profile form
	const body = varsForm(subject, fields, hasEditable);
	const links = profileLinks(subject, profile);
	return htmlWithStatus(
		shortpage(
			user,
			null,
			null,
			`Profile: ${subject}`,
			`user?id=${subject}`,
			body + br2() + links,
		),
		200,
	);
}

/**
 * arc: (when (some astory:item (uvar subject submitted)) (underlink "submissions" ...))
 */
function profileLinks(subject: string, profile: Profile): string {
	const links: string[] = [];
	const submitted = profile.submitted ?? [];
	const hasStories = submitted.some((id) => {
		const item = items.get(id);
		return item && item.type === "story";
	});
	const hasComments = submitted.some((id) => {
		const item = items.get(id);
		return item && item.type === "comment";
	});
	if (hasStories) {
		links.push(underlink("submissions", `submitted?id=${subject}`));
	}
	if (hasComments) {
		links.push(underlink("comments", `threads?id=${subject}`));
	}
	return links.join(" ");
}

/**
 * arc: (def resetpw-page (user (o msg)) ...)
 * password reset form
 */
async function resetpwPage(
	user: string,
	msg?: string,
): Promise<ReturnType<typeof htmlWithStatus>> {
	const profile = await loadProfile(user);

	// arc: (if msg (pr msg)
	//         (blank (uvar user email))
	//           (do (pr "Before you do this...") ...))
	let warning = "";
	if (msg) {
		warning = msg;
	} else if (!profile?.email) {
		warning = `Before you do this, please add your email address to your ${
			underlink("profile", `user?id=${user}`)
		}. Otherwise you could lose your account if you mistype your new password.`;
	}

	// arc: (single-input "New password: " 'p 20 "reset" t)
	const formContent = warning + br2() +
		form(
			"resetpw",
			"New password: " +
				passwordInput("p", 20) +
				" " +
				submit("reset"),
		);

	return htmlWithStatus(
		minipage("Reset Password", formContent),
		200,
	);
}

/**
 * arc: (def submit-page (user (o url) (o title) (o showtext) (o text "") (o msg)) ...)
 */
function submitPage(
	user: string | null,
	url: string = "",
	title: string = "",
	showtext: boolean = true,
	text: string = "",
	msg?: string,
): ReturnType<typeof htmlWithStatus> {
	const body = (msg ? para(msg) + br() : "") +
		form(
			"submit",
			tag(
				"table",
				{ border: 0 },
				tr(td("title") + td(input("t", escapeHtml(title), 50))) +
					tr(td("url") + td(input("u", escapeHtml(url), 50))) +
					(showtext
						? tr(
							td("text") +
								td(tag(
									"textarea",
									{ name: "x", rows: 4, cols: 50 },
									escapeHtml(text),
								)),
						)
						: "") +
					tr(td("") + td(submit("submit"))),
			),
		);
	return htmlWithStatus(
		shortpage(user, null, null, "Submit", "submit", body),
		200,
	);
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * apply multiple find/replace substitutions to a string
 *
 * arc: (def multisubst (pairs seq)
 *        (tostring
 *          (forlen i seq
 *            (iflet (old new) (find [begins seq (car _) i] pairs)
 *              (do (++ i (- (len old) 1))
 *                  (pr new))
 *              (pr (seq i))))))
 */
function multisubst(pairs: ScrubRules, seq: string): string {
	let result = "";
	let i = 0;
	while (i < seq.length) {
		let matched = false;
		for (const { find, replace } of pairs) {
			if (seq.startsWith(find, i)) {
				result += replace;
				i += find.length;
				matched = true;
				break;
			}
		}
		if (!matched) {
			result += seq[i];
			i++;
		}
	}
	return result;
}

/**
 * process title by applying scrubrules and capitalising first letter
 *
 * arc: (def process-title (s)
 *        (let s2 (multisubst scrubrules* s)
 *          (zap upcase (s2 0))
 *          s2))
 */
function processTitle(title: string): string {
	const s2 = multisubst(scrubrules, title);
	if (s2.length === 0) return s2;
	return s2.charAt(0).toUpperCase() + s2.slice(1);
}

function getUser(req: Request): string | null {
	const token = req.cookies.get("user");
	return auth.getUserFromToken(token, req.ip);
}

/**
 * parse page parameter from request
 * returns start and end indices for pagination
 *
 * arc: morelink generates urls like fnid-based continuation
 * we use simpler ?p=N where N is 1-indexed page number
 */
function parsePageParam(
	req: Request,
	itemsPerPage: number = perpage,
): { start: number; end: number } {
	const p = parseInt(req.args.get("p") || "1", 10);
	// handle NaN (invalid input like "abc") by defaulting to page 1
	const validP = isNaN(p) ? 1 : p;
	// clamp to valid range, page 1 minimum
	const page = Math.max(
		1,
		Math.min(validP, Math.ceil(maxend / itemsPerPage)),
	);
	const start = (page - 1) * itemsPerPage;
	const end = Math.min(start + itemsPerPage, maxend);
	return { start, end };
}

function htmlWithStatus(html: string, status: number) {
	return {
		status,
		headers: new Map([["Content-Type", "text/html; charset=utf-8"]]),
		body: html,
	};
}

function redirect(location: string) {
	return {
		status: 302,
		headers: new Map([["Location", location]]),
		body: "",
	};
}

function redirectWithCookie(location: string, token: string) {
	return {
		status: 302,
		headers: new Map([
			["Location", location],
			["Set-Cookie", `user=${token}; Path=/; HttpOnly`],
		]),
		body: "",
	};
}

function redirectWithClearCookie(location: string) {
	return {
		status: 302,
		headers: new Map([
			["Location", location],
			["Set-Cookie", "user=; Path=/; Max-Age=0"],
		]),
		body: "",
	};
}

// =============================================================================
// Exports for testing
// =============================================================================

export {
	// page functions
	activePage,
	// UI helpers
	activeRank,
	// constants
	activeThreshold,
	addoptLink,
	addoptPage,
	ancestors,
	// state
	auth,
	badguysPage,
	badipsPage,
	badsitesPage,
	bannedIps,
	bannedSites,
	bar,
	bestcpage,
	bestpage,
	byNoob,
	canCreatePoll,
	canEdit,
	canFlag,
	commentForm,
	commentlink,
	commentPage,
	comments,
	config,
	createAccountPage,
	createPoll,
	createPollopt,
	daysSince,
	displayComment,
	displayCommentInThread,
	displayComments,
	displayCommentTree,
	displayCommentWithContext,
	displayItem,
	displayItemComment,
	displayItems,
	displayPollopt,
	displayPollopts,
	displaySelectedItems,
	displayStory,
	displayThreads,
	downUrl,
	downvoteThreshold,
	downvoteTime,
	editLink,
	editorChangetime,
	editorsPage,
	editPage,
	ellipsize,
	// load/save
	ensureDir,
	// helpers
	ensureNewsUser,
	family,
	findRootParent,
	flaggedPage,
	flagKillThreshold,
	flagLink,
	flagThreshold,
	formatdoc,
	genTopstories,
	getBadIps,
	getKilledSites,
	getUser,
	hasAdminVote,
	hasFlagged,
	hasUserVoted,
	// response helpers
	htmlWithStatus,
	initUser,
	isEditor,
	isFlagged,
	itemline,
	itemPage,
	items,
	itemScore,
	killedPage,
	killItem,
	leadersPage,
	leaderThreshold,
	leadingUsers,
	listsPage,
	loadAuth,
	loadItems,
	loadProfile,
	loadUserVotes,
	loginPage,
	logoUrl,
	longpage,
	lowestScore,
	mainColour,
	manyFlags,
	maxend,
	metastory,
	minipage,
	msgpage,
	multisubst,
	newcommentsPage,
	newestpage,
	newpollPage,
	newsadminPage,
	newsDir,
	newspage,
	nleaders,
	noobsPage,
	npage,
	ownChangeableItem,
	pagetop,
	paras,
	// pagination
	parsePageParam,
	perpage,
	pollThreshold,
	processTitle,
	procrastMsg,
	profDir,
	profileLinks,
	profiles,
	rankedStories,
	readVar,
	recordUserVote,
	redirect,
	redirectWithClearCookie,
	redirectWithCookie,
	replyPage,
	rssStories,
	saveAuth,
	saveBannedIps,
	saveBannedSites,
	savedLinkFor,
	savedPage,
	saveProfile,
	saveScrubrules,
	saveUserVotes,
	scrubPage,
	scrubrules,
	// routing
	setupRoutes,
	shortpage,
	shouldAutoKill,
	showVars,
	stories,
	storyDir,
	subcomment,
	submissions,
	submitPage,
	submittedPage,
	threadsPage,
	threadsPerpage,
	titleline,
	toggleFlag,
	toplink,
	topright,
	upUrl,
	userChangetime,
	userComments,
	userFields,
	userPage,
	varField,
	varLine,
	varsForm,
	voteDir,
	votejs,
	votelinks,
	votes,
	votewid,
	whitepage,
};

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
	console.log("starting arc news clone...");

	await loadAuth();
	await loadItems();

	const router = new Router();
	setupRoutes(router);

	// port configurable via environment variable for testing
	const port = parseInt(Deno.env.get("NEWS_PORT") ?? "8080", 10);

	const serverConfig = createServerConfig({
		port,
		staticDir: "static",
	});
	console.log(`server running on http://localhost:${serverConfig.port}`);
	console.log(`data directory: ${newsDir}`);

	createServer(serverConfig, router);
}

if (import.meta.main) {
	main();
}

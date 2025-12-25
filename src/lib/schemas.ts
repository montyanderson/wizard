/**
 * zod schemas for arc news data models
 *
 * based on arc3.2/news.arc deftem definitions (lines 26-68)
 */

import { z } from "@zod/zod";

/**
 * arc: (deftem profile
 *   id         nil
 *   name       nil
 *   created    (seconds)
 *   auth       0
 *   member     nil
 *   submitted  nil
 *   votes      nil   ; for now just recent, elts each (time id by sitename dir)
 *   karma      1
 *   avg        nil
 *   weight     .5
 *   ignore     nil
 *   email      nil
 *   about      nil
 *   showdead   nil
 *   noprocrast nil
 *   firstview  nil
 *   lastview   nil
 *   maxvisit   20
 *   minaway    180
 *   topcolor   nil
 *   keys       nil
 *   delay      0)
 */
export const ProfileSchema = z.object({
	id: z.string().nullable().default(null),
	name: z.string().nullable().default(null),
	created: z.number().default(() => Math.floor(Date.now() / 1000)),
	auth: z.number().default(0),
	member: z.boolean().nullable().default(null),
	submitted: z.array(z.number()).nullable().default(null),
	// votes: elts each (time id by sitename dir)
	votes: z
		.array(
			z.object({
				time: z.number(),
				id: z.number(),
				by: z.string(),
				sitename: z.string().nullable(),
				dir: z.enum(["up", "down"]),
			}),
		)
		.nullable()
		.default(null),
	karma: z.number().default(1),
	avg: z.number().nullable().default(null),
	weight: z.number().default(0.5),
	ignore: z.boolean().nullable().default(null),
	email: z.string().nullable().default(null),
	about: z.string().nullable().default(null),
	showdead: z.boolean().nullable().default(null),
	noprocrast: z.boolean().nullable().default(null),
	firstview: z.number().nullable().default(null),
	lastview: z.number().nullable().default(null),
	maxvisit: z.number().default(20),
	minaway: z.number().default(180),
	topcolor: z.string().nullable().default(null),
	keys: z.array(z.string()).nullable().default(null),
	delay: z.number().default(0),
});

export type Profile = z.infer<typeof ProfileSchema>;

/**
 * item types as defined in arc news
 * arc: (def astory   (i) (is i!type 'story))
 *      (def acomment (i) (is i!type 'comment))
 *      (def apoll    (i) (is i!type 'poll))
 *      pollopt is also used (line 1726)
 */
export const ItemTypeSchema = z.enum(["story", "comment", "poll", "pollopt"]);

export type ItemType = z.infer<typeof ItemTypeSchema>;

/**
 * vote direction
 */
export const VoteDirectionSchema = z.enum(["up", "down"]);

export type VoteDirection = z.infer<typeof VoteDirectionSchema>;

/**
 * individual vote record stored in item!votes
 * arc: votes nil ; elts each (time ip user type score)
 * note: 'type' here means direction (up/down), 'score' is the score at time of vote
 */
export const ItemVoteSchema = z.object({
	time: z.number(),
	ip: z.string(),
	user: z.string(),
	dir: VoteDirectionSchema,
	score: z.number(),
});

export type ItemVote = z.infer<typeof ItemVoteSchema>;

/**
 * arc: (deftem item
 *   id         nil
 *   type       nil
 *   by         nil
 *   ip         nil
 *   time       (seconds)
 *   url        nil
 *   title      nil
 *   text       nil
 *   votes      nil   ; elts each (time ip user type score)
 *   score      0
 *   sockvotes  0
 *   flags      nil
 *   dead       nil
 *   deleted    nil
 *   parts      nil
 *   parent     nil
 *   kids       nil
 *   keys       nil)
 */
export const ItemSchema = z.object({
	id: z.number().nullable().default(null),
	type: ItemTypeSchema.nullable().default(null),
	by: z.string().nullable().default(null),
	ip: z.string().nullable().default(null),
	time: z.number().default(() => Math.floor(Date.now() / 1000)),
	url: z.string().nullable().default(null),
	title: z.string().nullable().default(null),
	text: z.string().nullable().default(null),
	votes: z.array(ItemVoteSchema).nullable().default(null),
	score: z.number().default(0),
	sockvotes: z.number().default(0),
	flags: z.array(z.string()).nullable().default(null),
	dead: z.boolean().nullable().default(null),
	deleted: z.boolean().nullable().default(null),
	parts: z.array(z.number()).nullable().default(null), // poll option ids
	parent: z.number().nullable().default(null),
	kids: z.array(z.number()).nullable().default(null),
	keys: z.array(z.string()).nullable().default(null),
});

export type Item = z.infer<typeof ItemSchema>;

/**
 * user vote table entry
 * stored in votedir/{username} as a table mapping item id -> vote info
 * arc: (= (votes* u) (load-table (+ votedir* u)))
 */
export const UserVoteSchema = z.object({
	dir: VoteDirectionSchema,
	time: z.number(),
});

export type UserVote = z.infer<typeof UserVoteSchema>;

/**
 * user votes table: maps item id (as string key) to vote info
 */
export const UserVotesTableSchema = z.record(z.string(), UserVoteSchema);

export type UserVotesTable = z.infer<typeof UserVotesTableSchema>;

/**
 * session/cookie mapping
 * arc: cookie->user* table maps session token -> username
 */
export const SessionSchema = z.object({
	token: z.string(),
	user: z.string(),
	ip: z.string(),
	created: z.number(),
});

export type Session = z.infer<typeof SessionSchema>;

/**
 * sessions table
 */
export const SessionsTableSchema = z.record(z.string(), SessionSchema);

export type SessionsTable = z.infer<typeof SessionsTableSchema>;

/**
 * password hash type
 * - sha256-salted: new format (wizard)
 * - sha512-unsalted: anarki format for migration
 */
export const PasswordTypeSchema = z.enum(["sha256-salted", "sha512-unsalted"]);

/**
 * password hash entry
 */
export const PasswordEntrySchema = z.object({
	hash: z.string(),
	salt: z.string(),
	type: PasswordTypeSchema.optional().default("sha256-salted"),
});

export type PasswordEntry = z.infer<typeof PasswordEntrySchema>;

/**
 * password table: maps username to password entry
 */
export const PasswordTableSchema = z.record(z.string(), PasswordEntrySchema);

export type PasswordTable = z.infer<typeof PasswordTableSchema>;

/**
 * site ban entry
 *
 * arc: (= (banned-sites* site) (and ban (list ban user (seconds) info)))
 */
export const SiteBanEntrySchema = z.object({
	ban: z.enum(["kill", "ignore"]),
	user: z.string(),
	time: z.number(),
	info: z.string().nullable().optional(),
});

export type SiteBanEntry = z.infer<typeof SiteBanEntrySchema>;

/**
 * banned sites table: maps domain to ban entry
 */
export const BannedSitesTableSchema = z.record(z.string(), SiteBanEntrySchema);

export type BannedSitesTable = z.infer<typeof BannedSitesTableSchema>;

/**
 * ip ban entry
 *
 * arc: (= (banned-ips* ip) (and yesno (list user (seconds) info)))
 */
export const IpBanEntrySchema = z.object({
	user: z.string(),
	time: z.number(),
	info: z.string().nullable().optional(),
});

export type IpBanEntry = z.infer<typeof IpBanEntrySchema>;

/**
 * banned ips table: maps ip to ban entry
 */
export const BannedIpsTableSchema = z.record(z.string(), IpBanEntrySchema);

export type BannedIpsTable = z.infer<typeof BannedIpsTableSchema>;

/**
 * lightweights table: maps domain to lightweight status
 */
export const LightweightsTableSchema = z.record(z.string(), z.boolean());

export type LightweightsTable = z.infer<typeof LightweightsTableSchema>;

/**
 * scrub rules: find/replace pairs for title cleaning
 */
export const ScrubRuleSchema = z.object({
	find: z.string(),
	replace: z.string(),
});

export type ScrubRule = z.infer<typeof ScrubRuleSchema>;

export const ScrubRulesSchema = z.array(ScrubRuleSchema);

export type ScrubRules = z.infer<typeof ScrubRulesSchema>;

/**
 * comment keyword lists
 * arc: (diskvar comment-kill* (+ newsdir* "comment-kill"))
 * arc: (diskvar comment-ignore* (+ newsdir* "comment-ignore"))
 */
export const CommentKeywordsSchema = z.array(z.string());

export type CommentKeywords = z.infer<typeof CommentKeywordsSchema>;

/**
 * RGB colour as [r, g, b] array
 */
export const RgbColourSchema = z
	.tuple([z.number(), z.number(), z.number()])
	.transform(([r, g, b]) => ({ r, g, b }));

export type RgbColour = z.infer<typeof RgbColourSchema>;

/**
 * site configuration
 * arc: lines 10-17
 */
export const SiteConfigSchema = z.object({
	thisSite: z.string().default("My Forum"),
	siteUrl: z.string().default("http://news.yourdomain.com/"),
	parentUrl: z.string().default("http://www.yourdomain.com"),
	faviconUrl: z.string().default(""),
	logoUrl: z.string().default("arc.png"),
	siteDesc: z.string().default("What this site is about."),
	siteColour: RgbColourSchema.default({ r: 180, g: 180, b: 180 }),
	borderColour: RgbColourSchema.default({ r: 180, g: 180, b: 180 }),
	preferUrl: z.boolean().default(true),
});

export type SiteConfig = z.infer<typeof SiteConfigSchema>;

/**
 * migration script for converting anarki news data to wizard format
 *
 * anarki stores data as s-expressions (lisp format)
 * this script parses them and converts to json
 */

import { z } from "@zod/zod";
import {
	createStorageConfig,
	ensureStorageDirs,
	saveBannedIps,
	saveBannedSites,
	saveItem,
	savePasswords,
	saveProfile,
	saveSessions,
	saveUserVotes,
	type StorageConfig,
} from "./lib/storage.ts";
import {
	BannedIpsTableSchema,
	BannedSitesTableSchema,
	type Item,
	ItemSchema,
	type ItemVote,
	PasswordTableSchema,
	type Profile,
	ProfileSchema,
	SessionsTableSchema,
	type UserVotesTable,
	UserVotesTableSchema,
} from "./lib/schemas.ts";

// =============================================================================
// S-expression parser
// =============================================================================

type SExpr = string | number | null | SExpr[];

/**
 * tokenise an s-expression string
 */
export function tokenise(input: string): string[] {
	const tokens: string[] = [];
	let i = 0;

	while (i < input.length) {
		const char = input[i];

		// skip whitespace
		if (/\s/.test(char)) {
			i++;
			continue;
		}

		// parentheses
		if (char === "(" || char === ")") {
			tokens.push(char);
			i++;
			continue;
		}

		// quoted string
		if (char === '"') {
			let str = "";
			i++; // skip opening quote
			while (i < input.length && input[i] !== '"') {
				if (input[i] === "\\" && i + 1 < input.length) {
					// handle escape sequences
					i++;
					const escaped = input[i];
					if (escaped === "n") str += "\n";
					else if (escaped === "t") str += "\t";
					else if (escaped === "r") str += "\r";
					else if (escaped === '"') str += '"';
					else if (escaped === "\\") str += "\\";
					else str += escaped;
				} else {
					str += input[i];
				}
				i++;
			}
			i++; // skip closing quote
			tokens.push(`"${str}"`);
			continue;
		}

		// symbol or number
		let token = "";
		while (
			i < input.length && !/[\s()]/.test(input[i]) && input[i] !== '"'
		) {
			token += input[i];
			i++;
		}
		if (token) {
			tokens.push(token);
		}
	}

	return tokens;
}

/**
 * parse tokens into an s-expression tree
 */
export function parseTokens(tokens: string[]): SExpr {
	let pos = 0;

	function parse(): SExpr {
		if (pos >= tokens.length) {
			throw new Error("unexpected end of input");
		}

		const token = tokens[pos++];

		if (token === "(") {
			const list: SExpr[] = [];
			while (pos < tokens.length && tokens[pos] !== ")") {
				list.push(parse());
			}
			if (pos >= tokens.length) {
				throw new Error("missing closing parenthesis");
			}
			pos++; // skip )
			return list;
		}

		if (token === ")") {
			throw new Error("unexpected closing parenthesis");
		}

		// nil
		if (token === "nil") {
			return null;
		}

		// quoted string (stored as "content" in tokeniser, need to strip both quotes)
		if (token.startsWith('"')) {
			// token is in format "content" - strip both quotes
			return token.slice(1, -1);
		}

		// number
		const num = Number(token);
		if (!isNaN(num)) {
			return num;
		}

		// symbol (return as string)
		return token;
	}

	return parse();
}

/**
 * parse an s-expression string
 */
export function parseSExpr(input: string): SExpr {
	const tokens = tokenise(input);
	if (tokens.length === 0) {
		return null;
	}
	return parseTokens(tokens);
}

/**
 * convert an association list to a record
 * ((key1 val1) (key2 val2)) -> { key1: val1, key2: val2 }
 */
export function alistToRecord(sexpr: SExpr): Record<string, SExpr> {
	if (!Array.isArray(sexpr)) {
		return {};
	}

	const record: Record<string, SExpr> = {};
	for (const item of sexpr) {
		if (Array.isArray(item) && item.length >= 2) {
			const key = String(item[0]);
			record[key] = item[1];
		}
	}
	return record;
}

// =============================================================================
// Migration functions
// =============================================================================

/**
 * migrate passwords from anarki hpw format
 * format: (("user1" "(stdin)= hash1") ("user2" "(stdin)= hash2"))
 *
 * anarki uses unsalted sha512 with "(stdin)= " prefix in stored value
 * we store the hash directly with type "sha512-unsalted"
 */
export function migratePasswords(
	sexpr: SExpr,
): z.infer<typeof PasswordTableSchema> {
	if (!Array.isArray(sexpr)) {
		return {};
	}

	const passwords: z.infer<typeof PasswordTableSchema> = {};

	for (const entry of sexpr) {
		if (Array.isArray(entry) && entry.length >= 2) {
			const username = String(entry[0]);
			const hashValue = String(entry[1]);

			// anarki format: "(stdin)= <sha512hex>"
			const match = hashValue.match(/^\(stdin\)= ([a-fA-F0-9]+)$/);
			if (match) {
				passwords[username] = {
					hash: match[1],
					salt: "", // anarki uses unsalted hashes
					type: "sha512-unsalted",
				};
			}
		}
	}

	return PasswordTableSchema.parse(passwords);
}

/**
 * migrate sessions from anarki cooks format
 * format: ((cookie1 "user1") (cookie2 "user2"))
 */
export function migrateSessions(
	sexpr: SExpr,
): z.infer<typeof SessionsTableSchema> {
	if (!Array.isArray(sexpr)) {
		return {};
	}

	const sessions: z.infer<typeof SessionsTableSchema> = {};
	const now = Math.floor(Date.now() / 1000);

	for (const entry of sexpr) {
		if (Array.isArray(entry) && entry.length >= 2) {
			const token = String(entry[0]);
			const user = String(entry[1]);

			sessions[token] = {
				token,
				user,
				ip: "0.0.0.0", // unknown from migration
				created: now,
			};
		}
	}

	return SessionsTableSchema.parse(sessions);
}

/**
 * migrate a profile from anarki format
 * format: ((id "user") (karma 10) (created 123456) ...)
 */
export function migrateProfile(sexpr: SExpr): Profile {
	const record = alistToRecord(sexpr);

	// helper to get value or null
	const get = <T>(key: string, transform?: (v: SExpr) => T): T | null => {
		const val = record[key];
		if (val === undefined || val === null) return null;
		if (transform) return transform(val);
		return val as T;
	};

	const getNum = (key: string): number | null => {
		const val = record[key];
		if (val === undefined || val === null) return null;
		return typeof val === "number" ? val : null;
	};

	const getStr = (key: string): string | null => {
		const val = record[key];
		if (val === undefined || val === null) return null;
		return typeof val === "string" ? val : String(val);
	};

	const getBool = (key: string): boolean | null => {
		const val = record[key];
		if (val === undefined || val === null) return null;
		if (val === "t") return true;
		return false;
	};

	const getNumArray = (key: string): number[] | null => {
		const val = record[key];
		if (!Array.isArray(val)) return null;
		return val.map((v) => Number(v));
	};

	const profile: Profile = {
		id: getStr("id"),
		name: getStr("name"),
		created: getNum("created") ?? Math.floor(Date.now() / 1000),
		auth: getNum("auth") ?? 0,
		member: getBool("member"),
		submitted: getNumArray("submitted"),
		votes: null, // votes are stored separately per-user
		karma: getNum("karma") ?? 1,
		avg: getNum("avg"),
		weight: getNum("weight") ?? 0.5,
		ignore: getBool("ignore"),
		email: getStr("email"),
		about: getStr("about"),
		showdead: getBool("showdead"),
		noprocrast: getBool("noprocrast"),
		firstview: getNum("firstview"),
		lastview: getNum("lastview"),
		maxvisit: getNum("maxvisit") ?? 20,
		minaway: getNum("minaway") ?? 180,
		topcolor: getStr("topcolor"),
		keys: null,
		delay: getNum("delay") ?? 0,
	};

	return ProfileSchema.parse(profile);
}

/**
 * extract user votes from a profile
 * anarki format: ((time id user domain dir) ...)
 */
export function extractUserVotes(sexpr: SExpr): UserVotesTable {
	const record = alistToRecord(sexpr);
	const votes = record["votes"];

	if (!Array.isArray(votes)) {
		return {};
	}

	const userVotes: UserVotesTable = {};

	for (const vote of votes) {
		if (Array.isArray(vote) && vote.length >= 5) {
			const time = Number(vote[0]);
			const id = String(vote[1]);
			// vote[2] is user who submitted (not relevant here)
			// vote[3] is domain (not relevant here)
			const dir = String(vote[4]) as "up" | "down";

			if (dir === "up" || dir === "down") {
				userVotes[id] = { dir, time };
			}
		}
	}

	return UserVotesTableSchema.parse(userVotes);
}

/**
 * migrate an item (story or comment) from anarki format
 * format: ((id 1) (type story) (by "user") (title "...") ...)
 */
export function migrateItem(sexpr: SExpr): Item {
	const record = alistToRecord(sexpr);

	const get = <T>(key: string): T | null => {
		const val = record[key];
		if (val === undefined || val === null) return null;
		return val as T;
	};

	const getNum = (key: string): number | null => {
		const val = record[key];
		if (val === undefined || val === null) return null;
		return typeof val === "number" ? val : null;
	};

	const getStr = (key: string): string | null => {
		const val = record[key];
		if (val === undefined || val === null) return null;
		return typeof val === "string" ? val : String(val);
	};

	const getBool = (key: string): boolean | null => {
		const val = record[key];
		if (val === undefined || val === null) return null;
		if (val === "t") return true;
		return false;
	};

	const getNumArray = (key: string): number[] | null => {
		const val = record[key];
		if (!Array.isArray(val)) return null;
		return val.map((v) => Number(v));
	};

	// extract votes array
	// anarki format: ((time ip user dir score) ...)
	const votesRaw = record["votes"];
	let votes: ItemVote[] | null = null;
	if (Array.isArray(votesRaw)) {
		votes = votesRaw
			.filter((v) => Array.isArray(v) && v.length >= 4)
			.map((v) => {
				const arr = v as SExpr[];
				const dir = String(arr[3]);
				return {
					time: Number(arr[0]),
					ip: String(arr[1]),
					user: String(arr[2]),
					dir: (dir === "up" || dir === "down" ? dir : "up") as
						| "up"
						| "down",
					score: arr.length >= 5 ? Number(arr[4]) : 0,
				};
			});
	}

	const itemType = getStr("type");
	if (
		itemType !== "story" && itemType !== "comment" && itemType !== "poll" &&
		itemType !== "pollopt"
	) {
		throw new Error(`unknown item type: ${itemType}`);
	}

	const item: Item = {
		id: getNum("id"),
		type: itemType,
		by: getStr("by"),
		ip: getStr("ip") ?? "0.0.0.0",
		time: getNum("time") ?? Math.floor(Date.now() / 1000),
		url: getStr("url"),
		title: getStr("title"),
		text: getStr("text"),
		votes: votes,
		score: getNum("score") ?? 1,
		sockvotes: getNum("sockvotes") ?? 0,
		flags: null, // would need to parse from anarki format if present
		dead: getBool("dead"),
		deleted: getBool("deleted"),
		parts: getNumArray("parts"),
		parent: getNum("parent"),
		kids: getNumArray("kids"),
		keys: null,
	};

	return ItemSchema.parse(item);
}

/**
 * migrate banned sites from anarki format
 * format: (("site.com" kill) ("other.com" ignore))
 */
export function migrateBannedSites(
	sexpr: SExpr,
): z.infer<typeof BannedSitesTableSchema> {
	if (!Array.isArray(sexpr)) {
		return {};
	}

	const banned: z.infer<typeof BannedSitesTableSchema> = {};
	const now = Math.floor(Date.now() / 1000);

	for (const entry of sexpr) {
		if (Array.isArray(entry) && entry.length >= 2) {
			const site = String(entry[0]);
			const ban = String(entry[1]);

			if (ban === "kill" || ban === "ignore") {
				banned[site] = {
					ban,
					user: "migration",
					time: now,
					info: null,
				};
			}
		}
	}

	return BannedSitesTableSchema.parse(banned);
}

/**
 * migrate banned ips from anarki format
 * format: (("1.2.3.4") ("5.6.7.8"))
 */
export function migrateBannedIps(
	sexpr: SExpr,
): z.infer<typeof BannedIpsTableSchema> {
	if (!Array.isArray(sexpr)) {
		return {};
	}

	const banned: z.infer<typeof BannedIpsTableSchema> = {};
	const now = Math.floor(Date.now() / 1000);

	for (const entry of sexpr) {
		if (Array.isArray(entry) && entry.length >= 1) {
			const ip = String(Array.isArray(entry) ? entry[0] : entry);

			banned[ip] = {
				user: "migration",
				time: now,
				info: null,
			};
		}
	}

	return BannedIpsTableSchema.parse(banned);
}

// =============================================================================
// File operations
// =============================================================================

/**
 * read and parse an s-expression file
 */
export async function readSExprFile(path: string): Promise<SExpr> {
	try {
		const content = await Deno.readTextFile(path);
		return parseSExpr(content);
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) {
			return null;
		}
		throw error;
	}
}

/**
 * list files in a directory
 */
export async function listFiles(dir: string): Promise<string[]> {
	const files: string[] = [];
	try {
		for await (const entry of Deno.readDir(dir)) {
			if (entry.isFile) {
				files.push(entry.name);
			}
		}
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) {
			return [];
		}
		throw error;
	}
	return files;
}

// =============================================================================
// Main migration
// =============================================================================

export interface MigrationResult {
	passwords: number;
	sessions: number;
	profiles: number;
	items: number;
	userVotes: number;
	bannedSites: number;
	bannedIps: number;
	errors: string[];
}

/**
 * run full migration from anarki www directory to wizard data directory
 */
export async function migrate(
	wwwDir: string,
	config: StorageConfig,
): Promise<MigrationResult> {
	const result: MigrationResult = {
		passwords: 0,
		sessions: 0,
		profiles: 0,
		items: 0,
		userVotes: 0,
		bannedSites: 0,
		bannedIps: 0,
		errors: [],
	};

	// ensure output directories exist
	await ensureStorageDirs(config);

	// migrate passwords
	try {
		const hpwPath = `${wwwDir}/hpw`;
		const hpwSexpr = await readSExprFile(hpwPath);
		if (hpwSexpr) {
			const passwords = migratePasswords(hpwSexpr);
			await savePasswords(config, passwords);
			result.passwords = Object.keys(passwords).length;
			console.log(`migrated ${result.passwords} passwords`);
		}
	} catch (error) {
		result.errors.push(`passwords: ${error}`);
	}

	// migrate sessions
	try {
		const cooksPath = `${wwwDir}/cooks`;
		const cooksSexpr = await readSExprFile(cooksPath);
		if (cooksSexpr) {
			const sessions = migrateSessions(cooksSexpr);
			await saveSessions(config, sessions);
			result.sessions = Object.keys(sessions).length;
			console.log(`migrated ${result.sessions} sessions`);
		}
	} catch (error) {
		result.errors.push(`sessions: ${error}`);
	}

	// migrate banned sites
	try {
		const badsitesPath = `${wwwDir}/badsites`;
		const badsitesSexpr = await readSExprFile(badsitesPath);
		if (badsitesSexpr) {
			const bannedSites = migrateBannedSites(badsitesSexpr);
			await saveBannedSites(config, bannedSites);
			result.bannedSites = Object.keys(bannedSites).length;
			console.log(`migrated ${result.bannedSites} banned sites`);
		}
	} catch (error) {
		result.errors.push(`banned sites: ${error}`);
	}

	// migrate banned ips
	try {
		const badipsPath = `${wwwDir}/badips`;
		const badipsSexpr = await readSExprFile(badipsPath);
		if (badipsSexpr) {
			const bannedIps = migrateBannedIps(badipsSexpr);
			await saveBannedIps(config, bannedIps);
			result.bannedIps = Object.keys(bannedIps).length;
			console.log(`migrated ${result.bannedIps} banned ips`);
		}
	} catch (error) {
		result.errors.push(`banned ips: ${error}`);
	}

	// migrate profiles
	try {
		const profileDir = `${wwwDir}/profile`;
		const profileFiles = await listFiles(profileDir);
		for (const file of profileFiles) {
			try {
				const sexpr = await readSExprFile(`${profileDir}/${file}`);
				if (sexpr) {
					const profile = migrateProfile(sexpr);
					await saveProfile(config, profile);

					// extract and save user votes
					const votes = extractUserVotes(sexpr);
					if (Object.keys(votes).length > 0 && profile.id) {
						await saveUserVotes(config, profile.id, votes);
						result.userVotes += Object.keys(votes).length;
					}

					result.profiles++;
				}
			} catch (error) {
				result.errors.push(`profile ${file}: ${error}`);
			}
		}
		console.log(
			`migrated ${result.profiles} profiles, ${result.userVotes} votes`,
		);
	} catch (error) {
		result.errors.push(`profiles: ${error}`);
	}

	// migrate items (stories and comments)
	try {
		const storyDir = `${wwwDir}/story`;
		const storyFiles = await listFiles(storyDir);
		for (const file of storyFiles) {
			try {
				const sexpr = await readSExprFile(`${storyDir}/${file}`);
				if (sexpr) {
					const item = migrateItem(sexpr);
					await saveItem(config, item);
					result.items++;
				}
			} catch (error) {
				result.errors.push(`item ${file}: ${error}`);
			}
		}
		console.log(`migrated ${result.items} items`);
	} catch (error) {
		result.errors.push(`items: ${error}`);
	}

	return result;
}

// =============================================================================
// CLI
// =============================================================================

if (import.meta.main) {
	const args = Deno.args;

	if (args.length < 2) {
		console.log(
			"usage: deno run --allow-read --allow-write src/migrate.ts <www-dir> <data-dir>",
		);
		console.log("");
		console.log("migrate anarki news data to wizard format");
		console.log("");
		console.log("arguments:");
		console.log("  www-dir   path to anarki www directory (e.g., ./www)");
		console.log("  data-dir  path to output data directory (e.g., ./data)");
		Deno.exit(1);
	}

	const [wwwDir, dataDir] = args;
	const config = createStorageConfig(dataDir);

	console.log(`migrating from ${wwwDir} to ${dataDir}`);
	console.log("");

	const result = await migrate(wwwDir, config);

	console.log("");
	console.log("migration complete:");
	console.log(`  passwords: ${result.passwords}`);
	console.log(`  sessions: ${result.sessions}`);
	console.log(`  profiles: ${result.profiles}`);
	console.log(`  items: ${result.items}`);
	console.log(`  user votes: ${result.userVotes}`);
	console.log(`  banned sites: ${result.bannedSites}`);
	console.log(`  banned ips: ${result.bannedIps}`);

	if (result.errors.length > 0) {
		console.log("");
		console.log(`errors (${result.errors.length}):`);
		for (const err of result.errors) {
			console.log(`  - ${err}`);
		}
		Deno.exit(1);
	}
}

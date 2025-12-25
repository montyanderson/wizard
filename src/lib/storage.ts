/**
 * storage layer for arc news clone
 *
 * based on arc3.2/news.arc load/save functions (lines 71-235)
 * and arc3.2/arc.arc temload/temsave/load-table/save-table (lines 1067-1082, 1245-1263)
 *
 * uses json files instead of arc s-expressions
 */

import { z } from "@zod/zod";
import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import {
	type BannedIpsTable,
	BannedIpsTableSchema,
	type BannedSitesTable,
	BannedSitesTableSchema,
	type Item,
	ItemSchema,
	type LightweightsTable,
	LightweightsTableSchema,
	type PasswordTable,
	PasswordTableSchema,
	type Profile,
	ProfileSchema,
	type ScrubRules,
	ScrubRulesSchema,
	type SessionsTable,
	SessionsTableSchema,
	type UserVotesTable,
	UserVotesTableSchema,
} from "./schemas.ts";

/**
 * arc: newsdir*  "arc/news/"
 *      storydir* "arc/news/story/"
 *      profdir*  "arc/news/profile/"
 *      votedir*  "arc/news/vote/"
 */
export interface StorageConfig {
	dataDir: string;
	newsDir: string;
	storyDir: string;
	profileDir: string;
	voteDir: string;
}

export function createStorageConfig(baseDir: string = "data"): StorageConfig {
	return {
		dataDir: baseDir,
		newsDir: join(baseDir, "news"),
		storyDir: join(baseDir, "news", "story"),
		profileDir: join(baseDir, "news", "profile"),
		voteDir: join(baseDir, "news", "vote"),
	};
}

/**
 * arc: (map ensure-dir (list arcdir* newsdir* storydir* votedir* profdir*))
 */
export async function ensureStorageDirs(config: StorageConfig): Promise<void> {
	await ensureDir(config.dataDir);
	await ensureDir(config.newsDir);
	await ensureDir(config.storyDir);
	await ensureDir(config.profileDir);
	await ensureDir(config.voteDir);
}

/**
 * generic json file loader with zod validation
 *
 * arc: (def load-table (file (o eof))
 *        (w/infile i file (read-table i eof)))
 */
export async function loadJson<T>(
	path: string,
	schema: z.ZodType<T>,
): Promise<T | null> {
	try {
		const text = await Deno.readTextFile(path);
		const data = JSON.parse(text);
		return schema.parse(data);
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) {
			return null;
		}
		throw error;
	}
}

/**
 * generic json file saver with zod validation
 *
 * arc: (def save-table (h file)
 *        (writefile (tablist h) file))
 */
export async function saveJson<T>(
	path: string,
	data: T,
	schema: z.ZodType<T>,
): Promise<void> {
	// validate before saving
	schema.parse(data);
	await ensureDir(dirname(path));
	const text = JSON.stringify(data, null, "\t");
	await Deno.writeTextFile(path, text);
}

/**
 * check if file exists
 *
 * arc: (file-exists (+ profdir* u))
 */
export async function fileExists(path: string): Promise<boolean> {
	try {
		await Deno.stat(path);
		return true;
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) {
			return false;
		}
		throw error;
	}
}

/**
 * list files in directory
 *
 * arc: (dir storydir*)
 */
export async function listDir(path: string): Promise<string[]> {
	const entries: string[] = [];
	try {
		for await (const entry of Deno.readDir(path)) {
			if (entry.isFile && entry.name.endsWith(".json")) {
				// strip .json extension to get the id/name
				entries.push(entry.name.slice(0, -5));
			}
		}
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) {
			return [];
		}
		throw error;
	}
	return entries;
}

// =============================================================================
// Item storage
// =============================================================================

/**
 * arc: (def load-item (id)
 *        (let i (temload 'item (+ storydir* id))
 *          (= (items* id) i)
 *          (awhen (and (astory&live i) (check i!url ~blank))
 *            (register-url i it))
 *          i))
 */
export async function loadItem(
	config: StorageConfig,
	id: number,
): Promise<Item | null> {
	const path = join(config.storyDir, `${id}.json`);
	return loadJson(path, ItemSchema);
}

/**
 * arc: (def save-item (i) (save-table i (+ storydir* i!id)))
 */
export async function saveItem(
	config: StorageConfig,
	item: Item,
): Promise<void> {
	if (item.id === null) {
		throw new Error("Cannot save item without id");
	}
	const path = join(config.storyDir, `${item.id}.json`);
	await saveJson(path, item, ItemSchema);
}

/**
 * get all item ids from storage, sorted descending (newest first)
 *
 * arc: (with (items (table)
 *            ids   (sort > (map int (dir storydir*))))
 */
export async function listItemIds(config: StorageConfig): Promise<number[]> {
	const names = await listDir(config.storyDir);
	const ids = names.map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
	return ids.sort((a, b) => b - a);
}

// =============================================================================
// Profile storage
// =============================================================================

/**
 * arc: (def profile (u)
 *        (or (profs* u)
 *            (aand (goodname u)
 *                  (file-exists (+ profdir* u))
 *                  (= (profs* u) (temload 'profile it)))))
 */
export async function loadProfile(
	config: StorageConfig,
	username: string,
): Promise<Profile | null> {
	const path = join(config.profileDir, `${username}.json`);
	return loadJson(path, ProfileSchema);
}

/**
 * arc: (def save-prof (u) (save-table (profs* u) (+ profdir* u)))
 */
export async function saveProfile(
	config: StorageConfig,
	profile: Profile,
): Promise<void> {
	if (!profile.id) {
		throw new Error("Cannot save profile without id");
	}
	const path = join(config.profileDir, `${profile.id}.json`);
	await saveJson(path, profile, ProfileSchema);
}

/**
 * list all profile usernames
 */
export async function listProfileIds(config: StorageConfig): Promise<string[]> {
	return listDir(config.profileDir);
}

// =============================================================================
// User votes storage
// =============================================================================

/**
 * arc: (def votes (u)
 *        (or (votes* u)
 *            (aand (file-exists (+ votedir* u))
 *                  (= (votes* u) (load-table it)))))
 */
export async function loadUserVotes(
	config: StorageConfig,
	username: string,
): Promise<UserVotesTable | null> {
	const path = join(config.voteDir, `${username}.json`);
	return loadJson(path, UserVotesTableSchema);
}

/**
 * arc: (def save-votes (u) (save-table (votes* u) (+ votedir* u)))
 */
export async function saveUserVotes(
	config: StorageConfig,
	username: string,
	votes: UserVotesTable,
): Promise<void> {
	const path = join(config.voteDir, `${username}.json`);
	await saveJson(path, votes, UserVotesTableSchema);
}

// =============================================================================
// Global tables storage
// =============================================================================

/**
 * load banned sites table
 */
export async function loadBannedSites(
	config: StorageConfig,
): Promise<BannedSitesTable> {
	const path = join(config.newsDir, "banned-sites.json");
	return (await loadJson(path, BannedSitesTableSchema)) ?? {};
}

/**
 * save banned sites table
 */
export async function saveBannedSites(
	config: StorageConfig,
	sites: BannedSitesTable,
): Promise<void> {
	const path = join(config.newsDir, "banned-sites.json");
	await saveJson(path, sites, BannedSitesTableSchema);
}

/**
 * load banned ips table
 */
export async function loadBannedIps(
	config: StorageConfig,
): Promise<BannedIpsTable> {
	const path = join(config.newsDir, "banned-ips.json");
	return (await loadJson(path, BannedIpsTableSchema)) ?? {};
}

/**
 * save banned ips table
 */
export async function saveBannedIps(
	config: StorageConfig,
	ips: BannedIpsTable,
): Promise<void> {
	const path = join(config.newsDir, "banned-ips.json");
	await saveJson(path, ips, BannedIpsTableSchema);
}

/**
 * load lightweights table
 */
export async function loadLightweights(
	config: StorageConfig,
): Promise<LightweightsTable> {
	const path = join(config.newsDir, "lightweights.json");
	return (await loadJson(path, LightweightsTableSchema)) ?? {};
}

/**
 * save lightweights table
 */
export async function saveLightweights(
	config: StorageConfig,
	lightweights: LightweightsTable,
): Promise<void> {
	const path = join(config.newsDir, "lightweights.json");
	await saveJson(path, lightweights, LightweightsTableSchema);
}

/**
 * load scrub rules
 */
export async function loadScrubRules(
	config: StorageConfig,
): Promise<ScrubRules> {
	const path = join(config.newsDir, "scrubrules.json");
	return (await loadJson(path, ScrubRulesSchema)) ?? [];
}

/**
 * save scrub rules
 */
export async function saveScrubRules(
	config: StorageConfig,
	rules: ScrubRules,
): Promise<void> {
	const path = join(config.newsDir, "scrubrules.json");
	await saveJson(path, rules, ScrubRulesSchema);
}

/**
 * load passwords table
 */
export async function loadPasswords(
	config: StorageConfig,
): Promise<PasswordTable> {
	const path = join(config.dataDir, "hpw.json");
	return (await loadJson(path, PasswordTableSchema)) ?? {};
}

/**
 * save passwords table
 */
export async function savePasswords(
	config: StorageConfig,
	passwords: PasswordTable,
): Promise<void> {
	const path = join(config.dataDir, "hpw.json");
	await saveJson(path, passwords, PasswordTableSchema);
}

/**
 * load sessions table
 */
export async function loadSessions(
	config: StorageConfig,
): Promise<SessionsTable> {
	const path = join(config.dataDir, "cooks.json");
	return (await loadJson(path, SessionsTableSchema)) ?? {};
}

/**
 * save sessions table
 */
export async function saveSessions(
	config: StorageConfig,
	sessions: SessionsTable,
): Promise<void> {
	const path = join(config.dataDir, "cooks.json");
	await saveJson(path, sessions, SessionsTableSchema);
}

/**
 * load admins list
 *
 * arc: admins file is whitespace-separated usernames
 */
export async function loadAdmins(config: StorageConfig): Promise<string[]> {
	const path = join(config.dataDir, "admins.json");
	const schema = z.array(z.string());
	return (await loadJson(path, schema)) ?? [];
}

/**
 * save admins list
 */
export async function saveAdmins(
	config: StorageConfig,
	admins: string[],
): Promise<void> {
	const path = join(config.dataDir, "admins.json");
	const schema = z.array(z.string());
	await saveJson(path, admins, schema);
}

/**
 * load top stories list
 *
 * arc: (aif (errsafe (readfile1 (+ newsdir* "topstories")))
 *           (= ranked-stories* (map item it))
 */
export async function loadTopStories(config: StorageConfig): Promise<number[]> {
	const path = join(config.newsDir, "topstories.json");
	const schema = z.array(z.number());
	return (await loadJson(path, schema)) ?? [];
}

/**
 * save top stories list
 */
export async function saveTopStories(
	config: StorageConfig,
	ids: number[],
): Promise<void> {
	const path = join(config.newsDir, "topstories.json");
	const schema = z.array(z.number());
	await saveJson(path, ids, schema);
}

/**
 * get next item id
 *
 * arc: (def new-item-id ()
 *        (evtil (++ maxid*) [~file-exists (+ storydir* _)]))
 */
export async function getNextItemId(config: StorageConfig): Promise<number> {
	const ids = await listItemIds(config);
	const maxId = ids.length > 0 ? ids[0] : 0;
	let nextId = maxId + 1;

	// ensure the id doesn't exist (shouldn't happen, but matches arc behaviour)
	while (await fileExists(join(config.storyDir, `${nextId}.json`))) {
		nextId++;
	}

	return nextId;
}

/**
 * html templating for arc news clone
 *
 * based on arc3.2/html.arc and arc3.2/news.arc
 */

// =============================================================================
// Escaping
// =============================================================================

/**
 * escape html entities
 *
 * arc: (def eschtml (str) ...)
 */
export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&#38;")
		.replace(/</g, "&#60;")
		.replace(/>/g, "&#62;")
		.replace(/"/g, "&#34;")
		.replace(/'/g, "&#39;");
}

/**
 * escape only angle brackets and ampersands
 *
 * arc: (def esc-tags (str) ...)
 */
export function escapeTags(str: string): string {
	return str
		.replace(/&/g, "&#38;")
		.replace(/</g, "&#60;")
		.replace(/>/g, "&#62;");
}

/**
 * strip html tags from string
 *
 * arc: (def striptags (s) ...)
 */
export function stripTags(s: string): string {
	let inTag = false;
	let result = "";
	for (const c of s) {
		if (c === "<") {
			inTag = true;
		} else if (c === ">") {
			inTag = false;
		} else if (!inTag) {
			result += c;
		}
	}
	return result;
}

/**
 * clean dangerous characters from url
 *
 * arc: (def clean-url (u) (rem [in _ #\" #\' #\< #\>] u))
 */
export function cleanUrl(url: string): string {
	return url.replace(/['"<>]/g, "");
}

/**
 * validate url format
 *
 * arc: (defmemo valid-url (url)
 *        (and (len> url 10)
 *             (or (begins url "http://")
 *                 (begins url "https://"))
 *             (~find [in _ #\< #\> #\" #\'] url)))
 */
export function isValidUrl(url: string): boolean {
	if (url.length <= 10) return false;
	if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
	if (/[<>"']/.test(url)) return false;
	return true;
}

// =============================================================================
// Colours
// =============================================================================

export interface Colour {
	r: number;
	g: number;
	b: number;
}

/**
 * create a colour
 *
 * arc: (def color (r g b) ...)
 */
export function colour(r: number, g: number, b: number): Colour {
	const clamp = (x: number) => (x < 0 ? 0 : x > 255 ? 255 : x);
	return { r: clamp(r), g: clamp(g), b: clamp(b) };
}

/**
 * create a grey colour
 *
 * arc: (defmemo gray (n) (color n n n))
 */
export function grey(n: number): Colour {
	return colour(n, n, n);
}

/**
 * convert colour to hex string
 *
 * arc: (defmemo hexrep (col) ...)
 */
export function hexRep(col: Colour): string {
	const hex = (n: number) => n.toString(16).padStart(2, "0");
	return hex(col.r) + hex(col.g) + hex(col.b);
}

/**
 * parse hex string to colour
 *
 * arc: (defmemo hex>color (str) ...)
 */
export function hexToColour(str: string): Colour | null {
	if (str.length !== 6) return null;
	const r = parseInt(str.slice(0, 2), 16);
	const g = parseInt(str.slice(2, 4), 16);
	const b = parseInt(str.slice(4, 6), 16);
	if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
	return colour(r, g, b);
}

// standard colours
export const white = grey(255);
export const black = grey(0);
export const linkBlue = colour(0, 0, 190);
export const orange = colour(255, 102, 0);
export const darkRed = colour(180, 0, 0);
export const darkBlue = colour(0, 0, 120);
export const sand = colour(246, 246, 239);
export const textGrey = grey(130);
export const noobColour = colour(60, 150, 60);

// =============================================================================
// Basic HTML Tags
// =============================================================================

/**
 * html builder class for constructing html documents
 */
export class HtmlBuilder {
	private parts: string[] = [];

	/**
	 * append raw html
	 */
	pr(...args: (string | number)[]): this {
		this.parts.push(args.join(""));
		return this;
	}

	/**
	 * append html with newline
	 */
	prn(...args: (string | number)[]): this {
		this.parts.push(args.join("") + "\n");
		return this;
	}

	/**
	 * append escaped text
	 */
	text(s: string): this {
		this.parts.push(escapeHtml(s));
		return this;
	}

	/**
	 * get the built html
	 */
	toString(): string {
		return this.parts.join("");
	}
}

/**
 * create an attribute string
 */
function attr(
	name: string,
	value: string | number | boolean | undefined,
): string {
	if (value === undefined || value === false) return "";
	if (value === true) return ` ${name}`;
	return ` ${name}="${escapeHtml(String(value))}"`;
}

/**
 * create an attribute string for colour
 */
function colourAttr(name: string, value: Colour | undefined): string {
	if (!value) return "";
	return ` ${name}=#${hexRep(value)}`;
}

// =============================================================================
// Tag Functions
// =============================================================================

/**
 * create an opening tag with attributes
 */
export function openTag(
	tag: string,
	attrs: Record<string, string | number | boolean | Colour | undefined> = {},
): string {
	let result = `<${tag}`;
	for (const [key, value] of Object.entries(attrs)) {
		if (value === undefined || value === false) continue;
		if (typeof value === "object" && "r" in value) {
			result += colourAttr(key, value);
		} else if (value === true) {
			result += ` ${key}`;
		} else {
			result += ` ${key}="${escapeHtml(String(value))}"`;
		}
	}
	result += ">";
	return result;
}

/**
 * create a closing tag
 */
export function closeTag(tag: string): string {
	return `</${tag}>`;
}

/**
 * create a self-closing tag
 *
 * arc: (mac gentag args (start-tag args))
 */
export function genTag(
	tag: string,
	attrs: Record<string, string | number | boolean | Colour | undefined> = {},
): string {
	let result = `<${tag}`;
	for (const [key, value] of Object.entries(attrs)) {
		if (value === undefined || value === false) continue;
		if (typeof value === "object" && "r" in value) {
			result += colourAttr(key, value);
		} else if (value === true) {
			result += ` ${key}`;
		} else {
			result += ` ${key}="${escapeHtml(String(value))}"`;
		}
	}
	result += ">";
	return result;
}

/**
 * wrap content in a tag
 *
 * arc: (mac tag (spec . body) ...)
 */
export function tag(
	tagName: string,
	attrs: Record<string, string | number | boolean | Colour | undefined>,
	content: string,
): string {
	return openTag(tagName, attrs) + content + closeTag(tagName);
}

// =============================================================================
// Common HTML Elements
// =============================================================================

/**
 * line break
 *
 * arc: (def br ((o n 1)) (repeat n (pr "<br>")) (prn))
 */
export function br(n: number = 1): string {
	return "<br>".repeat(n) + "\n";
}

/**
 * double line break
 *
 * arc: (def br2 () (prn "<br><br>"))
 */
export function br2(): string {
	return "<br><br>\n";
}

/**
 * non-breaking space
 *
 * arc: (def nbsp () (pr "&nbsp;"))
 */
export function nbsp(): string {
	return "&nbsp;";
}

/**
 * horizontal space using image
 *
 * arc: (def hspace (n) (gentag img src (blank-url) height 1 width n))
 */
export function hspace(n: number): string {
	return genTag("img", { src: "s.gif", height: 1, width: n });
}

/**
 * vertical space using image
 *
 * arc: (def vspace (n) (gentag img src (blank-url) height n width 0))
 */
export function vspace(n: number): string {
	return genTag("img", { src: "s.gif", height: n, width: 0 });
}

/**
 * vertical and horizontal space using image
 *
 * arc: (def vhspace (h w) (gentag img src (blank-url) height h width w))
 */
export function vhspace(h: number, w: number): string {
	return genTag("img", { src: "s.gif", height: h, width: w });
}

/**
 * space row in table
 *
 * arc: (def spacerow (h) (pr "<tr style=\"height:" h "px\"></tr>"))
 */
export function spaceRow(h: number): string {
	return `<tr style="height:${h}px"></tr>`;
}

/**
 * paragraph tag
 *
 * arc: (def para args (gentag p) (when args (apply pr args)))
 */
export function para(...args: string[]): string {
	return "<p>" + args.join("") + "</p>";
}

/**
 * bold text
 *
 * arc: (mac prbold body `(tag b (pr ,@body)))
 */
export function bold(content: string): string {
	return tag("b", {}, content);
}

/**
 * create a link
 *
 * arc: (def link (text (o dest text) (o color)) ...)
 */
export function link(
	text: string,
	dest?: string,
	colour?: Colour,
): string {
	const href = dest ?? text;
	const content = colour
		? tag("font", { color: colour }, escapeHtml(text))
		: escapeHtml(text);
	return tag("a", { href }, content);
}

/**
 * create an underlined link
 *
 * arc: (def underlink (text (o dest text)) (tag (a href dest) (tag u (pr text))))
 */
export function underlink(text: string, dest?: string): string {
	return tag("a", { href: dest ?? text }, tag("u", {}, escapeHtml(text)));
}

// =============================================================================
// Tables
// =============================================================================

/**
 * table tag
 *
 * arc: (mac tab body `(tag (table border 0) ,@body))
 */
export function table(
	content: string,
	attrs: Record<string, string | number | boolean | Colour | undefined> = {},
): string {
	return tag("table", { border: 0, ...attrs }, content);
}

/**
 * zero-padding table
 *
 * arc: (mac zerotable body
 *        `(tag (table border 0 cellpadding 0 cellspacing 0) ,@body))
 */
export function zeroTable(content: string): string {
	return tag("table", { border: 0, cellpadding: 0, cellspacing: 0 }, content);
}

/**
 * spaced table
 *
 * arc: (mac sptab body
 *        `(tag (table style "border-spacing: 7px 0px;") ,@body))
 */
export function spTab(content: string): string {
	return tag("table", { style: "border-spacing: 7px 0px;" }, content);
}

/**
 * table row
 *
 * arc: (mac tr body `(tag tr ,@body))
 */
export function tr(
	content: string,
	attrs: Record<string, string | number | boolean | Colour | undefined> = {},
): string {
	return tag("tr", attrs, content);
}

/**
 * table cell
 *
 * arc: (mac td body `(tag td ,@(pratoms body)))
 */
export function td(
	content: string,
	attrs: Record<string, string | number | boolean | Colour | undefined> = {},
): string {
	return tag("td", attrs, content);
}

/**
 * table row with single cell
 *
 * arc: (mac trtd body `(tr (td ,@(pratoms body))))
 */
export function trtd(content: string): string {
	return tr(td(content));
}

/**
 * right-aligned table cell
 *
 * arc: (mac tdr body `(tag (td align 'right) ,@(pratoms body)))
 */
export function tdr(content: string): string {
	return td(content, { align: "right" });
}

/**
 * coloured table cell
 *
 * arc: (mac tdcolor (col . body) `(tag (td bgcolor ,col) ,@(pratoms body)))
 */
export function tdColour(colour: Colour, content: string): string {
	return td(content, { bgcolor: colour });
}

/**
 * spanning row
 *
 * arc: (mac spanrow (n . body) `(tr (tag (td colspan ,n) ,@body)))
 */
export function spanRow(n: number, content: string): string {
	return tr(td(content, { colspan: n }));
}

/**
 * simple row of cells
 *
 * arc: (mac row args `(tr ,@(map [list 'td _] args)))
 */
export function row(...cells: string[]): string {
	return tr(cells.map((c) => td(c)).join(""));
}

// =============================================================================
// Forms
// =============================================================================

/**
 * form tag
 *
 * arc: (mac form (action . body) `(tag (form method "post" action ,action) ,@body))
 */
export function form(action: string, content: string): string {
	return tag("form", { method: "post", action }, content);
}

/**
 * text input
 *
 * arc: (def input (name (o val "") (o size 10))
 *        (gentag input type 'text name name value val size size))
 */
export function input(
	name: string,
	value: string = "",
	size: number = 10,
): string {
	return genTag("input", { type: "text", name, value, size });
}

/**
 * password input
 */
export function passwordInput(
	name: string,
	size: number = 10,
): string {
	return genTag("input", { type: "password", name, size });
}

/**
 * hidden input
 */
export function hiddenInput(name: string, value: string): string {
	return genTag("input", { type: "hidden", name, value });
}

/**
 * textarea
 *
 * arc: (mac textarea (name rows cols . body)
 *        `(tag (textarea name ,name rows ,rows cols ,cols wrap virtual) ,@body))
 */
export function textarea(
	name: string,
	rows: number,
	cols: number,
	content: string = "",
): string {
	return tag(
		"textarea",
		{ name, rows, cols, wrap: "virtual" },
		escapeHtml(content),
	);
}

/**
 * submit button
 *
 * arc: (def submit ((o val "submit")) (gentag input type 'submit value val))
 */
export function submit(value: string = "submit"): string {
	return genTag("input", { type: "submit", value });
}

/**
 * button
 *
 * arc: (def but ((o text "submit") (o name nil))
 *        (gentag input type 'submit name name value text))
 */
export function button(text: string = "submit", name?: string): string {
	return genTag("input", { type: "submit", name, value: text });
}

/**
 * select dropdown
 *
 * arc: (def menu (name items (o sel nil)) ...)
 */
export function menu(
	name: string,
	items: string[],
	selected?: string,
): string {
	const options = items.map((item) =>
		tag("option", { selected: item === selected }, escapeHtml(item))
	).join("");
	return tag("select", { name }, options);
}

// =============================================================================
// Spans and Divs
// =============================================================================

/**
 * span with class
 *
 * arc: (mac spanclass (name . body) `(tag (span class ',name) ,@body))
 */
export function spanClass(className: string, content: string): string {
	return tag("span", { class: className }, content);
}

/**
 * span with id
 */
export function spanId(id: string, content: string): string {
	return tag("span", { id }, content);
}

/**
 * centre content
 *
 * arc: (mac center body `(tag center ,@body))
 */
export function centre(content: string): string {
	return tag("center", {}, content);
}

/**
 * font colour
 *
 * arc: (mac fontcolor (c . body) ...)
 */
export function fontColour(col: Colour | undefined, content: string): string {
	if (!col) return content;
	return tag("font", { color: col }, content);
}

// =============================================================================
// Images
// =============================================================================

/**
 * image tag
 */
export function img(
	src: string,
	attrs: Record<string, string | number | boolean | undefined> = {},
): string {
	return genTag("img", { src, ...attrs });
}

// =============================================================================
// Text Formatting
// =============================================================================

/**
 * convert newlines to paragraphs
 *
 * arc: (def parafy (str) ...)
 */
export function parafy(str: string): string {
	let ink = false;
	let result = "";
	for (const c of str) {
		result += c;
		if (!/\s/.test(c)) ink = true;
		if (c === "\n") {
			if (!ink) result += "<p>";
			ink = false;
		}
	}
	return result;
}

/**
 * format time age
 *
 * arc: (def text-age (a) ...)
 */
export function textAge(minutes: number): string {
	if (minutes < 1) return "moments ago";
	if (minutes < 60) {
		const m = Math.floor(minutes);
		return `${m} minute${m === 1 ? "" : "s"} ago`;
	}
	if (minutes < 1440) {
		const h = Math.floor(minutes / 60);
		return `${h} hour${h === 1 ? "" : "s"} ago`;
	}
	const d = Math.floor(minutes / 1440);
	return `${d} day${d === 1 ? "" : "s"} ago`;
}

/**
 * pluralise a word
 *
 * arc: (def plural (n s) ...)
 */
export function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * join items with bars
 *
 * arc: (mac w/bars body ...)
 */
export function withBars(items: string[]): string {
	return items.filter((i) => i).join(" | ");
}

// =============================================================================
// Colour Stripe
// =============================================================================

/**
 * colour stripe for page sections
 *
 * arc: (def color-stripe (c) ...)
 */
export function colourStripe(col: Colour): string {
	return tag(
		"table",
		{ width: "100%", cellspacing: 0, cellpadding: 1 },
		tr(tdColour(col, "")),
	);
}

// =============================================================================
// Constants
// =============================================================================

/**
 * bar separator
 */
export const bar = " | ";

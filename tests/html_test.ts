/**
 * tests for html templating
 */

import { assertEquals } from "@std/assert";
import {
	bar,
	bold,
	br,
	br2,
	button,
	centre,
	cleanUrl,
	closeTag,
	colour,
	colourStripe,
	escapeHtml,
	escapeTags,
	fontColour,
	form,
	genTag,
	grey,
	hexRep,
	hexToColour,
	hiddenInput,
	hspace,
	HtmlBuilder,
	img,
	input,
	isValidUrl,
	link,
	menu,
	nbsp,
	openTag,
	orange,
	para,
	parafy,
	passwordInput,
	plural,
	row,
	sand,
	spaceRow,
	spanClass,
	spanId,
	spanRow,
	spTab,
	stripTags,
	submit,
	table,
	tag,
	td,
	tdColour,
	tdr,
	textAge,
	textarea,
	tr,
	trtd,
	underlink,
	vspace,
	white,
	withBars,
	zeroTable,
} from "../src/lib/html.ts";

// =============================================================================
// Escaping
// =============================================================================

Deno.test("escapeHtml - escapes all entities", () => {
	assertEquals(escapeHtml("<div>"), "&#60;div&#62;");
	assertEquals(escapeHtml('"test"'), "&#34;test&#34;");
	assertEquals(escapeHtml("'test'"), "&#39;test&#39;");
	assertEquals(escapeHtml("a & b"), "a &#38; b");
});

Deno.test("escapeTags - escapes only angle brackets and ampersand", () => {
	assertEquals(escapeTags("<div>"), "&#60;div&#62;");
	assertEquals(escapeTags("a & b"), "a &#38; b");
	assertEquals(escapeTags('"test"'), '"test"');
});

Deno.test("stripTags - removes html tags", () => {
	assertEquals(stripTags("<b>bold</b>"), "bold");
	assertEquals(stripTags("<a href='test'>link</a>"), "link");
	assertEquals(stripTags("no tags here"), "no tags here");
	assertEquals(stripTags("<p>para 1</p><p>para 2</p>"), "para 1para 2");
});

Deno.test("cleanUrl - removes dangerous characters", () => {
	assertEquals(cleanUrl("http://example.com"), "http://example.com");
	assertEquals(
		cleanUrl('http://evil.com/"onclick='),
		"http://evil.com/onclick=",
	);
	assertEquals(
		cleanUrl("http://evil.com/<script>"),
		"http://evil.com/script",
	);
});

Deno.test("isValidUrl - validates url format", () => {
	assertEquals(isValidUrl("http://example.com"), true);
	assertEquals(isValidUrl("https://example.com/path"), true);
	assertEquals(isValidUrl("ftp://example.com"), false);
	assertEquals(isValidUrl("http://a.b"), false); // too short
	assertEquals(isValidUrl('http://example.com/"'), false);
	assertEquals(isValidUrl("http://example.com/<"), false);
});

// =============================================================================
// Colours
// =============================================================================

Deno.test("colour - creates colour with clamping", () => {
	assertEquals(colour(100, 150, 200), { r: 100, g: 150, b: 200 });
	assertEquals(colour(-10, 300, 128), { r: 0, g: 255, b: 128 });
});

Deno.test("grey - creates grey colour", () => {
	assertEquals(grey(128), { r: 128, g: 128, b: 128 });
});

Deno.test("hexRep - converts colour to hex", () => {
	assertEquals(hexRep({ r: 255, g: 0, b: 128 }), "ff0080");
	assertEquals(hexRep({ r: 0, g: 0, b: 0 }), "000000");
});

Deno.test("hexToColour - parses hex string", () => {
	assertEquals(hexToColour("ff0080"), { r: 255, g: 0, b: 128 });
	assertEquals(hexToColour("invalid"), null);
	assertEquals(hexToColour("fff"), null);
	assertEquals(hexToColour("gggggg"), null); // invalid hex chars
	assertEquals(hexToColour("ff66"), null); // too short
});

Deno.test("predefined colours exist", () => {
	assertEquals(white, { r: 255, g: 255, b: 255 });
	assertEquals(sand, { r: 246, g: 246, b: 239 });
	assertEquals(orange, { r: 255, g: 102, b: 0 });
});

// =============================================================================
// Tags
// =============================================================================

Deno.test("openTag - creates opening tag", () => {
	assertEquals(openTag("div"), "<div>");
	assertEquals(openTag("a", { href: "/test" }), '<a href="/test">');
	assertEquals(openTag("input", { disabled: true }), "<input disabled>");
	assertEquals(openTag("input", { disabled: false }), "<input>");
});

Deno.test("closeTag - creates closing tag", () => {
	assertEquals(closeTag("div"), "</div>");
});

Deno.test("genTag - creates self-closing tag", () => {
	assertEquals(genTag("br"), "<br>");
	assertEquals(genTag("img", { src: "test.png" }), '<img src="test.png">');
});

Deno.test("tag - wraps content", () => {
	assertEquals(tag("div", {}, "content"), "<div>content</div>");
	assertEquals(
		tag("a", { href: "/test" }, "link"),
		'<a href="/test">link</a>',
	);
});

// =============================================================================
// Common Elements
// =============================================================================

Deno.test("br - creates line breaks", () => {
	assertEquals(br(), "<br>\n");
	assertEquals(br(3), "<br><br><br>\n");
});

Deno.test("br2 - creates double break", () => {
	assertEquals(br2(), "<br><br>\n");
});

Deno.test("nbsp - creates non-breaking space", () => {
	assertEquals(nbsp(), "&nbsp;");
});

Deno.test("hspace - creates horizontal space", () => {
	// arc: (def hspace (n) (gentag img src (blank-url) height 1 width n))
	assertEquals(hspace(10), '<img src="s.gif" height="1" width="10">');
});

Deno.test("vspace - creates vertical space", () => {
	assertEquals(vspace(10), '<img src="s.gif" height="10" width="0">');
});

Deno.test("spaceRow - creates space row", () => {
	assertEquals(spaceRow(10), '<tr style="height:10px"></tr>');
});

Deno.test("para - creates paragraph", () => {
	assertEquals(para("text"), "<p>text</p>");
	assertEquals(para("a", "b"), "<p>ab</p>");
});

Deno.test("bold - creates bold text", () => {
	assertEquals(bold("text"), "<b>text</b>");
});

Deno.test("link - creates anchor", () => {
	assertEquals(link("test"), '<a href="test">test</a>');
	assertEquals(link("test", "/path"), '<a href="/path">test</a>');
});

Deno.test("underlink - creates underlined link", () => {
	assertEquals(underlink("test"), '<a href="test"><u>test</u></a>');
	assertEquals(underlink("test", "/path"), '<a href="/path"><u>test</u></a>');
});

// =============================================================================
// Tables
// =============================================================================

Deno.test("table - creates table", () => {
	assertEquals(table("content"), '<table border="0">content</table>');
});

Deno.test("zeroTable - creates zero-padding table", () => {
	assertEquals(
		zeroTable("content"),
		'<table border="0" cellpadding="0" cellspacing="0">content</table>',
	);
});

Deno.test("spTab - creates spaced table", () => {
	assertEquals(
		spTab("content"),
		'<table style="border-spacing: 7px 0px;">content</table>',
	);
});

Deno.test("tr - creates table row", () => {
	assertEquals(tr("content"), "<tr>content</tr>");
});

Deno.test("td - creates table cell", () => {
	assertEquals(td("content"), "<td>content</td>");
	assertEquals(td("content", { colspan: 2 }), '<td colspan="2">content</td>');
});

Deno.test("trtd - creates row with cell", () => {
	assertEquals(trtd("content"), "<tr><td>content</td></tr>");
});

Deno.test("tdr - creates right-aligned cell", () => {
	assertEquals(tdr("content"), '<td align="right">content</td>');
});

Deno.test("tdColour - creates coloured cell", () => {
	const result = tdColour({ r: 255, g: 0, b: 0 }, "content");
	assertEquals(result, "<td bgcolor=#ff0000>content</td>");
});

Deno.test("spanRow - creates spanning row", () => {
	assertEquals(
		spanRow(3, "content"),
		'<tr><td colspan="3">content</td></tr>',
	);
});

Deno.test("row - creates row of cells", () => {
	assertEquals(row("a", "b", "c"), "<tr><td>a</td><td>b</td><td>c</td></tr>");
});

// =============================================================================
// Forms
// =============================================================================

Deno.test("form - creates form", () => {
	assertEquals(
		form("/submit", "content"),
		'<form method="post" action="/submit">content</form>',
	);
});

Deno.test("input - creates text input", () => {
	assertEquals(
		input("name"),
		'<input type="text" name="name" value="" size="10">',
	);
	assertEquals(
		input("name", "value", 20),
		'<input type="text" name="name" value="value" size="20">',
	);
});

Deno.test("passwordInput - creates password input", () => {
	assertEquals(
		passwordInput("pw"),
		'<input type="password" name="pw" size="10">',
	);
});

Deno.test("hiddenInput - creates hidden input", () => {
	assertEquals(
		hiddenInput("token", "abc"),
		'<input type="hidden" name="token" value="abc">',
	);
});

Deno.test("textarea - creates textarea with wrap attribute", () => {
	// arc: textarea includes wrap="virtual" attribute
	assertEquals(
		textarea("text", 5, 40),
		'<textarea name="text" rows="5" cols="40" wrap="virtual"></textarea>',
	);
	assertEquals(
		textarea("text", 5, 40, "content"),
		'<textarea name="text" rows="5" cols="40" wrap="virtual">content</textarea>',
	);
});

Deno.test("submit - creates submit button", () => {
	assertEquals(submit(), '<input type="submit" value="submit">');
	assertEquals(submit("Save"), '<input type="submit" value="Save">');
});

Deno.test("button - creates button", () => {
	assertEquals(button(), '<input type="submit" value="submit">');
	assertEquals(
		button("Save", "action"),
		'<input type="submit" name="action" value="Save">',
	);
});

Deno.test("menu - creates select dropdown", () => {
	const result = menu("choice", ["a", "b", "c"], "b");
	assertEquals(
		result,
		'<select name="choice"><option>a</option><option selected>b</option><option>c</option></select>',
	);
});

// =============================================================================
// Spans and Divs
// =============================================================================

Deno.test("spanClass - creates span with class", () => {
	assertEquals(spanClass("title", "text"), '<span class="title">text</span>');
});

Deno.test("spanId - creates span with id", () => {
	assertEquals(spanId("score_123", "5"), '<span id="score_123">5</span>');
});

Deno.test("centre - creates center tag", () => {
	assertEquals(centre("content"), "<center>content</center>");
});

Deno.test("fontColour - wraps in font tag", () => {
	const result = fontColour({ r: 255, g: 0, b: 0 }, "text");
	assertEquals(result, "<font color=#ff0000>text</font>");
	assertEquals(fontColour(undefined, "text"), "text");
});

// =============================================================================
// Images
// =============================================================================

Deno.test("img - creates image", () => {
	assertEquals(img("test.png"), '<img src="test.png">');
	assertEquals(
		img("test.png", { width: 100, height: 50 }),
		'<img src="test.png" width="100" height="50">',
	);
});

// =============================================================================
// Text Formatting
// =============================================================================

Deno.test("parafy - converts newlines to paragraphs", () => {
	// blank line (second \n after blank line) adds <p>
	assertEquals(parafy("line1\n\nline2"), "line1\n\n<p>line2");
	// line with text doesn't add <p> after first newline
	assertEquals(parafy("text\nmore"), "text\nmore");
	// single newline after text doesn't add <p>
	assertEquals(parafy("a\n"), "a\n");
});

Deno.test("textAge - formats time ago", () => {
	assertEquals(textAge(0), "moments ago");
	assertEquals(textAge(1), "1 minute ago");
	assertEquals(textAge(30), "30 minutes ago");
	assertEquals(textAge(60), "1 hour ago");
	assertEquals(textAge(120), "2 hours ago");
	assertEquals(textAge(1440), "1 day ago");
	assertEquals(textAge(2880), "2 days ago");
});

Deno.test("plural - pluralises correctly", () => {
	assertEquals(plural(0, "point"), "0 points");
	assertEquals(plural(1, "point"), "1 point");
	assertEquals(plural(5, "point"), "5 points");
});

Deno.test("withBars - joins with bars", () => {
	assertEquals(withBars(["a", "b", "c"]), "a | b | c");
	assertEquals(withBars(["a", "", "c"]), "a | c");
});

// =============================================================================
// Colour Stripe
// =============================================================================

Deno.test("colourStripe - creates coloured stripe", () => {
	const result = colourStripe({ r: 180, g: 180, b: 180 });
	assertEquals(result.includes('width="100%"'), true);
	assertEquals(result.includes("bgcolor=#b4b4b4"), true);
});

// =============================================================================
// HtmlBuilder
// =============================================================================

Deno.test("HtmlBuilder - pr appends raw html", () => {
	const builder = new HtmlBuilder();
	builder.pr("<div>");
	builder.pr("content");
	builder.pr("</div>");
	assertEquals(builder.toString(), "<div>content</div>");
});

Deno.test("HtmlBuilder - prn appends html with newline", () => {
	const builder = new HtmlBuilder();
	builder.prn("<div>");
	builder.prn("</div>");
	assertEquals(builder.toString(), "<div>\n</div>\n");
});

Deno.test("HtmlBuilder - text appends escaped text", () => {
	const builder = new HtmlBuilder();
	builder.text("<script>alert('xss')</script>");
	assertEquals(
		builder.toString(),
		"&#60;script&#62;alert(&#39;xss&#39;)&#60;/script&#62;",
	);
});

Deno.test("HtmlBuilder - chaining works", () => {
	const builder = new HtmlBuilder();
	builder.pr("<div>").text("hello").pr("</div>");
	assertEquals(builder.toString(), "<div>hello</div>");
});

// =============================================================================
// Tag attributes with colours
// =============================================================================

Deno.test("tag - with colour attribute", () => {
	const result = tag("td", { bgcolor: orange }, "content");
	assertEquals(result, "<td bgcolor=#ff6600>content</td>");
});

Deno.test("tag - with boolean true attribute", () => {
	const result = tag("input", { checked: true }, "");
	assertEquals(result, "<input checked></input>");
});

Deno.test("tag - with false/undefined attributes skipped", () => {
	const result = tag("div", { hidden: false, title: undefined }, "text");
	assertEquals(result, "<div>text</div>");
});

Deno.test("fontColour - with colour", () => {
	const result = fontColour(orange, "text");
	assertEquals(result, "<font color=#ff6600>text</font>");
});

Deno.test("fontColour - without colour", () => {
	const result = fontColour(undefined, "text");
	assertEquals(result, "text");
});

// =============================================================================
// Constants
// =============================================================================

Deno.test("bar constant", () => {
	assertEquals(bar, " | ");
});

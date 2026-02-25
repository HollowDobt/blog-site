import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const CONTENT_ROOTS = ["src/content/note", "src/content/jotting", "src/content/preface"];
const TEXT_EXTENSIONS = new Set([".md", ".mdx"]);
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---(?:\n|$)/;

function walkFiles(dir) {
	const entries = readdirSync(dir);
	const files = [];

	for (const name of entries) {
		const fullPath = join(dir, name);
		const info = statSync(fullPath);
		if (info.isDirectory()) {
			files.push(...walkFiles(fullPath));
			continue;
		}
		if (!info.isFile()) continue;
		if (!TEXT_EXTENSIONS.has(extname(name))) continue;
		files.push(fullPath);
	}

	return files;
}

function toShanghaiTimestamp(input) {
	const date = new Date(input);
	if (Number.isNaN(date.getTime())) return null;

	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
		hourCycle: "h23"
	}).formatToParts(date);

	const get = type => parts.find(part => part.type === type)?.value ?? "00";
	return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}+08:00`;
}

function gitCreatedAt(filePath) {
	try {
		const output = execFileSync("git", ["log", "--follow", "--diff-filter=A", "--format=%aI", "--", filePath], {
			encoding: "utf8"
		}).trim();
		if (!output) return null;
		const lines = output.split(/\n+/).map(line => line.trim()).filter(Boolean);
		if (!lines.length) return null;
		return lines.at(-1) ?? null;
	} catch {
		return null;
	}
}

function insertTimestamp(frontmatter, timestampText) {
	const lines = frontmatter.split("\n");
	const insertAfterTitle = lines.findIndex(line => /^\s*title\s*:/.test(line));

	if (insertAfterTitle >= 0) lines.splice(insertAfterTitle + 1, 0, `timestamp: ${timestampText}`);
	else lines.unshift(`timestamp: ${timestampText}`);

	return lines.join("\n");
}

function processFile(filePath) {
	const source = readFileSync(filePath, "utf8");
	const eol = source.includes("\r\n") ? "\r\n" : "\n";
	const normalized = source.replace(/\r\n/g, "\n");
	const matched = FRONTMATTER_REGEX.exec(normalized);
	if (!matched) return { status: "skip", reason: "no-frontmatter" };

	const frontmatter = matched[1];
	if (/(^|\n)\s*timestamp\s*:/.test(frontmatter)) return { status: "skip", reason: "has-timestamp" };

	const commitIso = gitCreatedAt(filePath);
	const finalTimestamp = toShanghaiTimestamp(commitIso ?? new Date().toISOString());
	if (!finalTimestamp) return { status: "skip", reason: "bad-date" };

	const newFrontmatter = insertTimestamp(frontmatter, finalTimestamp);
	const body = normalized.slice(matched[0].length);
	const next = `---\n${newFrontmatter}\n---\n${body}`.replace(/\n/g, eol);

	writeFileSync(filePath, next, "utf8");
	return { status: "updated", timestamp: finalTimestamp, source: commitIso ? "git" : "now" };
}

let updated = 0;
let checked = 0;

for (const root of CONTENT_ROOTS) {
	for (const filePath of walkFiles(root)) {
		checked += 1;
		const result = processFile(filePath);
		if (result.status === "updated") {
			updated += 1;
			console.log(`[timestamp] updated ${filePath} <- ${result.timestamp} (${result.source})`);
		}
	}
}

console.log(`[timestamp] done. checked=${checked}, updated=${updated}`);

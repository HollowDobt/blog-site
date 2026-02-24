type DebugDetails = Record<string, unknown> | unknown[] | string | number | boolean | null;

type DebugEntry = {
	id: number;
	timestamp: string;
	path: string;
	event: string;
	details?: DebugDetails;
};

type Probe = {
	name: string;
	selector: string;
	properties: string[];
};

declare global {
	interface Window {
		__renderDebug?: {
			enable: () => void;
			disable: () => void;
			isEnabled: () => boolean;
			dump: () => DebugEntry[];
			export: () => string;
			clear: () => void;
			snapshot: (reason?: string) => void;
		};
		__renderDebugInstalled?: boolean;
		swup?: {
			hooks?: {
				on: (event: string, callback: (...args: unknown[]) => void) => void;
			};
		} & Record<string, unknown>;
	}
}

const ENABLE_KEY = "__render_debug_enabled_v1";
const STORE_KEY = "__render_debug_logs_v1";
const MAX_LOGS = 600;

const probes: Probe[] = [
	{
		name: "markdown_h2",
		selector: ".markdown h2",
		properties: ["display", "fontSize", "fontWeight", "borderBottomWidth", "borderBottomStyle", "borderBottomColor"]
	},
	{
		name: "markdown_hr",
		selector: ".markdown hr",
		properties: ["display", "height", "borderBottomWidth", "borderBottomStyle", "borderBottomColor"]
	},
	{
		name: "markdown_table",
		selector: ".markdown table",
		properties: ["display", "borderCollapse", "borderTopWidth", "borderTopStyle", "borderBottomWidth", "borderBottomStyle"]
	},
	{
		name: "markdown_code",
		selector: ".markdown code",
		properties: ["display", "fontFamily", "fontSize", "lineHeight", "paddingLeft", "paddingRight"]
	},
	{
		name: "comment_input",
		selector: ".comment input, .comment textarea",
		properties: ["display", "fontFamily", "fontSize", "borderBottomWidth", "borderBottomStyle", "borderBottomColor"]
	}
];

const swupEvents = ["visit:start", "visit:end", "content:replace", "page:view", "page:load", "enable", "disable"];

let enabled = false;
let logs: DebugEntry[] = [];
let nextId = 1;
let observer: MutationObserver | undefined;

const now = () => new Date().toISOString();

function safeStore(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
	} catch {}
}

function safeRead(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function persistLogs() {
	safeStore(STORE_KEY, JSON.stringify(logs));
}

function loadLogs() {
	const raw = safeRead(STORE_KEY);
	if (!raw) return;
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return;
		logs = parsed
			.filter(entry => entry && typeof entry === "object" && typeof entry.event === "string")
			.slice(-MAX_LOGS)
			.map(entry => ({
				id: Number((entry as DebugEntry).id) || 0,
				timestamp: String((entry as DebugEntry).timestamp || now()),
				path: String((entry as DebugEntry).path || "/"),
				event: String((entry as DebugEntry).event || "unknown"),
				details: (entry as DebugEntry).details
			}));
		nextId = Math.max(1, ...logs.map(entry => entry.id + 1));
	} catch {}
}

function addLog(event: string, details?: DebugDetails) {
	if (!enabled) return;
	const entry: DebugEntry = {
		id: nextId++,
		timestamp: now(),
		path: `${location.pathname}${location.search}${location.hash}`,
		event,
		details
	};

	logs.push(entry);
	if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
	persistLogs();

	console.debug("[render-debug]", entry);
}

function readComputedProbe(probe: Probe) {
	const element = document.querySelector(probe.selector);
	if (!element) return { missing: true };
	const style = window.getComputedStyle(element);
	const computed: Record<string, string> = {};
	for (const property of probe.properties) computed[property] = style[property as keyof CSSStyleDeclaration] as string;
	return {
		missing: false,
		tagName: element.tagName.toLowerCase(),
		className: element.className,
		computed
	};
}

function readStylesheetState() {
	const stylesheets = Array.from(document.querySelectorAll('link[rel~="stylesheet"]')).map(link => {
		let ruleCount: number | null = null;
		let accessError: string | undefined;
		try {
			ruleCount = link.sheet?.cssRules?.length ?? null;
		} catch (error) {
			accessError = error instanceof Error ? error.message : String(error);
		}
		return {
			href: link.href,
			media: link.media || "all",
			disabled: link.disabled,
			ruleCount,
			accessError
		};
	});

	const styleTags = Array.from(document.querySelectorAll("style")).map((style, index) => ({
		index,
		length: style.textContent?.length ?? 0,
		media: style.media || "all",
		disabled: (style as HTMLStyleElement).disabled ?? false,
		dataAstroCid: style.getAttribute("data-astro-cid")
	}));

	return { stylesheets, styleTags };
}

function snapshot(reason = "manual") {
	addLog("snapshot", {
		reason,
		readyState: document.readyState,
		theme: document.documentElement.dataset.theme,
		probes: Object.fromEntries(probes.map(probe => [probe.name, readComputedProbe(probe)])),
		head: readStylesheetState()
	});
}

function scheduleSnapshot(reason: string) {
	requestAnimationFrame(() => requestAnimationFrame(() => snapshot(reason)));
}

function readHeadNode(node: Node) {
	if (!(node instanceof Element)) return { nodeType: node.nodeName };
	const rel = node.getAttribute("rel");
	const href = node.getAttribute("href");
	return {
		tagName: node.tagName.toLowerCase(),
		id: node.id || undefined,
		rel: rel || undefined,
		href: href || undefined,
		media: node.getAttribute("media") || undefined,
		disabled: node instanceof HTMLLinkElement || node instanceof HTMLStyleElement ? node.disabled : undefined,
		dataSwupIgnoreScript: node.getAttribute("data-swup-ignore-script") || undefined
	};
}

function installHeadObserver() {
	observer = new MutationObserver(mutations => {
		const summarized = mutations
			.map(mutation => {
				const added = Array.from(mutation.addedNodes).map(readHeadNode);
				const removed = Array.from(mutation.removedNodes).map(readHeadNode);
				if (!added.length && !removed.length && mutation.type !== "attributes") return null;

				return {
					type: mutation.type,
					target: readHeadNode(mutation.target),
					attributeName: mutation.attributeName || undefined,
					added,
					removed
				};
			})
			.filter(Boolean)
			.slice(0, 20);

		if (!summarized.length) return;
		addLog("head:mutation", summarized);
		scheduleSnapshot("head-mutation");
	});

	observer.observe(document.head, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["href", "rel", "media", "disabled"]
	});
}

function summarizeSwupPayload(payload: unknown) {
	if (!payload || typeof payload !== "object") return payload;
	const candidate = payload as Record<string, unknown>;
	const visit = (candidate.visit && typeof candidate.visit === "object" ? candidate.visit : candidate) as Record<string, unknown>;

	const from = visit.from && typeof visit.from === "object" ? (visit.from as Record<string, unknown>) : undefined;
	const to = visit.to && typeof visit.to === "object" ? (visit.to as Record<string, unknown>) : undefined;

	return {
		type: typeof visit.type === "string" ? visit.type : undefined,
		trigger: typeof visit.trigger === "string" ? visit.trigger : undefined,
		from: typeof from?.url === "string" ? from.url : undefined,
		to: typeof to?.url === "string" ? to.url : undefined
	};
}

function attachSwupHooks(source: string) {
	const swup = window.swup;
	if (!swup?.hooks?.on) return false;
	if ((swup as { __renderDebugHooksAttached?: boolean }).__renderDebugHooksAttached) return true;

	(swup as { __renderDebugHooksAttached?: boolean }).__renderDebugHooksAttached = true;
	addLog("swup:hooks-attached", { source });

	for (const event of swupEvents) {
		try {
			swup.hooks.on(event, (...args: unknown[]) => {
				addLog(`swup:${event}`, summarizeSwupPayload(args[0]));
				scheduleSnapshot(`swup:${event}`);
			});
		} catch (error) {
			addLog("swup:hook-error", {
				event,
				message: error instanceof Error ? error.message : String(error)
			});
		}
	}
	return true;
}

function setEnabled(value: boolean, reason: string) {
	enabled = value;
	safeStore(ENABLE_KEY, value ? "1" : "0");
	addLog("debug:toggle", { enabled: value, reason });
	if (value) snapshot("enabled");
}

function resolveInitialEnabled() {
	const query = new URLSearchParams(location.search);
	const fromQuery = query.get("__render_debug");
	if (fromQuery === "1") {
		safeStore(ENABLE_KEY, "1");
		return true;
	}
	if (fromQuery === "0") {
		safeStore(ENABLE_KEY, "0");
		return false;
	}
	return safeRead(ENABLE_KEY) === "1";
}

export function installRenderDebug() {
	if (window.__renderDebugInstalled) return;
	window.__renderDebugInstalled = true;

	loadLogs();
	enabled = resolveInitialEnabled();

	window.__renderDebug = {
		enable: () => setEnabled(true, "api"),
		disable: () => setEnabled(false, "api"),
		isEnabled: () => enabled,
		dump: () => [...logs],
		export: () => JSON.stringify(logs, null, 2),
		clear: () => {
			logs = [];
			nextId = 1;
			persistLogs();
			addLog("debug:clear");
		},
		snapshot: reason => snapshot(reason || "api")
	};

	addLog("debug:installed", { enabled });

	document.addEventListener(
		"load",
		event => {
			const target = event.target;
			if (!(target instanceof HTMLLinkElement)) return;
			if (!target.rel.includes("stylesheet")) return;
			addLog("stylesheet:load", { href: target.href, media: target.media || "all", disabled: target.disabled });
			scheduleSnapshot("stylesheet-load");
		},
		true
	);

	document.addEventListener(
		"error",
		event => {
			const target = event.target;
			if (!(target instanceof HTMLLinkElement)) return;
			if (!target.rel.includes("stylesheet")) return;
			addLog("stylesheet:error", { href: target.href, media: target.media || "all", disabled: target.disabled });
			scheduleSnapshot("stylesheet-error");
		},
		true
	);

	for (const event of ["DOMContentLoaded", "load", "pageshow", "visibilitychange", "astro:after-swap", "astro:page-load"]) {
		document.addEventListener(event, () => {
			addLog(`document:${event}`, { readyState: document.readyState, visibilityState: document.visibilityState });
			scheduleSnapshot(`document:${event}`);
		});
	}

	installHeadObserver();
	attachSwupHooks("install");
	document.addEventListener("swup:enable", () => attachSwupHooks("swup:enable"));

	snapshot("install");
}


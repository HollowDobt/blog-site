type ActionCode =
	| "BAD_REQUEST"
	| "UNAUTHORIZED"
	| "FORBIDDEN"
	| "NOT_FOUND"
	| "CONFLICT"
	| "CONTENT_TOO_LARGE"
	| "TOO_MANY_REQUESTS"
	| "INTERNAL_SERVER_ERROR"
	| "NOT_SUPPORTED";

export type ActionErrorLike = {
	code: ActionCode | string;
	message?: string;
	status?: number;
};

type ActionSuccess<T> = { data: T; error: undefined };
type ActionFailure = { data: undefined; error: ActionErrorLike };
type ActionResult<T> = Promise<ActionSuccess<T> | ActionFailure>;

type CommentHistory = {
	id: string | number;
	comment: string;
	timestamp: string;
	content: string;
};

type CommentNode = {
	id: string;
	section: string;
	item: string;
	reply: string | null;
	drifter: string | null;
	timestamp: string;
	updated: string | null;
	deleted: boolean;
	content: string | null;
	name: string | null;
	nickname: string | null;
	description: string | null;
	image: string;
	homepage: string | null;
	author: boolean;
	subcomments: CommentNode[];
};

const DEFAULT_AVATAR = "/akkarin.webp";
const LOCALE_PREFIX_RE = /^(en|zh-cn|ja)\//i;

function ok<T>(data: T): ActionSuccess<T> {
	return { data, error: undefined };
}

function fail(code: ActionCode | string, message?: string, status?: number): ActionFailure {
	return { data: undefined, error: { code, message, status } };
}

function statusCodeToAction(status: number): ActionCode | string {
	switch (status) {
		case 400:
			return "BAD_REQUEST";
		case 401:
			return "UNAUTHORIZED";
		case 403:
			return "FORBIDDEN";
		case 404:
			return "NOT_FOUND";
		case 409:
			return "CONFLICT";
		case 413:
			return "CONTENT_TOO_LARGE";
		case 429:
			return "TOO_MANY_REQUESTS";
		default:
			return "INTERNAL_SERVER_ERROR";
	}
}

function toError(payload: unknown, status: number, fallbackMessage: string): ActionErrorLike {
	if (payload && typeof payload === "object") {
		const source = payload as Record<string, unknown>;
		const nested = source.error;

		if (nested && typeof nested === "object") {
			const nestedError = nested as Record<string, unknown>;
			return {
				code: typeof nestedError.code === "string" ? nestedError.code : statusCodeToAction(status),
				message: typeof nestedError.message === "string" ? nestedError.message : fallbackMessage,
				status
			};
		}

		if (typeof nested === "string") {
			return { code: nested, message: fallbackMessage, status };
		}
	}

	return { code: statusCodeToAction(status), message: fallbackMessage, status };
}

async function parsePayload(response: Response): Promise<unknown> {
	const contentType = response.headers.get("content-type") ?? "";

	if (contentType.includes("application/json")) return response.json();

	const text = await response.text();
	if (!text) return undefined;

	try {
		return JSON.parse(text);
	} catch {
		return { message: text };
	}
}

function unwrapData<T = unknown>(payload: unknown): T {
	if (payload && typeof payload === "object" && "data" in payload) {
		return (payload as { data: T }).data;
	}

	return payload as T;
}

async function request<T>(path: string, init?: RequestInit): ActionResult<T> {
	const response = await fetch(path, {
		credentials: "include",
		headers: {
			Accept: "application/json",
			...(init?.body ? { "Content-Type": "application/json" } : {}),
			...(init?.headers ?? {})
		},
		...init
	});

	const payload = await parsePayload(response);
	if (!response.ok) {
		const error = toError(payload, response.status, response.statusText || "Request failed");
		return { data: undefined, error };
	}

	return ok(unwrapData<T>(payload));
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function asIso(value: unknown): string {
	if (typeof value === "string" && value.trim()) return value;
	if (typeof value === "number") return new Date(value).toISOString();
	return new Date().toISOString();
}

function toBoolean(value: unknown): boolean {
	return value === true || value === 1 || value === "1";
}

function normalizeComment(raw: unknown): CommentNode {
	const item = (raw ?? {}) as Record<string, unknown>;
	const id = asString(item.id) ?? asString(item.ID) ?? crypto.randomUUID();
	const sub = item.subcomments ?? item.subcomment ?? item.children;
	const author = item.author;
	const authorObject = author && typeof author === "object" ? (author as Record<string, unknown>) : undefined;

	const deleted = toBoolean(item.deleted) || asString(item.edit) === id;
	const content = deleted ? null : asString(item.content) ?? asString(item.markdown) ?? asString(item.html);

	return {
		id,
		section: asString(item.section) ?? "",
		item: asString(item.item) ?? "",
		reply: asString(item.reply),
		drifter: asString(item.drifter) ?? asString(item.authorID) ?? asString(authorObject?.id) ?? null,
		timestamp: asIso(item.timestamp ?? item.createdAt ?? item.created_at),
		updated: asString(item.updated ?? item.updatedAt ?? item.updated_at),
		deleted,
		content,
		name: asString(item.name) ?? asString(authorObject?.name) ?? asString(item.authorName),
		nickname: asString(item.nickname) ?? asString(item.guestNickname),
		description: asString(item.description) ?? asString(authorObject?.description),
		image: asString(item.image) ?? asString(authorObject?.image) ?? DEFAULT_AVATAR,
		homepage: asString(item.homepage) ?? asString(authorObject?.homepage),
		author: toBoolean(item.isAuthor) || toBoolean(authorObject?.author) || toBoolean(authorObject?.isAuthor),
		subcomments: Array.isArray(sub) ? sub.map(normalizeComment) : []
	};
}

function countNodes(list: CommentNode[]): number {
	return list.reduce((sum, node) => sum + 1 + countNodes(node.subcomments), 0);
}

function normalizeHistory(raw: unknown): CommentHistory[] {
	if (!Array.isArray(raw)) return [];

	return raw.map(item => {
		const source = (item ?? {}) as Record<string, unknown>;

		return {
			id: (source.id as string | number | undefined) ?? crypto.randomUUID(),
			comment: asString(source.comment) ?? "",
			timestamp: asIso(source.timestamp ?? source.updatedAt ?? source.createdAt),
			content: asString(source.content) ?? ""
		};
	});
}

function normalizeCommentItemKey(item: string): string {
	const cleaned = item.trim().replace(LOCALE_PREFIX_RE, "");
	return cleaned || item;
}

const unsupported = async <T>(): ActionResult<T> => fail("NOT_SUPPORTED");

export const actions = {
	comment: {
		list: async ({ section, item }: { section: string; item: string }): ActionResult<{ count: number; treeification: CommentNode[] }> => {
			const query = new URLSearchParams({ section, item: normalizeCommentItemKey(item) }).toString();
			const response = await request<Record<string, unknown>>(`/@/comments?${query}`);
			if (response.error) return response;

			const data = response.data;
			const sourceTree = data.treeification ?? data.comments ?? data.items ?? [];
			const treeification = Array.isArray(sourceTree) ? sourceTree.map(normalizeComment) : [];
			const countValue = Number(data.count ?? data.total ?? countNodes(treeification));

			return ok({
				count: Number.isFinite(countValue) ? countValue : treeification.length,
				treeification
			});
		},

		create: async ({
			section,
			item,
			reply,
			content,
			link,
			push,
			passer,
			locale
		}: {
			locale?: string;
			section: string;
			item: string;
			reply?: string | null;
			content: string;
			link: string;
			push?: number;
			passer?: { nickname?: string | null; captcha?: string | null };
		}): ActionResult<void> => {
			const body: Record<string, unknown> = { section, item: normalizeCommentItemKey(item), reply, content, link };
			if (locale) body.locale = locale;
			if (push != null) body.push = push;
			if (passer?.nickname) body.nickname = passer.nickname;
			if (passer?.captcha) body.captcha = passer.captcha;

			return request<void>("/@/comments", { method: "POST", body: JSON.stringify(body) });
		},

		edit: async ({ id, content }: { id: string; content: string }): ActionResult<void> => {
			return request<void>(`/@/comments/${encodeURIComponent(id)}/edit`, {
				method: "POST",
				body: JSON.stringify({ content })
			});
		},

		delete: async (id: string): ActionResult<void> => {
			return request<void>(`/@/comments/${encodeURIComponent(id)}/delete`, { method: "POST" });
		},

		history: async (id: string): ActionResult<CommentHistory[]> => {
			const response = await request<unknown>(`/@/comments/${encodeURIComponent(id)}/history`);
			if (response.error?.status === 404) return ok([]);
			if (response.error) return response;

			return ok(normalizeHistory(response.data));
		}
	},

	drifter: {
		profile: async (): ActionResult<
			| undefined
			| {
					id: string;
					provider: string;
					name: string;
					description: string | null;
					image: string;
					homepage: string | null;
					email: string | null;
					emailState: "pending" | "verified" | "bounced" | "suspended" | null;
					notify: boolean;
			  }
		> => {
			const response = await request<Record<string, unknown>>("/@/reach");
			if (response.error) return response;

			const profile = response.data;
			if (!profile.loggedIn || !profile.user || typeof profile.user !== "object") return ok(undefined);

			const user = profile.user as Record<string, unknown>;
			const id = asString(user.id) ?? asString(user.sub) ?? asString(user.account);
			if (!id) return ok(undefined);

			return ok({
				id,
				provider: asString(profile.provider) ?? asString(user.provider) ?? "GitHub",
				name: asString(user.name) ?? asString(user.login) ?? asString(user.nickname) ?? "User",
				description: asString(user.description) ?? asString(user.bio),
				image: asString(user.image) ?? asString(user.avatar_url) ?? DEFAULT_AVATAR,
				homepage: asString(user.homepage) ?? asString(user.blog),
				email: asString(user.email),
				emailState:
					(asString(user.emailState) as "pending" | "verified" | "bounced" | "suspended" | null) ??
					(asString(user.email_state) as "pending" | "verified" | "bounced" | "suspended" | null),
				notify: user.notify == null ? true : toBoolean(user.notify)
			});
		},

		synchronize: unsupported,
		update: unsupported,
		deactivate: unsupported,
		depart: async (): ActionResult<void> => {
			return request<void>("/@/depart", { method: "POST" });
		}
	},

	push: {
		subscribe: async ({ endpoint, p256dh, auth }: { endpoint: string; p256dh: string; auth: string }): ActionResult<number | undefined> => {
			return request<number | undefined>("/@/push/subscribe", {
				method: "POST",
				body: JSON.stringify({ endpoint, p256dh, auth })
			});
		},
		unsubscribe: async (endpoint: string): ActionResult<void> => {
			return request<void>("/@/push/unsubscribe", {
				method: "POST",
				body: JSON.stringify({ endpoint })
			});
		},
		check: async (endpoint: string): ActionResult<number | undefined> => {
			const query = new URLSearchParams({ endpoint }).toString();
			return request<number | undefined>(`/@/push/check?${query}`);
		}
	},

	email: {
		verify: async ({ locale, address }: { locale: string; address?: string | null }): ActionResult<void> => {
			return request<void>("/@/email/verify", {
				method: "POST",
				body: JSON.stringify({ locale, address })
			});
		},
		remove: async (): ActionResult<void> => {
			return request<void>("/@/email/remove", { method: "POST" });
		}
	}
};

<script lang="ts">
import { actions, type ActionErrorLike } from "./actions.client";
import { onMount, untrack } from "svelte";
import { slide } from "svelte/transition";
import { renderMarkdown } from "$utils/markdown.client";
import Icon from "$components/Icon.svelte";
import Modal from "$components/Modal.svelte";
import { pushTip } from "$components/Tip.svelte";
import config from "$config";
import i18nit from "$i18n";
import Drifter from "./Drifter.svelte";
import context, { countdownComment } from "./context.svelte";

type HumanChallenge = {
	algorithm: string;
	challenge: string;
	salt: string;
	signature: string;
	maxnumber?: number;
};

let {
	section,
	item,
	link,
	refresh,
	reply,
	edit,
	text,
	view = $bindable()
}: {
	section: string;
	item: string;
	link: string;
	refresh: (auto?: boolean) => Promise<void>;
	reply?: string | null;
	edit?: string;
	text?: string | null;
	view?: boolean;
} = $props();

const t = i18nit(context.locale);

let limit = $derived(context.limitComment);

/** Comment input is enabled only when it's authenticated or Turnstile is configured */
const enabled: boolean = Boolean(context.turnstile || context.drifter);
const hasSigninOption = true;

let reachView: boolean = $state(false); // OAuth signin view state
let profileView: boolean = $state(false); // User profile view state
let content: string = $state(""); // Comment content, will be initialized in onMount
let preview: boolean = $state(false); // Toggle between edit and preview mode
let nickname: string | null = $state(null); // Nickname for unauthenticated users
let captcha: string | undefined = $state(); // Captcha token for unauthenticated users
let resetTurnstile: (() => void) | undefined = $state(); // Function to reset Turnstile widget
let overlength: boolean = $derived(content.length > Number(config.comment?.["max-length"])); // Content length check
let emailAuthMode: "login" | "register" = $state("login");
let emailAuthName: string = $state("");
let emailAuthAddress: string = $state("");
let emailAuthPassword: string = $state("");
let emailAuthPasswordConfirm: string = $state("");
let emailAuthPending: boolean = $state(false);
let registerHumanChallenge: HumanChallenge | null = $state(null);
let registerHumanPayload: Record<string, unknown> | null = $state(null);
let registerHumanVerifying: boolean = $state(false);
let emailAuthVerificationId: string = $state("");
let emailAuthCode: string = $state("");
let emailAuthCodeSent: boolean = $state(false);
let previewHtml: Promise<string> | null = $state(null);
let TurnstileComponent: any = $state(null);

// Generate storage key
const DRAFT_PREFIX = "comment-draft:";
const DRAFT_SAVE_DELAY = 500;

let draftKey = `${DRAFT_PREFIX}${section}:${item}`;
if (reply) draftKey += `:reply-${reply}`;
if (edit) draftKey += `:edit-${edit}`;

// Watch content changes and save draft with debounce
$effect(() => {
	untrack(() => {
		if (textarea) {
			textarea.style.height = "auto";
			textarea.style.height = `${textarea.scrollHeight}px`;
		}
	});

	// Trigger reactivity by referencing
	const current = content;

	// Save draft for both new comments and edits (when content differs from original)
	const debouncer = setTimeout(() => {
		if (current.trim() && current !== text) {
			localStorage.setItem(draftKey, current);
		} else {
			localStorage.removeItem(draftKey);
		}
	}, DRAFT_SAVE_DELAY);

	// Cleanup before re-running the effect or when the component unmounts
	return () => clearTimeout(debouncer);
});

// Predefined emoji shortcuts for quick insertion
const emojis = [
	{ code: ":joy:", icon: "😂" },
	{ code: ":sob:", icon: "😭" },
	{ code: ":heart:", icon: "❤️" },
	{ code: ":pray:", icon: "🙏" },
	{ code: ":kissing_heart:", icon: "😘" },
	{ code: ":smirk:", icon: "😏" },
	{ code: ":cry:", icon: "😢" },
	{ code: ":weary:", icon: "😩" },
	{ code: ":fearful:", icon: "😨" },
	{ code: ":rage:", icon: "😡" }
];

let textarea: HTMLTextAreaElement | null = $state(null);

/**
 * Insert emoji at current cursor position in textarea
 */
function insertEmoji(emoji: string) {
	if (textarea) {
		// Get current cursor position
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;

		// Insert emoji at cursor position and update content
		textarea.value = content = content.slice(0, start) + emoji + content.slice(end);

		// Move cursor to end of inserted emoji
		textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
		textarea.focus();
	}
}

async function solveHumanPayload(challenge: HumanChallenge): Promise<Record<string, unknown> | null> {
	const max = Number(challenge.maxnumber ?? 100000);
	const { solveChallenge } = await import("altcha-lib");
	const task = solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm, max);
	const solved = await task.promise;
	if (!solved) return null;

	return {
		algorithm: challenge.algorithm,
		challenge: challenge.challenge,
		salt: challenge.salt,
		signature: challenge.signature,
		number: solved.number
	};
}

async function loadHumanChallenge() {
	const { data, error } = await actions.auth.humanChallenge();
	if (!error) {
		registerHumanChallenge = data.challenge;
		registerHumanPayload = null;
	} else {
		registerHumanChallenge = null;
		registerHumanPayload = null;
	}
}

async function ensureTurnstile() {
	if (TurnstileComponent || !context.turnstile || context.drifter) return;
	const { Turnstile } = await import("svelte-turnstile");
	TurnstileComponent = Turnstile;
}

async function verifyRegisterHuman() {
	if (registerHumanVerifying || emailAuthPending) return;
	if (!registerHumanChallenge) await loadHumanChallenge();
	if (!registerHumanChallenge) {
		pushTip("warning", t("oauth.email.human.failure"));
		return;
	}

	registerHumanVerifying = true;
	try {
		const payload = await solveHumanPayload(registerHumanChallenge);
		if (!payload) {
			registerHumanPayload = null;
			pushTip("warning", t("oauth.email.human.failure"));
			return;
		}
		registerHumanPayload = payload;
		pushTip("success", t("oauth.email.human.done"));
	} catch {
		registerHumanPayload = null;
		pushTip("warning", t("oauth.email.human.failure"));
	} finally {
		registerHumanVerifying = false;
	}
}

async function solveCommentHumanPayload(): Promise<Record<string, unknown> | null> {
	const { data, error } = await actions.auth.humanChallenge();
	if (error) return null;
	try {
		return await solveHumanPayload(data.challenge);
	} catch {
		return null;
	}
}

/**
 * Create or edit comment with validation and rate limiting
 */
async function submit() {
	// Ensure comment input is enabled
	if (!enabled) return pushTip("warning", t("comment.disabled"));

	// Enforce rate limiting
	if (limit > 0) return pushTip("warning", t("comment.limit"));

	// Validate content is not empty
	if (!content.trim()) return pushTip("warning", t("comment.empty"));

	let error: ActionErrorLike | undefined;
	if (!context.drifter) {
		// For unauthenticated users, validate captcha and nickname
		if (!captcha) return pushTip("error", t("comment.verify.failure"));
		if (!nickname?.trim()) return pushTip("warning", t("comment.nickname.empty"));

		({ error } = await actions.comment.create({
			locale: context.locale,
			section: section,
			item: item,
			reply,
			content,
			link: link,
			push: context.subscription,
			passer: { nickname, captcha }
		}));

		// Only reset turnstile for top-level comments (when reply is undefined) or if there was an error
		if (!reply || error) {
			resetTurnstile?.();
			captcha = undefined;
		}

		localStorage.setItem("nickname", nickname!);
	} else if (edit) {
		// For authenticated users editing a comment
		({ error } = await actions.comment.edit({ id: edit, content }));
	} else {
		// For authenticated users creating a comment
		let result = await actions.comment.create({
			locale: context.locale,
			section: section,
			item: item,
			reply,
			content,
			link: link,
			push: context.subscription
		});
		error = result.error;

		if (error?.code === "human_verification_required") {
			pushTip("information", t("oauth.email.human.processing"));
			const payload = await solveCommentHumanPayload();
			if (!payload) {
				pushTip("warning", t("oauth.email.human.failure"));
				return;
			}

			result = await actions.comment.create({
				locale: context.locale,
				section: section,
				item: item,
				reply,
				content,
				link: link,
				push: context.subscription,
				passer: { captchaPayload: payload }
			});
			error = result.error;
		}
	}

	if (!error) {
		// Refresh comment list to show updated comment
		refresh();

		// Implement rate limiting: 5-second cooldown
		countdownComment();

		// Reset form state after successful submission
		view = false;
		content = "";
		textarea?.blur();

		// Remove draft from localStorage upon successful submission
		localStorage.removeItem(draftKey);

		pushTip("success", t("comment.success"));
	} else {
		// Handle different error types
		switch (error.code) {
			case "TOO_MANY_REQUESTS":
				return pushTip("error", t("comment.limit"));

			case "CONTENT_TOO_LARGE":
				return pushTip("error", t("comment.overlength"));

			case "BAD_REQUEST":
				return pushTip("error", t("comment.verify.failure"));

			default:
				return pushTip("error", t("comment.failure"));
		}
	}
}

async function switchEmailAuthMode(mode: "login" | "register") {
	emailAuthMode = mode;
	emailAuthPassword = "";
	emailAuthPasswordConfirm = "";
	emailAuthCode = "";
	emailAuthVerificationId = "";
	emailAuthCodeSent = false;
	registerHumanPayload = null;
	if (mode === "register") await loadHumanChallenge();
}

async function submitEmailAuth() {
	if (emailAuthPending) return;

	const email = emailAuthAddress.trim();
	const password = emailAuthPassword;
	if (!email) return pushTip("warning", t("email.empty"));
	if (emailAuthMode === "login" && !password.trim()) return pushTip("warning", t("oauth.email.password.empty"));

	emailAuthPending = true;

	if (emailAuthMode === "register") {
		if (!emailAuthCodeSent) {
			if (!password.trim()) {
				emailAuthPending = false;
				return pushTip("warning", t("oauth.email.password.empty"));
			}
			if (password !== emailAuthPasswordConfirm) {
				emailAuthPending = false;
				return pushTip("warning", t("oauth.email.password.mismatch"));
			}
			if (!registerHumanPayload) {
				emailAuthPending = false;
				return pushTip("warning", t("oauth.email.human.empty"));
			}

			const result = await actions.auth.emailRegister({
				email,
				password,
				name: emailAuthName.trim() || undefined,
				captchaPayload: registerHumanPayload
			});
			emailAuthPending = false;

			if (!result.error) {
				if (result.data?.phase === "code_sent" && result.data?.verificationId) {
					emailAuthCodeSent = true;
					emailAuthVerificationId = result.data.verificationId;
					pushTip("information", t("oauth.email.register.code.sent"));
					return;
				}
				pushTip("success", t("oauth.email.register.success"));
				reachView = false;
				location.reload();
				return;
			}

			switch (result.error.code) {
				case "CONFLICT":
				case "email_exists":
					pushTip("warning", t("oauth.email.register.conflict"));
					break;

				case "TOO_MANY_REQUESTS":
				case "too_many_requests":
					pushTip("error", t("comment.limit"));
					break;

				case "ip_account_limit":
					pushTip("warning", t("oauth.email.register.ip_limit"));
					break;

				case "mail_not_configured":
					pushTip("error", t("oauth.email.common.mail_unavailable"));
					break;

				case "invalid_email":
				case "invalid_password":
					pushTip("warning", t("oauth.email.input.invalid"));
					break;

				case "human_verification_failed":
					pushTip("warning", t("oauth.email.human.failure"));
					registerHumanPayload = null;
					await loadHumanChallenge();
					break;

				default:
					pushTip("error", t("oauth.email.common.failure"));
					break;
			}
			return;
		}

		const code = emailAuthCode.trim();
		if (!emailAuthVerificationId || !/^\d{5}$/.test(code)) {
			emailAuthPending = false;
			pushTip("warning", t("oauth.email.register.code.invalid"));
			return;
		}

		const confirm = await actions.auth.emailRegister({
			verificationId: emailAuthVerificationId,
			code
		});
		emailAuthPending = false;

		if (!confirm.error) {
			pushTip("success", t("oauth.email.register.success"));
			reachView = false;
			location.reload();
			return;
		}

		switch (confirm.error.code) {
			case "verification_code_expired":
				pushTip("warning", t("oauth.email.register.code.expired"));
				emailAuthCodeSent = false;
				emailAuthVerificationId = "";
				emailAuthCode = "";
				registerHumanPayload = null;
				await loadHumanChallenge();
				break;

			case "verification_code_used":
			case "verification_code_exhausted":
			case "invalid_verification_code":
				pushTip("warning", t("oauth.email.register.code.invalid"));
				break;

			case "ip_account_limit":
				pushTip("warning", t("oauth.email.register.ip_limit"));
				break;

			case "CONFLICT":
			case "email_exists":
				pushTip("warning", t("oauth.email.register.conflict"));
				break;

			default:
				pushTip("error", t("oauth.email.common.failure"));
				break;
		}
		return;
	}

	const result = await actions.auth.emailLogin({ email, password });
	emailAuthPending = false;

	if (!result.error) {
		pushTip("success", t("oauth.email.login.success"));
		reachView = false;
		location.reload();
		return;
	}

	switch (result.error.code) {
		case "UNAUTHORIZED":
		case "invalid_credentials":
			pushTip("error", t("oauth.email.login.failure"));
			break;

		case "invalid_email":
		case "invalid_password":
			pushTip("warning", t("oauth.email.input.invalid"));
			break;

		default:
			pushTip("error", t("oauth.email.common.failure"));
			break;
	}
}

/**
 * Toggle push subscription on/off
 */
async function toggleSubscription() {
	context.subscription = undefined;

	const registration = await navigator.serviceWorker.getRegistration();
	if (!registration) return pushTip("error", t("push.enable.failure"));

	let subscription = await registration.pushManager.getSubscription();
	if (subscription) {
		// Unsubscribe from existing push subscription
		await subscription.unsubscribe();

		// Wether unsubscription succeeded or not, clear local state
		pushTip("success", t("push.disable.success"));

		// Notify server to remove subscription
		await actions.push.unsubscribe(subscription.endpoint);
	} else if (context.push) {
		// Request push notification permission before subscribing
		const permission = await Notification.requestPermission();
		if (permission !== "granted") return pushTip("information", t("push.denied"));

		try {
			// Create push subscription with VAPID key
			subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: context.push
			});

			// Extract keys from subscription
			const keys = subscription.toJSON().keys;

			// Register subscription with server
			const { data } = await actions.push.subscribe({
				endpoint: subscription.endpoint!,
				p256dh: keys!.p256dh,
				auth: keys!.auth
			});
			if (data) {
				context.subscription = data;
				pushTip("success", t("push.enable.success"));
			} else {
				// Rollback on failure
				await subscription.unsubscribe();
				pushTip("error", t("push.enable.failure"));
			}
		} catch (error) {
			pushTip("error", t("push.enable.failure"));
		}
	}
}

onMount(() => {
	// Do nothing if comment input is disabled
	if (!enabled) return;

	// Restore draft from localStorage
	const savedDraft = localStorage.getItem(draftKey);
	if (savedDraft) {
		content = savedDraft;
	} else if (text) {
		// For edit mode: use original text only when no draft exists
		content = text;
	}

	// If unauthenticated, setup nickname and Turnstile
	if (!context.drifter) {
		nickname = localStorage.getItem("nickname");
		void ensureTurnstile();
	}
});

$effect(() => {
	if (!preview) {
		previewHtml = null;
		return;
	}

	const value = content.trim();
	previewHtml = value ? renderMarkdown(content) : null;
});
</script>

<Modal bind:open={reachView}>
	<div class="flex flex-col items-center gap-5">
		<h2>{t("drifter.signin")}</h2>

		<ul class="flex flex-col gap-1 list-inside mx-4">
			<li>{t("oauth.benefit.captcha")}</li>
			<li>{t("oauth.benefit.comment")}</li>
			<li>{t("oauth.benefit.notification")}</li>
			<li>{t("oauth.benefit.homepage")}</li>
		</ul>

		<hr class="border-0 border-b border-dashed w-full" />

		{#if context.oauth.length}
			<div class="flex flex-col items-center gap-2">
				{#each context.oauth as provider}
					<a href={`/@/reach/${provider.name.toLowerCase()}`} class="flex items-center justify-center gap-2 w-full border-2 border-secondary py-1 px-2 rounded">
						<Icon size="0.95rem" name={provider.logo} />
						<span class="font-bold text-sm">{t("oauth.signin", { provider: provider.name })}</span>
					</a>
				{/each}
			</div>

			<hr class="border-0 border-b border-dashed w-full" />
		{/if}

		<div class="flex flex-col items-center gap-2 w-full">
			<p class="font-bold text-sm">{t("oauth.email.title")}</p>
			<input type="email" class="input w-full" placeholder={t("oauth.email.address.placeholder")} bind:value={emailAuthAddress} />
			<input type="password" class="input w-full" placeholder={t("oauth.email.password.placeholder")} bind:value={emailAuthPassword} />

			{#if emailAuthMode === "register"}
				<input type="text" class="input w-full" placeholder={t("oauth.email.name.placeholder")} bind:value={emailAuthName} />
				<input type="password" class="input w-full" placeholder={t("oauth.email.password.confirm")} bind:value={emailAuthPasswordConfirm} />

				<div class="flex w-full gap-2 items-center">
					<button class="form-button grow" disabled={emailAuthPending || registerHumanVerifying} onclick={verifyRegisterHuman}>
						{#if registerHumanVerifying}
							<span class="flex items-center justify-center"><Icon name="svg-spinners--ring-resize" /></span>
						{:else if registerHumanPayload}
							{t("oauth.email.human.done")}
						{:else}
							{t("oauth.email.human.verify")}
						{/if}
					</button>
					<button class="form-button" disabled={emailAuthPending || registerHumanVerifying} onclick={loadHumanChallenge}><Icon name="lucide--refresh-cw" /></button>
				</div>

				{#if emailAuthCodeSent}
					<input type="text" class="input w-full" maxlength="5" placeholder={t("oauth.email.register.code.placeholder")} bind:value={emailAuthCode} />
					<p class="w-full text-xs text-weak">{t("oauth.email.register.code.sent")}</p>
				{/if}
			{/if}

			<button class="text-sm underline-offset-2 hover:underline self-start" disabled={emailAuthPending} onclick={() => switchEmailAuthMode(emailAuthMode === "register" ? "login" : "register")}>
				{#if emailAuthMode === "register"}
					{t("oauth.email.login.switch")}
				{:else}
					{t("oauth.email.register.switch")}
				{/if}
			</button>

			<div class="flex items-center justify-between w-full">
				<button class="form-button" disabled={emailAuthPending || registerHumanVerifying} onclick={submitEmailAuth}>
					{#if emailAuthMode === "register"}
						{#if emailAuthCodeSent}
							{t("oauth.email.register.confirm")}
						{:else}
							{t("oauth.email.register.name")}
						{/if}
					{:else}
						{t("oauth.email.login.name")}
					{/if}
				</button>
				<button class="form-button" disabled={emailAuthPending || registerHumanVerifying} onclick={() => (reachView = false)}>{t("cancel")}</button>
			</div>
		</div>
	</div>
</Modal>

<Drifter bind:open={profileView} />

<main transition:slide={{ duration: 150 }} class="relative mt-5">
	{#if !enabled}
		<div class="absolute flex flex-col items-center justify-center gap-1 w-full h-full font-bold cursor-not-allowed">
			{#if !hasSigninOption}
				<span class="text-xl font-bold">{t("comment.disabled")}</span>
			{:else}
				<button onclick={() => (reachView = true)} class="border-2 py-1 px-2 rounded-sm font-bold">{t("comment.signin")}</button>
			{/if}
		</div>
	{/if}
	<div class:pointer-events-none={!enabled} class:blur={!enabled}>
		<fieldset disabled={!enabled} class="group relative flex flex-col py-3 px-4 *:text-remark focus-within:*:text-primary focus-within:*:border-remark *:transition-[color,backgroud,border,width,height] *:duration-200 *:ease-out">
			{#snippet corner(top: boolean, start: boolean)}
				<span aria-hidden="true" class="absolute -z-1 w-2 h-2 border-shadow group-focus-within:w-1/2 group-focus-within:h-1/2" class:top-0={top} class:bottom-0={!top} class:start-0={start} class:end-0={!start} class:border-t-2={top} class:border-b-2={!top} class:border-s-2={start} class:border-e-2={!start}></span>
			{/snippet}

			{@render corner(true, true)}{@render corner(true, false)}{@render corner(false, true)}{@render corner(false, false)}

			<article class="flex flex-col min-h-20 mb-2 overflow-auto">
				<textarea hidden={preview} placeholder="   {t('comment.placeholder')}" bind:this={textarea} bind:value={content} class="grow w-full bg-transparent text-base resize-none transition-[height]"></textarea>
				{#if preview}
					{#if content.trim()}
						{#await previewHtml}
							<Icon name="svg-spinners--pulse-3" size={30} />
						{:then html}
							<div class="markdown comment">{@html html}</div>
						{/await}
					{:else}
						<span class="grow flex items-center justify-center font-bold text-weak">&lt;{t("comment.preview.empty")}&gt;</span>
					{/if}
				{/if}
			</article>
			<section class="flex items-center gap-2">
				<figure class="relative flex items-center group/pop">
					<figcaption class="contents"><Icon name="lucide--smile" /></figcaption>
					<ul class="absolute bottom-full -start-3 flex flex-wrap sm:flex-nowrap items-center justify-center gap-2 mb-1 border-2 border-weak rounded-sm py-2 px-3 bg-background shadow-md pop">
						{#each emojis as emoji}
							<button onclick={() => insertEmoji(emoji.code)}>{emoji.icon}</button>
						{/each}
						<a href="https://github.com/ikatyang/emoji-cheat-sheet?tab=readme-ov-file#table-of-contents" target="_blank">…</a>
					</ul>
				</figure>
				<label class="flex items-center cursor-pointer group/icon" tabindex="-1"><Icon name="lucide--file-search" title={t("comment.preview.name")} /><input type="checkbox" class="switch" bind:checked={preview} /></label>
				<div class="grow"></div>

				{#if context.drifter}
					<button onclick={() => (profileView = true)}><Icon name="lucide--user-round-pen" title={t("drifter.profile")} /></button>
				{:else}
					{#if context.turnstile}
						{#if TurnstileComponent}
							<TurnstileComponent siteKey={context.turnstile} bind:reset={resetTurnstile} on:expired={() => (captcha = undefined)} on:error={() => (captcha = undefined)} on:callback={({ detail }) => (captcha = detail.token)} />
						{:else}
							<span class="contents text-primary"><Icon name="svg-spinners--pulse-rings-3" title={t("comment.verify.progress")} /></span>
						{/if}
					{/if}
					<input type="text" placeholder={t("comment.nickname.name")} bind:value={nickname} class="input border-weak w-35 text-sm" />
					{#if hasSigninOption}
						<button onclick={() => (reachView = true)}><Icon name="lucide--user-round" title={t("drifter.signin")} /></button>
					{/if}
				{/if}

				{#if context.push}
					<button onclick={toggleSubscription}>
						{#if context.subscription !== undefined}
							<Icon name="lucide--bell" title={t("push.enable.name")} />
						{:else}
							<Icon name="lucide--bell-off" title={t("push.disable.name")} />
						{/if}
					</button>
				{/if}

				<button id="submit" disabled={limit > 0 || (!context.drifter && !captcha) || overlength} onclick={submit}>
					{#if limit > 0}
						<span class="flex gap-0.5"><Icon name="lucide--timer" /><span class="relative top-0.5 text-sm font-mono leading-none">{Math.ceil(limit)}</span></span>
					{:else if !context.drifter && !captcha}
						<span class="contents text-primary"><Icon name="svg-spinners--pulse-rings-3" title={t("comment.verify.progress")} /></span>
					{:else if overlength}
						<span class="contents text-orange-600"><Icon name="lucide--rectangle-ellipsis" title={t("comment.overlength")} /></span>
					{:else if edit}
						<Icon name="lucide--pencil" title={t("comment.edit.name")} />
					{:else}
						<Icon name="lucide--send" title={t("comment.submit")} />
					{/if}
				</button>
			</section>
		</fieldset>
	</div>
</main>

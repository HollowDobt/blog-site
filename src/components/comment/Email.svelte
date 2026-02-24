<script lang="ts">
import Modal from "$components/Modal.svelte";
import Icon from "$components/Icon.svelte";
import { pushTip } from "$components/Tip.svelte";
import i18nit from "$i18n";
import { actions } from "./actions.client";
import context, { countdownEmail } from "./context.svelte";

const t = i18nit(context.locale);

const drifter = $derived(context.drifter!);

let address: string | null = $state(drifter.email);
let edit: boolean = $state(false);
let limit = $derived(context.limitEmail);
let removeView = $state(false);
let verificationId: string = $state("");
let code: string = $state("");
let confirming: boolean = $state(false);

function resetVerificationState() {
	verificationId = "";
	code = "";
	confirming = false;
}

/**
 * Send verification code to email address
 */
async function verify() {
	if (!context.email) return pushTip("error", t("email.verify.send.failure"));
	if (limit > 0) return pushTip("warning", t("email.verify.limit"));
	if (!address?.trim()) return pushTip("error", t("email.empty"));

	const { data, error } = await actions.email.verify({ locale: context.locale, address });
	if (!error) {
		countdownEmail();
		verificationId = data?.verificationId || "";
		code = "";

		drifter.emailState = "pending";
		drifter.email = data?.email || address;

		pushTip("information", t("email.verify.send.success"));
	} else {
		switch (error.code) {
			case "CONFLICT":
				pushTip("warning", t("email.verify.conflict"));
				break;

			case "TOO_MANY_REQUESTS":
			case "too_many_requests":
				pushTip("warning", t("email.verify.limit"));
				break;

			case "mail_not_configured":
				pushTip("error", t("oauth.email.common.mail_unavailable"));
				break;

			default:
				pushTip("error", t("email.verify.send.failure"));
				break;
		}
	}
}

/**
 * Confirm verification code and activate email
 */
async function confirmCode() {
	if (!verificationId) return pushTip("warning", t("email.verify.code.send_first"));
	if (!/^\d{5}$/.test(code.trim())) return pushTip("warning", t("email.verify.code.invalid"));
	if (confirming) return;

	confirming = true;
	const { data, error } = await actions.email.confirm({ verificationId, code: code.trim() });
	confirming = false;

	if (!error) {
		drifter.emailState = "verified";
		drifter.email = data?.email || address;
		edit = false;
		resetVerificationState();
		pushTip("success", t("email.verify.success"));
	} else {
		switch (error.code) {
			case "invalid_verification_code":
			case "verification_code_used":
			case "verification_code_exhausted":
				pushTip("warning", t("email.verify.code.invalid"));
				break;

			case "verification_code_expired":
				pushTip("warning", t("email.verify.code.expired"));
				resetVerificationState();
				break;

			default:
				pushTip("error", t("email.verify.send.failure"));
				break;
		}
	}
}

/**
 * Resend verification code
 */
async function resend() {
	if (limit > 0) return pushTip("warning", t("email.verify.limit"));
	if (!address?.trim()) return pushTip("warning", t("email.empty"));

	await verify();
}

/**
 * Remove email address from user profile
 */
async function remove() {
	const { error } = await actions.email.remove();
	if (!error) {
		removeView = false;
		edit = false;
		address = null;
		resetVerificationState();

		drifter.email = null;
		drifter.emailState = null;

		pushTip("success", t("email.remove.success"));
	} else {
		pushTip("error", t("email.remove.failure"));
	}
}
</script>

<Modal bind:open={removeView}>
	<div id="delete" class="flex flex-col items-center justify-center gap-5">
		<h2>{t("email.remove.name")}</h2>
		<section class="flex gap-5">
			<button class="form-button" onclick={() => (removeView = false)}>{t("cancel")}</button>
			<button class="form-button bg-red-500 text-white" onclick={remove}>{t("confirm")}</button>
		</section>
	</div>
</Modal>

<div class="flex flex-col gap-2">
	<label class="flex items-center gap-1 flex-wrap">
		{t("email.name")}: 
		<input type="email" disabled={!edit} bind:value={address} class="input" />

		<div class="flex gap-1 w-9.5">
			{#if edit}
				<button onclick={() => ((edit = false), (address = drifter.email), resetVerificationState())}><Icon name="lucide--x" /></button>
				{#if verificationId}
					<button onclick={confirmCode} disabled={confirming} title={t("email.verify.code.confirm")}><Icon name="lucide--shield-check" /></button>
				{:else if drifter.email === undefined || address?.trim()}
					<button onclick={verify} title={t("email.verify.send.success")}><Icon name="lucide--check" /></button>
				{:else if drifter.email}
					<button onclick={() => (removeView = true)}><Icon name="lucide--trash" title={t("email.remove.name")} /></button>
				{/if}
			{:else}
				{#if drifter.emailState === "verified"}
					<Icon name="lucide--badge-check" title={t("email.verify.done")} />
				{:else if context.limitEmail > 0}
					<span class="w-4.25 font-mono text-sm text-center">{Math.ceil(limit)}</span>
				{:else if drifter.email}
					<button onclick={resend}><Icon name="lucide--badge-question-mark" title={t("email.verify.resend")} /></button>
				{/if}
				<button onclick={() => (edit = true)}><Icon name="lucide--pencil" /></button>
			{/if}
		</div>
	</label>

	{#if edit && verificationId}
		<label class="flex items-center gap-1 flex-wrap text-sm">
			{t("email.verify.code.label")}:
			<input type="text" class="input" maxlength="5" bind:value={code} placeholder={t("email.verify.code.placeholder")} />
			<button onclick={resend} class="form-button" disabled={limit > 0}>{t("email.verify.resend")}</button>
		</label>
	{/if}
</div>

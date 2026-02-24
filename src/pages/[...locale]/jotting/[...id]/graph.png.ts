import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import config, { monolocale } from "$config";
import graph from "$graph/content";
import i18nit from "$i18n";
import { matchesLocaleID, routeLocaleFromID, slugFromID } from "$utils/content-id";

export async function getStaticPaths() {
	const jottings = await getCollection("jotting", jotting => !jotting.data.draft);

	return jottings
		.filter(jotting => matchesLocaleID(jotting.id, config.i18n.defaultLocale, config.i18n.defaultLocale, monolocale, config.i18n.locales) || !monolocale)
		.map(jotting => {
			const locale = monolocale ? undefined : routeLocaleFromID(jotting.id, config.i18n.locales, config.i18n.defaultLocale);
			const id = slugFromID(jotting.id, config.i18n.locales);

			return {
				params: { locale, id },
				props: {
					type: i18nit(locale || config.i18n.defaultLocale)(`navigation.jotting`),
					title: jotting.data.title,
					time: jotting.data.timestamp.toISOString().split("T")[0].replace(/-/g, "/"),
					tags: jotting.data.tags
				}
			};
		});
}

/**
 * GET handler that generates and returns the Open Graph image for a jotting.
 */
export const GET: APIRoute = async ({ params, props }) => {
	const image = await graph({
		locale: params.locale || config.i18n.defaultLocale,
		type: props.type,
		site: config.title,
		author: config.author.name,
		title: props.title,
		time: props.time,
		tags: props.tags
	});

	return new Response(new Uint8Array(image), { headers: { "Content-Type": "image/png" } });
};

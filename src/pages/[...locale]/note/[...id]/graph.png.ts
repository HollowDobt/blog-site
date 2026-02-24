import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import config, { monolocale } from "$config";
import graph from "$graph/content";
import i18nit from "$i18n";
import { matchesLocaleID, routeLocaleFromID, slugFromID } from "$utils/content-id";

export async function getStaticPaths() {
	const notes = await getCollection("note", note => !note.data.draft);

	return notes
		.filter(note => matchesLocaleID(note.id, config.i18n.defaultLocale, config.i18n.defaultLocale, monolocale, config.i18n.locales) || !monolocale)
		.map(note => {
			const locale = monolocale ? undefined : routeLocaleFromID(note.id, config.i18n.locales, config.i18n.defaultLocale);
			const id = slugFromID(note.id, config.i18n.locales);

			return {
				params: { locale, id },
				props: {
					type: i18nit(locale || config.i18n.defaultLocale)(`navigation.note`),
					title: note.data.title,
					time: note.data.timestamp.toISOString().split("T")[0].replace(/-/g, "/"),
					series: note.data.series,
					tags: note.data.tags
				}
			};
		});
}

/**
 * GET handler that generates and returns the Open Graph image for a note.
 */
export const GET: APIRoute = async ({ params, props }) => {
	const image = await graph({
		locale: params.locale || config.i18n.defaultLocale,
		type: props.type,
		site: config.title,
		author: config.author.name,
		title: props.title,
		time: props.time,
		series: props.series,
		tags: props.tags
	});

	return new Response(new Uint8Array(image), { headers: { "Content-Type": "image/png" } });
};

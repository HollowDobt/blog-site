type ParsedContentID = {
	locale?: string;
	slug: string;
};

export function parseLocalizedID(id: string, locales: string[]): ParsedContentID {
	const [first, ...rest] = id.split("/");
	const localeLike = /^[a-z]{2}(?:-[a-z0-9]+)?$/i.test(first);
	if (rest.length > 0 && (locales.includes(first) || localeLike)) return { locale: first, slug: rest.join("/") };
	return { slug: id };
}

export function slugFromID(id: string, locales: string[]): string {
	return parseLocalizedID(id, locales).slug;
}

export function routeLocaleFromID(id: string, locales: string[], defaultLocale: string): string | undefined {
	const parsed = parseLocalizedID(id, locales);
	if (!parsed.locale || parsed.locale === defaultLocale) return undefined;
	return parsed.locale;
}

export function matchesLocaleID(
	id: string,
	currentLocale: string,
	defaultLocale: string,
	monolocale: boolean,
	locales: string[]
): boolean {
	const parsed = parseLocalizedID(id, locales);

	if (monolocale) return !parsed.locale || parsed.locale === defaultLocale;
	if (!parsed.locale) return currentLocale === defaultLocale;

	return parsed.locale === currentLocale;
}

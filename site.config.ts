import siteConfig, { providers } from "./src/utils/config";

const env = import.meta.env ?? {};

const config = siteConfig({
	title: "Hollow's Corner",
	prologue: "Before the first move, I slow my pulse.\nThis is Hollow's corner.\nRules are dismantled here, then rewritten as stories.",
	author: {
		name: "Hollow Dobt",
		email: "i@hollowdobt.com",
		link: "https://blog.hollowdobt.com"
	},
	description: "帆楼的个人博客",
	copyright: {
		type: "CC BY-NC-ND 4.0",
		year: "2026"
	},
	i18n: {
		locales: ["zh-cn"],
		defaultLocale: "zh-cn"
	},
	pagination: {
		note: 15,
		jotting: 24
	},
	heatmap: {
		unit: "day",
		weeks: 20
	},
	feed: {
		section: "*",
		limit: 20
	},
	comment: {
		"max-length": 500,
		"hide-deleted": true,
		history: true
	},
	latest: "*"
});

const monolocale = Number(config.i18n.locales.length) === 1;

export default config;

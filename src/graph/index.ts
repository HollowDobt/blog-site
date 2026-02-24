import fs from "node:fs/promises";
import path from "node:path";

// Locale-specific Open Graph font URLs
const fonts: Record<string, string> = {
	en: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSerif/unhinted/otf/NotoSerif-Bold.otf",
	"zh-cn": "https://cdn.jsdelivr.net/gh/adobe-fonts/source-han-serif@release/OTF/SimplifiedChinese/SourceHanSerifSC-Bold.otf",
	ja: "https://cdn.jsdelivr.net/gh/adobe-fonts/source-han-serif@release/OTF/Japanese/SourceHanSerif-Bold.otf"
};

const fallbackFontPath = path.resolve(process.cwd(), "node_modules", "katex", "dist", "fonts", "KaTeX_Main-Bold.ttf");

/**
 * Load font for the specified locale.
 * @param locale locale code
 * @returns ArrayBuffer of the font data
 */
export async function loadFont(locale: string) {
	const fallback = fonts.en;
	const url = fonts[locale] ?? fallback;

	try {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`Failed to load font from ${url}: ${response.status} ${response.statusText}`);
		return response.arrayBuffer();
	} catch {
		return fs.readFile(fallbackFontPath).then(buffer => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
	}
}

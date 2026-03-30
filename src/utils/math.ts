const MATH_RE =
	/(^|[^\\])\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\\begin\{[a-zA-Z*]+\}|(^|[^\\])\$(?!\s)(?:[^$\n]|\\\$)+\$(?!\d)/m;

export function hasMathContent(value: unknown): boolean {
	return MATH_RE.test(String(value ?? ""));
}

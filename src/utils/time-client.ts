const DEFAULT_TIMEZONE = import.meta.env.PUBLIC_TIMEZONE || "Asia/Shanghai";

function toDate(value?: string | Date): Date {
	if (value instanceof Date) return value;

	const date = value ? new Date(value) : new Date();
	return Number.isNaN(date.getTime()) ? new Date() : date;
}

function dateTimeParts(value?: string | Date, locale: string = "en-CA", timeZone: string = DEFAULT_TIMEZONE) {
	const formatter = new Intl.DateTimeFormat(locale, {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false
	});

	const parts = formatter.formatToParts(toDate(value));

	return {
		year: parts.find(part => part.type === "year")?.value ?? "0000",
		month: parts.find(part => part.type === "month")?.value ?? "01",
		day: parts.find(part => part.type === "day")?.value ?? "01",
		hour: parts.find(part => part.type === "hour")?.value ?? "00",
		minute: parts.find(part => part.type === "minute")?.value ?? "00",
		second: parts.find(part => part.type === "second")?.value ?? "00"
	};
}

function Time(value?: string | Date, userTimezone: boolean = false): string {
	const { year, month, day, hour, minute, second } = dateTimeParts(value, "en-CA", userTimezone ? undefined : DEFAULT_TIMEZONE);
	return `${year}/${month}/${day}-${hour}:${minute}:${second}`;
}

namespace Time {
	export function toString(value?: string | Date, userTimezone: boolean = false): string {
		return Time(value, userTimezone);
	}

	export function toLocaleString(value?: string | Date, locale: string = navigator.language, userTimezone: boolean = false): string {
		return new Intl.DateTimeFormat(locale, {
			timeZone: userTimezone ? undefined : DEFAULT_TIMEZONE,
			dateStyle: "medium",
			timeStyle: "medium"
		}).format(toDate(value));
	}

	export function toDateString(value?: string | Date, userTimezone: boolean = false): string {
		const { year, month, day } = dateTimeParts(value, "en-CA", userTimezone ? undefined : DEFAULT_TIMEZONE);
		return `${year}/${month}/${day}`;
	}

	export function toLocaleDateString(value?: string | Date, locale: string = navigator.language, userTimezone: boolean = false): string {
		return new Intl.DateTimeFormat(locale, {
			timeZone: userTimezone ? undefined : DEFAULT_TIMEZONE,
			year: "numeric",
			month: "short",
			day: "numeric"
		}).format(toDate(value));
	}
}

export default Time;

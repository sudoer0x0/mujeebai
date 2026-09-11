/**
 * Date and time formatting utilities for the chat interface.
 *
 * Implements robust internationalization across all locales using native
 * Intl.DateTimeFormat, with safe fallbacks for missing/invalid timestamps.
 */

export interface DateTranslations {
  today?: string;
  yesterday?: string;
}

/**
 * Checks whether two dates represent the same calendar day in the viewer's local time zone.
 */
export function isSameDay(
  d1: Date | string | number | null | undefined,
  d2: Date | string | number | null | undefined,
): boolean {
  if (!d1 || !d2) return false;
  const a = d1 instanceof Date ? d1 : new Date(d1);
  const b = d2 instanceof Date ? d2 : new Date(d2);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;

  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Checks whether a given timestamp is on today's calendar day.
 */
export function isToday(d: Date | string | number | null | undefined): boolean {
  if (!d) return false;
  return isSameDay(d, new Date());
}

/**
 * Checks whether a given timestamp was on yesterday's calendar day.
 */
export function isYesterday(d: Date | string | number | null | undefined): boolean {
  if (!d) return false;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return isSameDay(d, yesterday);
}

/**
 * Formats a message timestamp to local short time (e.g., "11:35 PM" or "23:35" based on locale).
 */
export function formatMessageTime(
  dateInput: Date | string | number | null | undefined,
  locale: string = "en",
): string {
  if (!dateInput) return "";
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return "";

  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en", {
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  }
}

/**
 * Formats a date separator pill label:
 * - "Today" if sent today
 * - "Yesterday" if sent yesterday
 * - "Tue, 31 Mar" if sent in current year
 * - "Tue, 31 Mar 2024" if sent in a previous/future year
 */
export function formatDateSeparator(
  dateInput: Date | string | number | null | undefined,
  locale: string = "en",
  translations?: DateTranslations,
): string {
  if (!dateInput) return "";
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return "";

  if (isToday(d)) {
    return translations?.today || "Today";
  }

  if (isYesterday(d)) {
    return translations?.yesterday || "Yesterday";
  }

  const now = new Date();
  const isSameYear = d.getFullYear() === now.getFullYear();

  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(isSameYear ? {} : { year: "numeric" }),
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en", {
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(isSameYear ? {} : { year: "numeric" }),
    }).format(d);
  }
}

/**
 * Determines whether a date separator should be displayed between two consecutive messages.
 *
 * A separator is displayed:
 * 1. For the first message that carries a timestamp in the conversation.
 * 2. Whenever the current message is on a different calendar day than the preceding message.
 */
export function shouldShowDateSeparator(
  currentDate: Date | string | number | null | undefined,
  previousDate: Date | string | number | null | undefined,
): boolean {
  if (!currentDate) return false;
  const curr = currentDate instanceof Date ? currentDate : new Date(currentDate);
  if (Number.isNaN(curr.getTime())) return false;

  if (!previousDate) return true;
  const prev = previousDate instanceof Date ? previousDate : new Date(previousDate);
  if (Number.isNaN(prev.getTime())) return true;

  return !isSameDay(curr, prev);
}

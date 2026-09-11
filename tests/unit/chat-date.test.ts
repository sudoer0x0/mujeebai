import test from "node:test";
import assert from "node:assert/strict";
import {
  isSameDay,
  isToday,
  isYesterday,
  formatMessageTime,
  formatDateSeparator,
  shouldShowDateSeparator,
} from "@/lib/date";

test("isSameDay correctly identifies same vs different calendar days", () => {
  const d1 = new Date(2026, 2, 31, 10, 0, 0);
  const d2 = new Date(2026, 2, 31, 20, 0, 0);
  const d3 = new Date(2026, 3, 1, 10, 0, 0);

  // Same day
  assert.equal(isSameDay(d1, d2), true);

  // Different day
  assert.equal(isSameDay(d1, d3), false);

  // Null/undefined / invalid
  assert.equal(isSameDay(null, d1), false);
  assert.equal(isSameDay(d1, undefined), false);
  assert.equal(isSameDay("invalid-date", d1), false);
});

test("isToday and isYesterday correctly identify relative calendar days", () => {
  const now = new Date();
  assert.equal(isToday(now), true);
  assert.equal(isYesterday(now), false);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  assert.equal(isToday(yesterday), false);
  assert.equal(isYesterday(yesterday), true);

  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  assert.equal(isToday(twoDaysAgo), false);
  assert.equal(isYesterday(twoDaysAgo), false);

  assert.equal(isToday(null), false);
  assert.equal(isYesterday(undefined), false);
});

test("formatMessageTime formats valid timestamps into locale time", () => {
  const date = new Date("2026-03-31T14:30:00Z");
  const formattedEn = formatMessageTime(date, "en");
  assert.ok(formattedEn.length > 0);
  assert.ok(formattedEn.includes(":") || formattedEn.includes("30"));

  // Check empty / invalid input handling
  assert.equal(formatMessageTime(null), "");
  assert.equal(formatMessageTime(undefined), "");
  assert.equal(formatMessageTime("invalid-date"), "");
});

test("formatDateSeparator returns Today, Yesterday, or formatted date", () => {
  const translations = {
    today: "Today",
    yesterday: "Yesterday",
  };

  const now = new Date();
  assert.equal(formatDateSeparator(now, "en", translations), "Today");

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  assert.equal(formatDateSeparator(yesterday, "en", translations), "Yesterday");

  // Specific past date
  const pastDate = new Date("2024-03-31T12:00:00Z");
  const formattedPast = formatDateSeparator(pastDate, "en", translations);
  assert.ok(formattedPast.includes("2024"));
  assert.ok(formattedPast.includes("Mar") || formattedPast.includes("31"));

  // Arabic translations
  const arTranslations = {
    today: "اليوم",
    yesterday: "أمس",
  };
  assert.equal(formatDateSeparator(now, "ar", arTranslations), "اليوم");
  assert.equal(formatDateSeparator(yesterday, "ar", arTranslations), "أمس");

  // Null / invalid
  assert.equal(formatDateSeparator(null), "");
  assert.equal(formatDateSeparator("not-a-date"), "");
});

test("shouldShowDateSeparator displays separators between different days and for the first message", () => {
  const day1Msg1 = "2026-03-31T10:00:00Z";
  const day1Msg2 = "2026-03-31T11:35:00Z";
  const day2Msg1 = "2026-06-11T02:31:00Z";

  // First message in conversation (no previous message)
  assert.equal(shouldShowDateSeparator(day1Msg1, null), true);
  assert.equal(shouldShowDateSeparator(day1Msg1, undefined), true);

  // Consecutive message on the same day -> no separator
  assert.equal(shouldShowDateSeparator(day1Msg2, day1Msg1), false);

  // Message on next day -> show separator
  assert.equal(shouldShowDateSeparator(day2Msg1, day1Msg2), true);

  // Missing current timestamp -> don't show
  assert.equal(shouldShowDateSeparator(null, day1Msg1), false);
  assert.equal(shouldShowDateSeparator(undefined, day1Msg1), false);
});

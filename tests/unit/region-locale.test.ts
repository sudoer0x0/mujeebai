import test from "node:test";
import assert from "node:assert/strict";
import { localeForCountry, countryFromHeaders, resolveInitialLocale } from "../../src/i18n/region-locale";

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

test("an Arabic-official country whose online language is French maps to French", () => {
  // The motivating case: Arabic is official in the Maghreb, French is the
  // administrative and dominant online language.
  assert.equal(localeForCountry("MA"), "fr");
  assert.equal(localeForCountry("DZ"), "fr");
  assert.equal(localeForCountry("TN"), "fr");
});

test("Arabic-speaking countries outside the Maghreb map to Arabic", () => {
  assert.equal(localeForCountry("EG"), "ar");
  assert.equal(localeForCountry("SA"), "ar");
});

test("a country with no shipped locale falls back rather than guessing a near-match", () => {
  // Kenya is not Arabic-speaking just because it is in Africa.
  assert.equal(localeForCountry("KE"), null);
  assert.equal(resolveInitialLocale(headers({ "x-vercel-ip-country": "KE" })), "en");
});

test("Singapore is English, not Chinese", () => {
  assert.equal(localeForCountry("SG"), null);
  assert.equal(resolveInitialLocale(headers({ "cf-ipcountry": "SG" })), "en");
});

test("country beats Accept-Language for the initial default", () => {
  const resolved = resolveInitialLocale(
    headers({ "x-vercel-ip-country": "MA", "accept-language": "en-US,en;q=0.9" }),
  );
  assert.equal(resolved, "fr");
});

test("Accept-Language is used when the country is unknown", () => {
  assert.equal(resolveInitialLocale(headers({ "accept-language": "pt-BR,pt;q=0.9" })), "pt");
  // A region subtag still resolves to its base language.
  assert.equal(resolveInitialLocale(headers({ "accept-language": "zh-Hant-TW" })), "zh");
});

test("Accept-Language quality values are respected", () => {
  assert.equal(resolveInitialLocale(headers({ "accept-language": "de;q=0.9,ja;q=0.8" })), "ja");
});

test("anonymised country codes are ignored rather than treated as a country", () => {
  assert.equal(countryFromHeaders(headers({ "cf-ipcountry": "XX" })), null);
  assert.equal(countryFromHeaders(headers({ "cf-ipcountry": "T1" })), null);
  assert.equal(countryFromHeaders(headers({ "x-vercel-ip-country": "ma" })), "MA");
});

test("everything unknown ends up English", () => {
  assert.equal(resolveInitialLocale(headers({})), "en");
  assert.equal(resolveInitialLocale(headers({ "accept-language": "de-DE,de;q=0.9" })), "en");
});

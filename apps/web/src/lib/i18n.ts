import { messages, pickLocale } from "@freezer/shared/i18n";

/** UI language: German for German-language browsers, English otherwise. */
export const locale = pickLocale(navigator.languages?.length ? navigator.languages : [navigator.language]);
export const t = messages[locale];

/** Locale for numbers and dates: the browser's own one (e.g. en-GB), if it matches the UI language. */
export const formatLocale = navigator.language.toLowerCase().startsWith(locale) ? navigator.language : locale;

document.documentElement.lang = locale;

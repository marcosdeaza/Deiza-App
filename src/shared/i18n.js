/**
 * App interface language. Spanish is the source language (the keys are the Spanish strings);
 * English covers every other choice. The Chat view and Code's answers follow the chosen
 * language in full (the web ships 12 of them); this only translates the app's own chrome.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./i18n-en'));
  else root.DeizaI18n = factory(root.DeizaI18nEN);
}(typeof self !== 'undefined' ? self : this, function (EN) {
  const LANGUAGES = [
    ['es', 'Español'], ['en', 'English'], ['pt', 'Português'], ['fr', 'Français'], ['it', 'Italiano'], ['de', 'Deutsch'],
    ['ru', 'Русский'], ['zh', '中文'], ['ja', '日本語'], ['ko', '한국어'], ['hi', 'हिन्दी'], ['ar', 'العربية'],
  ];
  const CODES = LANGUAGES.map(l => l[0]);
  let lang = 'es';

  const isLanguage = (v) => CODES.includes(v);
  const fromLocale = (loc) => {
    const code = String(loc || '').toLowerCase().split(/[-_]/)[0];
    return isLanguage(code) ? code : 'en';
  };

  function setLanguage(next) { lang = isLanguage(next) ? next : 'es'; }
  function getLanguage() { return lang; }
  /** UI dictionary in use: 'es' or 'en'. */
  function uiLanguage() { return lang === 'es' ? 'es' : 'en'; }

  function T(key, params) {
    let s = lang === 'es' ? key : ((EN && EN[key]) || key);
    if (params) s = s.replace(/\{(\w+)\}/g, (_, k) => (params[k] === undefined || params[k] === null ? '' : String(params[k])));
    return s;
  }

  return { T, setLanguage, getLanguage, uiLanguage, isLanguage, fromLocale, LANGUAGES };
}));

// language.js - counts the text of a book, for both spaced languages (English) and Japanese
// Used by prepare.js (counting) and app.js (time left).
//
// English and similar languages put spaces between words, so words = pieces between spaces.
// Japanese has almost no spaces, so a "word" count by spaces is far too low. For those books
// we count characters (letters, kana and kanji, without punctuation or spaces) and estimate
// the reading time from characters per minute, which is how Japanese reading speed is measured.

const WORDS_PER_MIN = 230; // spaced languages
const JA_CHARS_PER_MIN = 500; // Japanese: typical adult reading speed is about 400 to 600
const CJK_SHARE = 0.3; // more than this share of Japanese characters = count characters
const KANA_SHARE = 0.05; // some kana present = Japanese (Chinese books have none)

// hiragana, katakana, kanji (and extension A), half-width katakana
const RE_NOT_CJK =
  /[^\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/g;
const RE_NOT_KANA = /[^\u3040-\u30ff\uff66-\uff9f]/g;
const RE_NOT_LETTER = /[^\p{L}\p{N}]/gu; // keeps letters and digits of any language

// counts for one chunk of text (a chapter)
function countText(text) {
  return {
    tokens: (text.match(/\S+/g) || []).length, // pieces between spaces
    letters: text.replace(RE_NOT_LETTER, "").length, // no spaces or punctuation
    cjk: text.replace(RE_NOT_CJK, "").length, // kana and kanji
    kana: text.replace(RE_NOT_KANA, "").length,
  };
}

// totals for the whole book -> what gets saved: words always, chars and lang for Japanese
function summarizeCounts(t) {
  const cjkBook = t.letters > 0 && t.cjk / t.letters > CJK_SHARE;
  return {
    words: t.tokens,
    chars: cjkBook ? t.letters : 0,
    lang: cjkBook && t.kana / t.letters > KANA_SHARE ? "ja" : "",
  };
}
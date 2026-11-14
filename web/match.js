// Turns whatever a player typed into a country, tolerating typos and alternate names.
(function (root) {
  'use strict';

  function normalize(text) {
    let s = String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    s = s.replace(/&/g, ' and ').replace(/['’`.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    s = s.replace(/^st /, 'saint ').replace(/ st /g, ' saint ');
    return s.split(' ').filter(w => w !== 'the' && w !== 'of' && w !== 'and').join('');
  }

  // Optimal string alignment: edit distance that counts a swapped pair as one typo.
  function distance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    let prev2 = null, prev = [], cur;
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      cur = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < best) best = v;
      }
      if (best > limit) return limit + 1;
      prev2 = prev;
      prev = cur;
    }
    return prev[b.length];
  }

  function typoLimit(length) {
    if (length < 4) return 0;
    if (length < 8) return 1;
    if (length < 12) return 2;
    return 3;
  }

  // Names that share a country word but need the player to be specific, or that
  // can fairly mean either of two countries.
  const AMBIGUOUS = { korea: ['KR', 'KP'] };
  const EITHER = { congo: ['CG', 'CD'] };

  // Places people often try that are not on the list. Listed so typo correction
  // never turns them into a nearby real country.
  const NOT_COUNTED = {
    england: 'Part of the United Kingdom', scotland: 'Part of the United Kingdom',
    wales: 'Part of the United Kingdom', northernireland: 'Part of the United Kingdom',
    greenland: 'Territory of Denmark', hongkong: 'Part of China', macau: 'Part of China',
    puertorico: 'US territory', guam: 'US territory', tibet: 'Part of China',
    bermuda: 'UK territory', gibraltar: 'UK territory', westernsahara: 'Disputed territory',
    somaliland: 'Part of Somalia', crimea: 'Part of Ukraine', catalonia: 'Part of Spain',
    antarctica: 'A continent', africa: 'A continent', asia: 'A continent', europe: 'A continent',
    australasia: 'A region', oceania: 'A continent'
  };

  function createMatcher(countries) {
    const exact = new Map();
    const candidates = [];
    const byCode = new Map();
    countries.forEach(c => {
      byCode.set(c.c, c);
      const main = normalize(c.n);
      exact.set(main, c.c);
      candidates.push({ key: main, code: c.c, main: true });
      (c.a || []).forEach(alias => {
        const key = normalize(alias);
        if (!exact.has(key)) exact.set(key, c.c);
        if (key.length >= 5) candidates.push({ key, code: c.c, main: false });
      });
    });

    function closest(key) {
      const limit = typoLimit(key.length);
      if (!limit) return [];
      let bestScore = Infinity, winners = new Set();
      candidates.forEach(cand => {
        const d = distance(key, cand.key, limit);
        if (d > limit) return;
        const score = d * 2 + (cand.main ? 0 : 1); // on equal typos, a main name beats an alias
        if (score < bestScore) { bestScore = score; winners = new Set([cand.code]); }
        else if (score === bestScore) winners.add(cand.code);
      });
      return [...winners];
    }

    /**
     * Result status: ok | dup | wrong | ambiguous.
     * found is a Set of country codes the player already has.
     */
    function match(input, found, forgiveTypos) {
      const key = normalize(input);
      if (!key) return { status: 'empty' };
      if (EITHER[key]) {
        const code = EITHER[key].find(c => !found.has(c)) || EITHER[key][0];
        return found.has(code) ? { status: 'dup', code } : { status: 'ok', code, corrected: false };
      }
      if (AMBIGUOUS[key]) return { status: 'ambiguous', options: AMBIGUOUS[key].map(c => byCode.get(c).n) };
      if (NOT_COUNTED[key]) return { status: 'wrong', hint: NOT_COUNTED[key] };

      let code = exact.get(key), corrected = false;
      if (!code && forgiveTypos) {
        const near = closest(key);
        if (near.length > 1) return { status: 'ambiguous', options: near.map(c => byCode.get(c).n) };
        if (near.length === 1) { code = near[0]; corrected = true; }
      }
      if (!code) return { status: 'wrong' };
      return found.has(code) ? { status: 'dup', code } : { status: 'ok', code, corrected };
    }

    return { match, byCode };
  }

  const api = { normalize, distance, createMatcher };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Match = api;
})(typeof window !== 'undefined' ? window : globalThis);

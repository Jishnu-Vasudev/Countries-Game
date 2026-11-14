// Spelling matcher tests. Run: node test-match.js
global.window = global;
require('../web/data.js');
const { createMatcher, normalize } = require('../web/match.js');
const countries = window.COUNTRY_DATA.countries;
const { match, byCode } = createMatcher(countries);

let fails = 0;
function expect(input, want, found = [], forgive = true) {
  const r = match(input, new Set(found), forgive);
  const got = r.status === 'ok' ? r.code : r.status;
  if (got !== want) { fails++; console.log(`FAIL "${input}" want ${want} got ${got} ${JSON.stringify(r)}`); }
}

// Every country must be reachable by its own name, typed exactly, with typo forgiveness on.
countries.forEach(c => expect(c.n, c.c === 'CG' ? 'CG' : c.c));

// Exact names of other countries must never be "corrected" into one another.
[['Niger', 'NE'], ['Nigeria', 'NG'], ['Iran', 'IR'], ['Iraq', 'IQ'], ['Austria', 'AT'], ['Australia', 'AU'],
 ['Mali', 'ML'], ['Malta', 'MT'], ['Malawi', 'MW'], ['Guinea', 'GN'], ['Guyana', 'GY'], ['Ghana', 'GH'],
 ['Gambia', 'GM'], ['Zambia', 'ZM'], ['Slovakia', 'SK'], ['Slovenia', 'SI'], ['Dominica', 'DM'],
 ['Dominican Republic', 'DO'], ['Iceland', 'IS'], ['Ireland', 'IE'], ['Sudan', 'SD'], ['South Sudan', 'SS'],
 ['Oman', 'OM'], ['Yemen', 'YE'], ['India', 'IN'], ['Indonesia', 'ID'], ['Samoa', 'WS'], ['Georgia', 'GE']
].forEach(([n, c]) => expect(n, c));

// Common typos.
[['Germny', 'DE'], ['Portgual', 'PT'], ['Phillipines', 'PH'], ['Philipines', 'PH'], ['Argentinia', 'AR'],
 ['Columbia', 'CO'], ['Brasil', 'BR'], ['Swizerland', 'CH'], ['Afganistan', 'AF'], ['Kazakstan', 'KZ'],
 ['Hungry', 'HU'], ['Chili', 'CL'], ['Mozambik', 'MZ'], ['Irelnd', 'IE'], ['Polland', 'PL'], ['Marocco', 'MA'],
 ['Tailand', 'TH'], ['Bangaldesh', 'BD'], ['Pakisatn', 'PK'], ['Venezuala', 'VE'], ['Madagaskar', 'MG'],
 ['Kyrgistan', 'KG'], ['Liechtenstien', 'LI'], ['Luxemburg', 'LU'], ['Sri lanaka', 'LK']
].forEach(([n, c]) => expect(n, c));

// Alternate names, case, spacing, accents and punctuation.
[['USA', 'US'], ['u.s.a.', 'US'], ['United States', 'US'], ['America', 'US'], ['uk', 'GB'], ['Great Britain', 'GB'],
 ['UAE', 'AE'], ['Holland', 'NL'], ['the netherlands', 'NL'], ['Burma', 'MM'], ['Swaziland', 'SZ'],
 ['Czech Republic', 'CZ'], ['Czechia', 'CZ'], ['Côte d\'Ivoire', 'CI'], ['ivory coast', 'CI'], ['DRC', 'CD'],
 ['DR Congo', 'CD'], ['Turkiye', 'TR'], ['Türkiye', 'TR'], ['Turkey', 'TR'], ['Vatican', 'VA'], ['East Timor', 'TL'],
 ['Bosnia', 'BA'], ['Bosnia & Herzegovina', 'BA'], ['Trinidad', 'TT'], ['St Lucia', 'LC'], ['St. Lucia', 'LC'],
 ['Saint Kitts', 'KN'], ['Sao Tome', 'ST'], ['São Tomé and Príncipe', 'ST'], ['south korea', 'KR'], ['NORTH KOREA', 'KP'],
 ['newzealand', 'NZ'], ['  France  ', 'FR'], ['the Gambia', 'GM'], ['Cabo Verde', 'CV'], ['Macedonia', 'MK'], ['PNG', 'PG']
].forEach(([n, c]) => expect(n, c));

// Rejections.
['England', 'Scotland', 'Wales', 'Greenland', 'Hong Kong', 'Puerto Rico', 'banana', 'xyz', 'aaaa', 'Atlantis', 'car park',
 'qqqqqqqq', 'Africa', 'Europe'].forEach(n => expect(n, 'wrong'));

// Duplicates, including via an alias or a typo.
expect('France', 'dup', ['FR']);
expect('Frnace', 'dup', ['FR']);
expect('USA', 'dup', ['US']);

// Needs the player to be specific.
expect('Korea', 'ambiguous');

// "Congo" can fairly mean either Congo.
expect('Congo', 'CG');
expect('Congo', 'CD', ['CG']);
expect('Congo', 'dup', ['CG', 'CD']);

// Exact-only mode.
expect('Germny', 'wrong', [], false);
expect('Germany', 'DE', [], false);
expect('USA', 'US', [], false);

// Empty input.
expect('   ', 'empty');
expect('!!!', 'empty');

// Every typed-with-one-swap main name of length >= 8 should still resolve to itself or be flagged, never to another country.
let wrongTarget = 0;
countries.forEach(c => {
  const key = c.n;
  if (key.length < 8) return;
  const typo = key.slice(0, 3) + key[4] + key[3] + key.slice(5);
  const r = match(typo, new Set(), true);
  if (r.status === 'ok' && r.code !== c.c) { wrongTarget++; console.log('MISROUTE', typo, '->', byCode.get(r.code).n, 'wanted', c.n); }
});

console.log(fails || wrongTarget ? `FAILED ${fails} + misroutes ${wrongTarget}` : 'all spelling tests passed', '| countries', countries.length, '| sample normalize', normalize('St. Vincent & the Grenadines'));
process.exit(fails || wrongTarget ? 1 : 0);

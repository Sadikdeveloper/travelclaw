import { normalizeLanguageTag } from '@travelclaw/shared';
import type { SearchMarket } from './types';

/**
 * Market context is the point-of-sale/display information a provider needs to price
 * and display a search: the booker's country, a requested display currency, and a
 * content language.
 *
 * It is read only from what the traveler wrote in the message that starts a search,
 * and only when they stated it in so many words. The route, the destination, a
 * passport nationality, a budget figure, and a currency a provider happened to return
 * are never treated as market context. A message that states nothing yields an empty
 * market, so the adapter keeps its own or the operator's configured default. Nothing
 * here is written to the account: there is no standing profile to go stale.
 */

/** ISO 4217. Used as an allowlist so `in RIO` or `in DOH` is not read as a currency. */
const CURRENCY_CODES = new Set(
  `AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD
   BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB
   EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK
   JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA
   MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK
   PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN
   SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST
   XAF XCD XOF XPF YER ZAR ZMW`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Codes that are also ordinary English words. They are accepted only after an explicit
 * "currency" keyword, never from a bare token such as "in top".
 */
const WORDLIKE_CURRENCY_CODES = new Set([
  'ALL',
  'BAM',
  'BOB',
  'CUP',
  'DOP',
  'GEL',
  'LAK',
  'MAD',
  'MOP',
  'PEN',
  'RON',
  'SOS',
  'TOP',
  'TRY',
  'VUV',
  'WST',
]);

/** Currency names that map to exactly one ISO code and are not ambiguous in English. */
const CURRENCY_BY_NAME: Record<string, string> = {
  naira: 'NGN',
  euro: 'EUR',
  euros: 'EUR',
  yen: 'JPY',
  won: 'KRW',
  baht: 'THB',
  rand: 'ZAR',
  sterling: 'GBP',
};

/** Words a context pattern may sit behind: pricing, results, or the search itself. */
const PRICING_CONTEXT =
  'price|prices|priced|pricing|quote|quotes|quoted|fare|fares|rate|rates|total|totals|cost|costs|charge|charges|pay|paid|show|display|list|give|book|search|find|flights?|hotels?|stays?|rooms?|tickets?';

const CURRENCY_NAME = 'naira|euros?|yen|won|baht|rand|sterling';

/** ISO 3166-1 alpha-2. Gates every coded match so a stray two-letter word is not a country. */
const COUNTRY_CODES = new Set(
  `AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ
   CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI
   FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HN HR HT HU ID IE IL IN IQ IR IS IT JM
   JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG
   MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK
   PL PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD
   TG TH TJ TL TM TN TO TR TT TV TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Two-letter codes that are also English words ("is", "it", "in", "no", "so", "my").
 * A lowercase code that reads as one of these is only believed when the traveler wrote
 * it as an explicit assignment ("country: us").
 */
const WORDLIKE_COUNTRY_CODES = new Set([
  'am',
  'an',
  'as',
  'at',
  'be',
  'by',
  'do',
  'go',
  'he',
  'if',
  'in',
  'is',
  'it',
  'me',
  'my',
  'no',
  'of',
  'on',
  'or',
  'so',
  'to',
  'up',
  'us',
  'we',
]);

/** Common English names for countries. Multi-word names are matched whole. */
const COUNTRY_BY_NAME: Record<string, string> = {
  afghanistan: 'AF',
  albania: 'AL',
  algeria: 'DZ',
  angola: 'AO',
  argentina: 'AR',
  armenia: 'AM',
  australia: 'AU',
  austria: 'AT',
  azerbaijan: 'AZ',
  bahamas: 'BS',
  bahrain: 'BH',
  bangladesh: 'BD',
  barbados: 'BB',
  belarus: 'BY',
  belgium: 'BE',
  benin: 'BJ',
  bhutan: 'BT',
  bolivia: 'BO',
  botswana: 'BW',
  brazil: 'BR',
  britain: 'GB',
  brunei: 'BN',
  bulgaria: 'BG',
  'burkina faso': 'BF',
  burundi: 'BI',
  cambodia: 'KH',
  cameroon: 'CM',
  canada: 'CA',
  'cape verde': 'CV',
  chad: 'TD',
  chile: 'CL',
  china: 'CN',
  colombia: 'CO',
  congo: 'CG',
  'costa rica': 'CR',
  croatia: 'HR',
  cuba: 'CU',
  cyprus: 'CY',
  'czech republic': 'CZ',
  czechia: 'CZ',
  denmark: 'DK',
  djibouti: 'DJ',
  'dominican republic': 'DO',
  ecuador: 'EC',
  egypt: 'EG',
  'el salvador': 'SV',
  eritrea: 'ER',
  estonia: 'EE',
  eswatini: 'SZ',
  ethiopia: 'ET',
  fiji: 'FJ',
  finland: 'FI',
  france: 'FR',
  gabon: 'GA',
  gambia: 'GM',
  germany: 'DE',
  ghana: 'GH',
  greece: 'GR',
  guatemala: 'GT',
  guinea: 'GN',
  'guinea-bissau': 'GW',
  guyana: 'GY',
  haiti: 'HT',
  honduras: 'HN',
  'hong kong': 'HK',
  hungary: 'HU',
  iceland: 'IS',
  india: 'IN',
  indonesia: 'ID',
  iran: 'IR',
  iraq: 'IQ',
  ireland: 'IE',
  israel: 'IL',
  italy: 'IT',
  'ivory coast': 'CI',
  jamaica: 'JM',
  japan: 'JP',
  jordan: 'JO',
  kazakhstan: 'KZ',
  kenya: 'KE',
  kuwait: 'KW',
  kyrgyzstan: 'KG',
  laos: 'LA',
  latvia: 'LV',
  lebanon: 'LB',
  lesotho: 'LS',
  liberia: 'LR',
  libya: 'LY',
  lithuania: 'LT',
  luxembourg: 'LU',
  macau: 'MO',
  madagascar: 'MG',
  malawi: 'MW',
  malaysia: 'MY',
  maldives: 'MV',
  mali: 'ML',
  malta: 'MT',
  mauritania: 'MR',
  mauritius: 'MU',
  mexico: 'MX',
  moldova: 'MD',
  mongolia: 'MN',
  montenegro: 'ME',
  morocco: 'MA',
  mozambique: 'MZ',
  myanmar: 'MM',
  namibia: 'NA',
  nepal: 'NP',
  netherlands: 'NL',
  'new zealand': 'NZ',
  nicaragua: 'NI',
  niger: 'NE',
  nigeria: 'NG',
  'north korea': 'KP',
  'north macedonia': 'MK',
  norway: 'NO',
  oman: 'OM',
  pakistan: 'PK',
  palestine: 'PS',
  panama: 'PA',
  'papua new guinea': 'PG',
  paraguay: 'PY',
  peru: 'PE',
  philippines: 'PH',
  poland: 'PL',
  portugal: 'PT',
  qatar: 'QA',
  romania: 'RO',
  russia: 'RU',
  rwanda: 'RW',
  'saudi arabia': 'SA',
  senegal: 'SN',
  serbia: 'RS',
  seychelles: 'SC',
  'sierra leone': 'SL',
  singapore: 'SG',
  slovakia: 'SK',
  slovenia: 'SI',
  somalia: 'SO',
  'south africa': 'ZA',
  'south korea': 'KR',
  'south sudan': 'SS',
  spain: 'ES',
  'sri lanka': 'LK',
  sudan: 'SD',
  sweden: 'SE',
  switzerland: 'CH',
  syria: 'SY',
  taiwan: 'TW',
  tajikistan: 'TJ',
  tanzania: 'TZ',
  thailand: 'TH',
  togo: 'TG',
  'trinidad and tobago': 'TT',
  tunisia: 'TN',
  turkey: 'TR',
  turkmenistan: 'TM',
  uae: 'AE',
  uganda: 'UG',
  uk: 'GB',
  ukraine: 'UA',
  'united arab emirates': 'AE',
  'united kingdom': 'GB',
  'united states': 'US',
  'united states of america': 'US',
  uruguay: 'UY',
  usa: 'US',
  uzbekistan: 'UZ',
  venezuela: 'VE',
  vietnam: 'VN',
  yemen: 'YE',
  zambia: 'ZM',
  zimbabwe: 'ZW',
};

/** ISO 639-1 codes, so a two-letter tag after "language" is a language and not any word. */
const LANGUAGE_CODES = new Set(
  `af am ar az be bg bn bs ca cs cy da de el en es et eu fa fi fr ga gl gu ha he hi hr
   hu hy id ig is it ja ka kk km kn ko ku ky lo lt lv mk ml mn mr ms mt my ne nl no ny
   pa pl ps pt ro ru rw si sk sl sn so sq sr st sv sw ta te tg th tk tl tr tt uk ur uz
   vi xh yo zh zu`
    .split(/\s+/)
    .filter(Boolean),
);

/** Language names that map to one ISO 639-1 code. */
const LANGUAGE_BY_NAME: Record<string, string> = {
  afrikaans: 'af',
  amharic: 'am',
  arabic: 'ar',
  bengali: 'bn',
  chinese: 'zh',
  czech: 'cs',
  danish: 'da',
  dutch: 'nl',
  english: 'en',
  finnish: 'fi',
  french: 'fr',
  german: 'de',
  greek: 'el',
  hausa: 'ha',
  hebrew: 'he',
  hindi: 'hi',
  hungarian: 'hu',
  igbo: 'ig',
  indonesian: 'id',
  italian: 'it',
  japanese: 'ja',
  korean: 'ko',
  malay: 'ms',
  norwegian: 'no',
  persian: 'fa',
  polish: 'pl',
  portuguese: 'pt',
  romanian: 'ro',
  russian: 'ru',
  spanish: 'es',
  swahili: 'sw',
  swedish: 'sv',
  thai: 'th',
  turkish: 'tr',
  ukrainian: 'uk',
  urdu: 'ur',
  vietnamese: 'vi',
  yoruba: 'yo',
  zulu: 'zu',
};

/* Built from the tables above; longest first so "south sudan" is not read as "sudan". */
const COUNTRY_NAME_PATTERN = alternatives(Object.keys(COUNTRY_BY_NAME));
const LANGUAGE_NAME_PATTERN = alternatives(Object.keys(LANGUAGE_BY_NAME));

function alternatives(names: string[]): string {
  return [...names]
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
}

/**
 * The market a single search should carry: only what the traveler stated in this
 * message. Every field is optional and omitted when unstated.
 */
export function searchMarketFrom(text: string): SearchMarket {
  const market: SearchMarket = {};
  const bookerCountry = bookerCountryFrom(text);
  if (bookerCountry) market.bookerCountry = bookerCountry;
  const currency = currencyFrom(text);
  if (currency) market.currency = currency;
  const language = languageFrom(text);
  if (language) market.language = language;
  return market;
}

/**
 * The operator's install-wide market, used only for keys the traveler's message did
 * not state. Never inferred from the route.
 */
export function mergeSearchMarket(
  stated: SearchMarket,
  fallback: SearchMarket,
): SearchMarket {
  const merged: SearchMarket = {};
  const bookerCountry = stated.bookerCountry ?? fallback.bookerCountry;
  const currency = stated.currency ?? fallback.currency;
  const language = stated.language ?? fallback.language;
  if (bookerCountry) merged.bookerCountry = bookerCountry;
  if (currency) merged.currency = currency;
  if (language) merged.language = language;
  return merged;
}

export function hasSearchMarket(market: SearchMarket): boolean {
  return Boolean(market.bookerCountry || market.currency || market.language);
}

function isUnambiguousCurrency(code: string): boolean {
  return CURRENCY_CODES.has(code) && !WORDLIKE_CURRENCY_CODES.has(code);
}

/** "price it in NGN", "show fares in EUR", "USD please" — never a bare "in Lisbon". */
function currencyFrom(text: string): string | undefined {
  const explicit = text.match(/\b(?:currency|currencies)\b[^.!?]{0,12}?\b([A-Za-z]{3})\b/i);
  if (explicit) {
    const code = explicit[1].toUpperCase();
    if (CURRENCY_CODES.has(code)) return code;
  }

  const named = text.match(
    new RegExp(
      `(?:\\b(?:${PRICING_CONTEXT})\\b[^.!?]{0,40}?\\b(?:in|into)\\s+(${CURRENCY_NAME})\\b)` +
        `|(?:\\b(?:in|into)\\s+(${CURRENCY_NAME})\\b[^.!?]{0,10}?\\b(?:please|only)\\b)`,
      'i',
    ),
  );
  const name = named?.[1] ?? named?.[2];
  if (name) {
    const code = CURRENCY_BY_NAME[name.toLowerCase()];
    if (code) return code;
  }

  const priced = text.match(
    new RegExp(
      `\\b(?:${PRICING_CONTEXT})\\b[^.!?]{0,40}?\\b(?:in|into)\\s+([A-Za-z]{3})\\b`,
      'i',
    ),
  );
  if (priced) {
    const code = priced[1].toUpperCase();
    if (isUnambiguousCurrency(code)) return code;
  }

  const tagged = text.match(
    /\b(?:in|into)\s+([A-Za-z]{3})\s+(?:please|only|if possible)\b/i,
  );
  if (tagged) {
    const code = tagged[1].toUpperCase();
    if (isUnambiguousCurrency(code)) return code;
  }

  const alone = text.match(/\b([A-Za-z]{3})\s+(?:please|only)\b/i);
  if (alone) {
    const code = alone[1].toUpperCase();
    if (isUnambiguousCurrency(code)) return code;
  }

  return undefined;
}

/**
 * The booker's country is the point of sale, so only phrases that name the booker
 * count: "I'm based in Nigeria", "booking from NG", "booker country: NG". A country
 * that appears only as a route or a destination is not a point of sale.
 */
function bookerCountryFrom(text: string): string | undefined {
  const assigned = text.match(
    /\b(?:booker country|point[- ]of[- ]sale|pos|country)\b\s*(?:code)?\s*([:=])?\s*([A-Za-z]{2})\b/,
  );
  if (assigned) {
    const [, separator, raw] = assigned;
    const code = raw.toUpperCase();
    const lowercaseWord =
      raw === raw.toLowerCase() && WORDLIKE_COUNTRY_CODES.has(raw.toLowerCase());
    if (COUNTRY_CODES.has(code) && (!lowercaseWord || Boolean(separator))) return code;
  }

  const coded = text.match(
    /\b(?:based|booking|book|i live|residing|reside)\b[^.!?]{0,20}?\b(?:in|from)\s+([A-Z]{2})\b/,
  );
  if (coded && COUNTRY_CODES.has(coded[1])) return coded[1];

  const named = text.match(
    new RegExp(
      `\\b(?:based|i live|i'm based|i am based|residing|reside|my country|booker country|point[- ]of[- ]sale|country)\\b` +
        `[^.!?]{0,20}?\\b(?:in|is|:)?\\s*(?:the\\s+)?(${COUNTRY_NAME_PATTERN})\\b`,
      'i',
    ),
  );
  if (named) {
    const code = COUNTRY_BY_NAME[named[1].toLowerCase()];
    if (code) return code;
  }

  const from = text.match(
    new RegExp(
      `\\b(?:booking|book)\\s+from\\s+(?:the\\s+)?(${COUNTRY_NAME_PATTERN})\\b`,
      'i',
    ),
  );
  if (from) {
    const code = COUNTRY_BY_NAME[from[1].toLowerCase()];
    if (code) return code;
  }

  return undefined;
}

/** "language en-NG", "content language French", "show prices in Spanish". */
function languageFrom(text: string): string | undefined {
  const named = text.match(
    new RegExp(
      `\\b(?:content language|site language|locale|language)\\b[^.!?]{0,12}?[:=]?\\s*(?:the\\s+)?(${LANGUAGE_NAME_PATTERN})\\b`,
      'i',
    ),
  );
  if (named) {
    const code = LANGUAGE_BY_NAME[named[1].toLowerCase()];
    if (code) return code;
  }

  const tagged = text.match(
    /\b(?:content language|site language|locale|language)\b[^.!?]{0,12}?[:=]?\s*([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\b/,
  );
  if (tagged) {
    const base = tagged[1].split('-')[0].toLowerCase();
    if (LANGUAGE_CODES.has(base)) return normalizeLanguageTag(tagged[1]);
  }

  const shown = text.match(
    new RegExp(
      `\\b(?:prices?|pricing|quotes?|fares?|rates?|content|results?|pages?|site|show|display|list)\\b` +
        `[^.!?]{0,20}?\\bin\\s+(?:the\\s+)?(${LANGUAGE_NAME_PATTERN})\\b`,
      'i',
    ),
  );
  if (shown) {
    const code = LANGUAGE_BY_NAME[shown[1].toLowerCase()];
    if (code) return code;
  }

  return undefined;
}

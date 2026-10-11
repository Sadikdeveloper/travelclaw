import type {
  AirlineBookingChannel,
  AirlineContact,
  AirlineData,
  AirlinePaymentOrder,
} from './types';

/**
 * A carrier directory, not a fare source and not a schedule.
 *
 * Metasearch vendors are weak exactly where this table is strong: Google Flights
 * (and so the `serpapi` adapter) covers a Nigerian domestic pair thinly and often
 * returns availability with no seller link, while the carrier's own site holds
 * the real inventory. So the desk keeps three slow-changing facts per carrier —
 * who they are, where to book, and how their payment order works — and looks up
 * the fast-changing facts (does this flight run today, what does it cost) from a
 * vendor at request time.
 *
 * Two rules keep this honest:
 *
 * 1. **Nothing here is a price or an availability claim.** A route listed below
 *    says a carrier has flown that pair, not that a seat exists on the traveler's
 *    date. `flights.search` is still the only source of a fare on this desk.
 * 2. **`paymentOrder` is `unverified` unless someone read the carrier's own
 *    published terms.** That field is the whole point of the table — it decides
 *    whether the agent can reserve now and let the traveler pay later, or must
 *    hand off at the payment step — so guessing it is worse than leaving it
 *    unknown. `evidence` names where a non-`unverified` value came from.
 *
 * Curated by hand, so it goes stale. Every row carries `verifiedOn` and the tool
 * that reads this table says out loud that the desk must re-check before acting.
 */

export interface AirlineProfile {
  id: string;
  name: string;
  /** IATA code, only where it is certain. Null beats a guessed two letters. */
  iata: string | null;
  /** ISO 3166-1 alpha-2 of the carrier's home country. */
  country: string;
  scope: 'domestic' | 'regional' | 'international';
  /** Airport codes this carrier is based at. Not a route list. */
  hubs: string[];
  bookingUrl: string;
  channels: AirlineBookingChannel[];
  paymentOrder: AirlinePaymentOrder;
  /** Where a non-`unverified` payment order was read. Never a guess. */
  evidence?: string;
  /**
   * What the carrier publishes about its own booking flow. Kept to the steps a
   * person can follow on the carrier's own site; no selector, no form field, no
   * value the desk would have to invent.
   */
  bookingSteps?: string[];
  /** What the carrier publishes about using a booking reference afterwards. */
  manageBooking?: string;
  contact?: AirlineContact;
  /** When a human last checked this row against the carrier's own site. */
  verifiedOn: string;
  notes?: string;
}

/** One city-pair the desk has seen a carrier operate, in either direction. */
export interface AirlineRouteFact {
  from: string;
  to: string;
  carrierIds: string[];
  /** `single` when the desk has only ever seen one carrier on the pair. */
  confidence: 'single' | 'shared';
  verifiedOn: string;
  note?: string;
}

/** Airport codes for the cities this directory covers. Not a global airport DB. */
export const DIRECTORY_AIRPORTS: Record<
  string,
  { city: string; country: string; iata: string[] }
> = {
  LOS: { city: 'Lagos', country: 'NG', iata: ['LOS'] },
  ABV: { city: 'Abuja', country: 'NG', iata: ['ABV'] },
  KAD: { city: 'Kaduna', country: 'NG', iata: ['KAD'] },
  KAN: { city: 'Kano', country: 'NG', iata: ['KAN'] },
  QUO: { city: 'Uyo', country: 'NG', iata: ['QUO'] },
  ENU: { city: 'Enugu', country: 'NG', iata: ['ENU'] },
  PHC: { city: 'Port Harcourt', country: 'NG', iata: ['PHC'] },
  QOW: { city: 'Owerri', country: 'NG', iata: ['QOW'] },
  ABB: { city: 'Asaba', country: 'NG', iata: ['ABB'] },
  BNI: { city: 'Benin City', country: 'NG', iata: ['BNI'] },
  CBQ: { city: 'Calabar', country: 'NG', iata: ['CBQ'] },
  ILR: { city: 'Ilorin', country: 'NG', iata: ['ILR'] },
  MIU: { city: 'Maiduguri', country: 'NG', iata: ['MIU'] },
  SKO: { city: 'Sokoto', country: 'NG', iata: ['SKO'] },
  YOL: { city: 'Yola', country: 'NG', iata: ['YOL'] },
  GMO: { city: 'Gombe', country: 'NG', iata: ['GMO'] },
  BCU: { city: 'Bauchi', country: 'NG', iata: ['BCU'] },
  DKA: { city: 'Katsina', country: 'NG', iata: ['DKA'] },
  QRW: { city: 'Warri', country: 'NG', iata: ['QRW'] },
  AKR: { city: 'Akure', country: 'NG', iata: ['AKR'] },
  ADO: { city: 'Ado Ekiti', country: 'NG', iata: ['ADO'] },
  ZAR: { city: 'Zaria', country: 'NG', iata: ['ZAR'] },
  LHR: { city: 'London', country: 'GB', iata: ['LHR', 'LGW', 'STN', 'LCY'] },
  ADD: { city: 'Addis Ababa', country: 'ET', iata: ['ADD'] },
  NBO: { city: 'Nairobi', country: 'KE', iata: ['NBO'] },
  ACC: { city: 'Accra', country: 'GH', iata: ['ACC'] },
  JNB: { city: 'Johannesburg', country: 'ZA', iata: ['JNB'] },
  CMN: { city: 'Casablanca', country: 'MA', iata: ['CMN'] },
  CAI: { city: 'Cairo', country: 'EG', iata: ['CAI'] },
  KGL: { city: 'Kigali', country: 'RW', iata: ['KGL'] },
  LFW: { city: 'Lome', country: 'TG', iata: ['LFW'] },
  DXB: { city: 'Dubai', country: 'AE', iata: ['DXB'] },
  DOH: { city: 'Doha', country: 'QA', iata: ['DOH'] },
  IST: { city: 'Istanbul', country: 'TR', iata: ['IST'] },
};

/** Lowercased name and common alias → airport code. Covers this directory only. */
const PLACE_ALIASES: Record<string, string> = {
  lagos: 'LOS',
  'murtala muhammed': 'LOS',
  mm2: 'LOS',
  abuja: 'ABV',
  'fct abuja': 'ABV',
  kaduna: 'KAD',
  kano: 'KAN',
  uyo: 'QUO',
  enugu: 'ENU',
  'port harcourt': 'PHC',
  ph: 'PHC',
  owerri: 'QOW',
  asaba: 'ABB',
  'benin city': 'BNI',
  benin: 'BNI',
  calabar: 'CBQ',
  ilorin: 'ILR',
  maiduguri: 'MIU',
  sokoto: 'SKO',
  yola: 'YOL',
  gombe: 'GMO',
  bauchi: 'BCU',
  katsina: 'DKA',
  warri: 'QRW',
  osubi: 'QRW',
  akure: 'AKR',
  'ado ekiti': 'ADO',
  ekiti: 'ADO',
  zaria: 'ZAR',
  london: 'LHR',
  'addis ababa': 'ADD',
  nairobi: 'NBO',
  accra: 'ACC',
  johannesburg: 'JNB',
  casablanca: 'CMN',
  cairo: 'CAI',
  kigali: 'KGL',
  lome: 'LFW',
  lomé: 'LFW',
  dubai: 'DXB',
  doha: 'DOH',
  istanbul: 'IST',
};

export const AIRLINES: AirlineProfile[] = [
  {
    id: 'rano-air',
    name: 'Rano Air',
    iata: 'R4',
    country: 'NG',
    scope: 'domestic',
    hubs: ['ABV'],
    bookingUrl: 'https://www.ranoair.com/',
    channels: [
      { url: 'https://www.ranoair.com/', kind: 'airline_site' },
      { url: 'tel:09169844058', kind: 'phone', label: '091 6984 4058' },
    ],
    // The carrier's own site documents a booking reference usable before
    // check-in, which only makes sense if a reference exists ahead of payment.
    // The payment deadline itself is not published on the page the desk read, so
    // the desk must ask the site for it rather than assume one.
    paymentOrder: 'pnr_then_pay',
    evidence:
      'ranoair.com published Manage Bookings and Web Check-in as booking reference (PNR) + last name, retrieved 2026-10-11',
    bookingSteps: [
      'Search the route on ranoair.com and pick a departure.',
      'Enter passenger details, then read back the booking reference (PNR) it returns.',
      'Complete payment by the deadline the site states; the desk does not pay.',
    ],
    manageBooking:
      'Manage Bookings and Web Check-in on ranoair.com take a booking reference (PNR) and last name. Online check-in opens 24 hours before departure.',
    contact: {
      email: 'customercare@ranoair.com',
      phone: ['091 6984 4058', '091 6984 4061', '091 6834 0356'],
      whatsapp: ['091 6984 4060', '091 6984 4059'],
    },
    verifiedOn: '2026-10-11',
    notes:
      'Lands at Murtala Muhammed 2 (MMA2) in Lagos, not the MMA1 terminal most travelers assume.',
  },
  {
    id: 'air-peace',
    name: 'Air Peace',
    iata: 'P4',
    country: 'NG',
    scope: 'international',
    hubs: ['LOS'],
    bookingUrl: 'https://flyairpeace.com/book-a-flight/',
    channels: [{ url: 'https://flyairpeace.com/book-a-flight/', kind: 'airline_site' }],
    // The carrier's own FAQ says the booking reference and ticket arrive "once
    // you have confirmed and completed payment". There is no unpaid slot here, so
    // the agent hands off at payment instead of promising a reservation.
    paymentOrder: 'pay_at_booking',
    evidence:
      'flyairpeace.com booking FAQ: the booking reference and e-ticket follow completed payment, retrieved 2026-10-11',
    bookingSteps: [
      'Search the route on flyairpeace.com and pick a departure.',
      'Enter passenger details and reach the payment step.',
      'Payment issues the ticket; the confirmation email carries the PNR and e-ticket number.',
    ],
    manageBooking:
      'Manage a booking, request changes or add services on the Air Peace site or app with the booking reference. Domestic online check-in opens 24 hours and closes 2 hours before departure.',
    contact: { email: 'callcenter@flyairpeace.com', phone: ['+234 814 040 9808'] },
    verifiedOn: '2026-10-11',
  },
  {
    id: 'green-africa',
    name: 'Green Africa Airways',
    iata: 'Q9',
    country: 'NG',
    scope: 'domestic',
    hubs: ['LOS'],
    bookingUrl: 'https://www.greenafrican.com/',
    channels: [{ url: 'https://www.greenafrican.com/', kind: 'airline_site' }],
    paymentOrder: 'unverified',
    verifiedOn: '2026-10-11',
  },
  {
    id: 'ibom-air',
    name: 'Ibom Air',
    iata: 'QI',
    country: 'NG',
    scope: 'domestic',
    hubs: ['QUO', 'LOS'],
    bookingUrl: 'https://www.ibomair.com/',
    channels: [{ url: 'https://www.ibomair.com/', kind: 'airline_site' }],
    paymentOrder: 'unverified',
    verifiedOn: '2026-10-11',
  },
  {
    id: 'max-air',
    name: 'Max Air',
    iata: null,
    country: 'NG',
    scope: 'domestic',
    hubs: ['KAN', 'ABV'],
    bookingUrl: 'https://www.maxair.com/',
    channels: [{ url: 'https://www.maxair.com/', kind: 'airline_site' }],
    paymentOrder: 'unverified',
    verifiedOn: '2026-10-11',
  },
  {
    id: 'arik-air',
    name: 'Arik Air',
    iata: null,
    country: 'NG',
    scope: 'international',
    hubs: ['LOS', 'ABV'],
    bookingUrl: 'https://www.arikair.com/',
    channels: [{ url: 'https://www.arikair.com/', kind: 'airline_site' }],
    paymentOrder: 'unverified',
    verifiedOn: '2026-10-11',
    notes: 'IATA code left null on purpose: this desk has not confirmed it.',
  },
  {
    id: 'valuejet',
    name: 'ValueJet',
    iata: null,
    country: 'NG',
    scope: 'domestic',
    hubs: ['LOS'],
    bookingUrl: 'https://www.valuejet.ng/',
    channels: [{ url: 'https://www.valuejet.ng/', kind: 'airline_site' }],
    paymentOrder: 'unverified',
    verifiedOn: '2026-10-11',
  },
  {
    id: 'united-nigeria',
    name: 'United Nigeria Airlines',
    iata: null,
    country: 'NG',
    scope: 'domestic',
    hubs: ['LOS', 'ENU'],
    bookingUrl: 'https://www.unitednigeriaairlines.com/',
    channels: [{ url: 'https://www.unitednigeriaairlines.com/', kind: 'airline_site' }],
    paymentOrder: 'unverified',
    verifiedOn: '2026-10-11',
  },
  {
    id: 'ethiopian',
    name: 'Ethiopian Airlines',
    iata: 'ET',
    country: 'ET',
    scope: 'international',
    hubs: ['ADD'],
    bookingUrl: 'https://www.ethiopianairlines.com/',
    channels: [{ url: 'https://www.ethiopianairlines.com/', kind: 'airline_site' }],
    paymentOrder: 'unverified',
    verifiedOn: '2026-10-11',
  },
  {
    id: 'kenya-airways',
    name: 'Kenya Airways',
    iata: 'KQ',
    country: 'KE',
    scope: 'international',
    hubs: ['NBO'],
    bookingUrl: 'https://www.kenya-airways.com/',
    channels: [{ url: 'https://www.kenya-airways.com/', kind: 'airline_site' }],
    paymentOrder: 'unverified',
    verifiedOn: '2026-10-11',
  },
  {
    id: 'rwandair',
    name: 'RwandAir',
    iata: 'WB',
    country: 'RW',
    scope: 'international',
    hubs: ['KGL'],
    bookingUrl: 'https://www.rwandair.com/',
    channels: [{ url: 'https://www.rwandair.com/', kind: 'airline_site' }],
    paymentOrder: 'unverified',
    verifiedOn: '2026-10-11',
  },
  {
    id: 'asky',
    name: 'ASKY Airlines',
    iata: 'KP',
    country: 'TG',
    scope: 'regional',
    hubs: ['LFW'],
    bookingUrl: 'https://www.flyasky.com/',
    channels: [{ url: 'https://www.flyasky.com/', kind: 'airline_site' }],
    paymentOrder: 'unverified',
    verifiedOn: '2026-10-11',
  },
  {
    id: 'egyptair',
    name: 'EgyptAir',
    iata: 'MS',
    country: 'EG',
    scope: 'international',
    hubs: ['CAI'],
    bookingUrl: 'https://www.egyptair.com/',
    channels: [{ url: 'https://www.egyptair.com/', kind: 'airline_site' }],
    paymentOrder: 'unverified',
    verifiedOn: '2026-10-11',
  },
  {
    id: 'royal-air-maroc',
    name: 'Royal Air Maroc',
    iata: 'AT',
    country: 'MA',
    scope: 'international',
    hubs: ['CMN'],
    bookingUrl: 'https://www.royalairmaroc.com/',
    channels: [{ url: 'https://www.royalairmaroc.com/', kind: 'airline_site' }],
    paymentOrder: 'unverified',
    verifiedOn: '2026-10-11',
  },
  {
    id: 'south-african-airways',
    name: 'South African Airways',
    iata: 'SA',
    country: 'ZA',
    scope: 'international',
    hubs: ['JNB'],
    bookingUrl: 'https://www.flysaa.com/',
    channels: [{ url: 'https://www.flysaa.com/', kind: 'airline_site' }],
    paymentOrder: 'unverified',
    verifiedOn: '2026-10-11',
  },
  {
    id: 'emirates',
    name: 'Emirates',
    iata: 'EK',
    country: 'AE',
    scope: 'international',
    hubs: ['DXB'],
    bookingUrl: 'https://www.emirates.com/',
    channels: [{ url: 'https://www.emirates.com/', kind: 'airline_site' }],
    paymentOrder: 'unverified',
    verifiedOn: '2026-10-11',
  },
  {
    id: 'qatar-airways',
    name: 'Qatar Airways',
    iata: 'QR',
    country: 'QA',
    scope: 'international',
    hubs: ['DOH'],
    bookingUrl: 'https://www.qatarairways.com/',
    channels: [{ url: 'https://www.qatarairways.com/', kind: 'airline_site' }],
    paymentOrder: 'unverified',
    verifiedOn: '2026-10-11',
  },
  {
    id: 'turkish-airlines',
    name: 'Turkish Airlines',
    iata: 'TK',
    country: 'TR',
    scope: 'international',
    hubs: ['IST'],
    bookingUrl: 'https://www.turkishairlines.com/',
    channels: [{ url: 'https://www.turkishairlines.com/', kind: 'airline_site' }],
    paymentOrder: 'unverified',
    verifiedOn: '2026-10-11',
  },
  {
    id: 'british-airways',
    name: 'British Airways',
    iata: 'BA',
    country: 'GB',
    scope: 'international',
    hubs: ['LHR'],
    bookingUrl: 'https://www.britishairways.com/',
    channels: [{ url: 'https://www.britishairways.com/', kind: 'airline_site' }],
    paymentOrder: 'unverified',
    verifiedOn: '2026-10-11',
  },
  {
    id: 'virgin-atlantic',
    name: 'Virgin Atlantic',
    iata: 'VS',
    country: 'GB',
    scope: 'international',
    hubs: ['LHR'],
    bookingUrl: 'https://www.virginatlantic.com/',
    channels: [{ url: 'https://www.virginatlantic.com/', kind: 'airline_site' }],
    paymentOrder: 'unverified',
    verifiedOn: '2026-10-11',
  },
];

/**
 * Pairs the desk has seen served. Deliberately tiny and only Nigerian domestic,
 * because that is where metasearch is thin and a wrong "no one flies this" is
 * expensive. Direction is not stored: a listed pair covers both ways, and a
 * carrier that flies it one way is named for the pair until someone checks the
 * other. Absence here means nothing at all — it is not "no service".
 */
export const AIRLINE_ROUTES: AirlineRouteFact[] = [
  {
    from: 'KAD',
    to: 'LOS',
    carrierIds: ['rano-air'],
    confidence: 'single',
    verifiedOn: '2026-10-11',
    note: 'Google Flights lists Rano Air as the only nonstop on this pair.',
  },
  {
    from: 'LOS',
    to: 'ABV',
    carrierIds: ['air-peace', 'rano-air', 'green-africa'],
    confidence: 'shared',
    verifiedOn: '2026-10-11',
  },
  {
    from: 'ABV',
    to: 'KAN',
    carrierIds: ['air-peace', 'rano-air', 'max-air'],
    confidence: 'shared',
    verifiedOn: '2026-10-11',
  },
  {
    from: 'LOS',
    to: 'KAN',
    carrierIds: ['air-peace', 'rano-air'],
    confidence: 'shared',
    verifiedOn: '2026-10-11',
  },
  {
    from: 'LOS',
    to: 'QUO',
    carrierIds: ['ibom-air', 'air-peace'],
    confidence: 'shared',
    verifiedOn: '2026-10-11',
  },
  {
    from: 'ABV',
    to: 'QUO',
    carrierIds: ['ibom-air', 'air-peace'],
    confidence: 'shared',
    verifiedOn: '2026-10-11',
  },
  {
    from: 'LOS',
    to: 'ENU',
    carrierIds: ['air-peace', 'united-nigeria'],
    confidence: 'shared',
    verifiedOn: '2026-10-11',
  },
  {
    from: 'LOS',
    to: 'PHC',
    carrierIds: ['air-peace', 'green-africa'],
    confidence: 'shared',
    verifiedOn: '2026-10-11',
  },
  {
    from: 'ABV',
    to: 'PHC',
    carrierIds: ['air-peace', 'green-africa'],
    confidence: 'shared',
    verifiedOn: '2026-10-11',
  },
  {
    from: 'LOS',
    to: 'BNI',
    carrierIds: ['air-peace', 'green-africa'],
    confidence: 'shared',
    verifiedOn: '2026-10-11',
  },
  {
    from: 'LOS',
    to: 'QRW',
    carrierIds: ['rano-air'],
    confidence: 'single',
    verifiedOn: '2026-10-11',
  },
  {
    from: 'ABV',
    to: 'MIU',
    carrierIds: ['rano-air', 'max-air'],
    confidence: 'shared',
    verifiedOn: '2026-10-11',
  },
  {
    from: 'ABV',
    to: 'SKO',
    carrierIds: ['rano-air', 'max-air'],
    confidence: 'shared',
    verifiedOn: '2026-10-11',
  },
  {
    from: 'LOS',
    to: 'LHR',
    carrierIds: ['air-peace', 'british-airways', 'virgin-atlantic'],
    confidence: 'shared',
    verifiedOn: '2026-10-11',
  },
];

const BY_ID = new Map(AIRLINES.map((airline) => [airline.id, airline]));

/**
 * A carrier the traveler or a fare source named, matched against the directory.
 *
 * This is what makes the directory usable worldwide rather than only on the
 * handful of pairs it lists: any fare source on earth returns a carrier name,
 * and a name is enough to look up where that carrier books and how it sequences
 * payment. Matching stays conservative — an exact name, or the name without a
 * trailing corporate word — because a loose match would attach one airline's
 * booking terms to a different airline, which is worse than not knowing.
 */
export function findCarrierByName(name: string): AirlineProfile | undefined {
  const wanted = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!wanted) return undefined;
  const exact = AIRLINES.find((airline) => airline.name.toLowerCase() === wanted);
  if (exact) return exact;
  const bare = wanted.replace(CORPORATE_SUFFIX, '').trim();
  if (!bare || bare.length < 3) return undefined;
  return AIRLINES.find((airline) => {
    const candidate = airline.name.toLowerCase();
    return candidate === bare || candidate.replace(CORPORATE_SUFFIX, '').trim() === bare;
  });
}

const CORPORATE_SUFFIX = /\s+(airlines?|airways?|air|lines?|group|holding|holdings)$/i;

export function findAirline(id: string): AirlineProfile | undefined {
  return BY_ID.get(id);
}

/** Carriers serving a country's domestic or regional network, best matches first. */
export function airlinesInCountry(country: string): AirlineProfile[] {
  const code = country.trim().toUpperCase();
  return AIRLINES.filter((airline) => airline.country === code);
}

/**
 * A city or airport code this directory knows, as its primary airport code.
 * Returns undefined rather than guessing, so an unknown place is a named refusal
 * instead of a wrong code.
 */
export function directoryAirportCode(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper) && DIRECTORY_AIRPORTS[upper]) return upper;
  return PLACE_ALIASES[trimmed.toLowerCase()];
}

/**
 * Both ends of a route as the traveler wrote them, resolved against this
 * directory's own place table.
 *
 * The desk's generic hint extraction resolves a destination only against the
 * editorial destination cards, so a route between two cities that have no card —
 * which is most of a domestic network — reaches the router with an origin and no
 * destination. Rather than widen the shared extractor for every tool, the
 * directory reads its own question out of the message: it is the only tool that
 * needs a pair it can name, and it refuses a place it does not know.
 */
export function routePairIn(text: string): { from: string; to: string } | undefined {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;

  const explicit =
    /\bfrom\s+([\p{L}\p{N}][\p{L}\p{N}'’.-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}'’.-]*)?)\s+to\s+([\p{L}\p{N}][\p{L}\p{N}'’.-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}'’.-]*)?)/iu.exec(
      cleaned,
    ) ??
    /\b([\p{L}\p{N}][\p{L}\p{N}'’.-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}'’.-]*)?)\s*(?:–|—|-)\s*([\p{L}\p{N}][\p{L}\p{N}'’.-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}'’.-]*)?)\b/u.exec(
      cleaned,
    );
  if (explicit) {
    const from = directoryAirportCode(explicit[1]!);
    const to = directoryAirportCode(explicit[2]!);
    if (from && to && from !== to) return { from, to };
  }

  // No usable "from … to …" shape: fall back to the directory's own places,
  // longest name first so "Port Harcourt" is not read as two places.
  const lower = cleaned.toLowerCase();
  const names = Object.entries(PLACE_ALIASES).sort((a, b) => b[0].length - a[0].length);
  const found: string[] = [];
  for (const [name, code] of names) {
    if (found.length === 2) break;
    if (!new RegExp(`(^|[^\\p{L}])${name}([^\\p{L}]|$)`, 'u').test(lower)) continue;
    if (!found.includes(code)) found.push(code);
  }
  if (found.length !== 2) return undefined;
  return { from: found[0]!, to: found[1]! };
}

export interface RouteLookup {
  ok: boolean;
  reason?: 'missing_place' | 'unknown_place' | 'same_place';
  detail?: string;
  from?: { code: string; city: string; country: string };
  to?: { code: string; city: string; country: string };
  fact?: AirlineRouteFact;
  carriers?: AirlineProfile[];
  /** Every Nigerian carrier in the directory, offered when the pair is unlisted. */
  fallbackCarriers?: AirlineProfile[];
}

/**
 * What the directory knows about one city pair. This is the only place the desk
 * says "the only carrier here is …", and it says it with the date it last looked.
 */
export function lookupRoute(origin: string, destination: string): RouteLookup {
  const fromCode = directoryAirportCode(origin);
  const toCode = directoryAirportCode(destination);
  if (!fromCode || !toCode) {
    const missing = [!fromCode ? origin.trim() : null, !toCode ? destination.trim() : null]
      .filter((name): name is string => Boolean(name))
      .join('" and "');
    return {
      ok: false,
      reason: 'unknown_place',
      detail: `"${missing}" is not in this desk's carrier directory. Use an airport code, or ask flights.search — a fare source resolves cities this table does not.`,
    };
  }
  const from = {
    code: fromCode,
    city: DIRECTORY_AIRPORTS[fromCode]!.city,
    country: DIRECTORY_AIRPORTS[fromCode]!.country,
  };
  const to = {
    code: toCode,
    city: DIRECTORY_AIRPORTS[toCode]!.city,
    country: DIRECTORY_AIRPORTS[toCode]!.country,
  };
  if (fromCode === toCode) {
    return {
      ok: false,
      reason: 'same_place',
      detail: `${from.city} (${fromCode}) is both ends of that route.`,
      from,
      to,
    };
  }
  const fact = AIRLINE_ROUTES.find(
    (route) =>
      (route.from === fromCode && route.to === toCode) ||
      (route.from === toCode && route.to === fromCode),
  );
  if (!fact) {
    return {
      ok: true,
      from,
      to,
      carriers: [],
      fallbackCarriers: airlinesInCountry(to.country),
    };
  }
  const carriers = fact.carrierIds
    .map((id) => BY_ID.get(id))
    .filter((airline): airline is AirlineProfile => Boolean(airline));
  return { ok: true, from, to, fact, carriers };
}

/** How many days ago a row was last checked, for the stale-data warning. */
export function directoryAgeDays(verifiedOn: string, now: Date): number {
  const checked = Date.parse(`${verifiedOn}T00:00:00Z`);
  if (Number.isNaN(checked)) return 0;
  return Math.max(0, Math.floor((now.getTime() - checked) / 86_400_000));
}

/**
 * One named carrier with no route attached. Used when a fare source named the
 * carrier but the pair is not in the route table, which is the ordinary case
 * outside the desk's own market: the carrier is knowable worldwide, the desk's
 * opinion about who flies a given pair is not.
 */
export function carrierData(name: string, now: Date): AirlineData | null {
  const airline = findCarrierByName(name);
  if (!airline) {
    return {
      known: false,
      origin: name.trim(),
      destination: '',
      from: null,
      to: null,
      carriers: [],
      listed: false,
      singleCarrier: false,
      staleDays: 0,
      verification: `No carrier named "${name.trim()}" is in this desk's directory. Add it, or ask the traveler to book on the site the fare source named.`,
      caveats: [
        'Directory data, not a fare: no price or seat was checked here. Call flights.search for what a source actually priced.',
        'A carrier missing from a hand-kept table is a gap in the table, not proof it does not exist.',
      ],
      summary: `No carrier named "${name.trim()}" is in this desk's directory.`,
    };
  }
  const staleDays = directoryAgeDays(airline.verifiedOn, now);
  const pay =
    airline.paymentOrder === 'pnr_then_pay'
      ? 'issues a booking reference before payment'
      : airline.paymentOrder === 'pay_at_booking'
        ? 'tickets as part of payment, so there is no unpaid slot to hold'
        : 'has no payment order this desk has verified';
  return {
    known: true,
    origin: airline.name,
    destination: '',
    from: null,
    to: null,
    carriers: [describeAirline(airline)],
    listed: false,
    singleCarrier: false,
    staleDays,
    verification: `Carrier row last checked ${airline.verifiedOn}. No route was matched, so this says nothing about where it flies.`,
    caveats: [
      'Directory data, not a fare: no price or seat was checked here. Call flights.search for what a source actually priced.',
      `Rows were last checked ${staleDays} day${staleDays === 1 ? '' : 's'} ago; airlines change routes and booking terms.`,
      'No route was matched: this carrier\u2019s booking details are not evidence that it serves the traveler\u2019s pair.',
      ...(airline.paymentOrder === 'unverified'
        ? [
            `Payment order is unverified for ${airline.name}. Assume the traveler must pay at the payment step; do not claim a reservation exists.`,
          ]
        : []),
    ],
    summary: `${airline.name}${airline.iata ? ` (${airline.iata})` : ''} books at ${airline.bookingUrl} and ${pay}. Row checked ${airline.verifiedOn}; no route was matched.`,
  };
}

/**
 * Build the traveler-facing answer. The summary never says a seat exists: it
 * names carriers, where to book, and how each one sequences payment.
 */
export function airlineRouteData(
  origin: string,
  destination: string,
  now: Date,
): AirlineData | null {
  const lookup = lookupRoute(origin, destination);
  if (!lookup.ok || !lookup.from || !lookup.to) {
    const detail =
      lookup.detail ??
      'This desk could not read both ends of that route from its carrier directory.';
    return {
      known: false,
      origin: origin.trim(),
      destination: destination.trim(),
      from: null,
      to: null,
      carriers: [],
      listed: false,
      singleCarrier: false,
      staleDays: 0,
      verification: detail,
      caveats: [
        'Directory data, not a fare: no price or seat was checked here. Call flights.search for what a source actually priced.',
        'An unknown place here is a gap in a hand-kept table, not proof the route does not exist.',
      ],
      summary: detail,
    };
  }

  const carriers = lookup.carriers ?? [];
  const fallback = lookup.fallbackCarriers ?? [];
  const listed = Boolean(lookup.fact) && carriers.length > 0;
  const staleDays = Math.max(
    lookup.fact ? directoryAgeDays(lookup.fact.verifiedOn, now) : 0,
    ...carriers.map((airline) => directoryAgeDays(airline.verifiedOn, now)),
  );
  const pair = `${lookup.from.code}–${lookup.to.code}`;

  const caveats = [
    'Directory data, not a fare: no price or seat was checked here. Call flights.search for what a source actually priced.',
    `Rows were last checked ${staleDays} day${staleDays === 1 ? '' : 's'} ago; airlines change routes and booking terms.`,
  ];
  if (listed && lookup.fact?.confidence === 'single') {
    caveats.push(
      `Only one carrier is listed on ${pair}. That is what this desk last saw, not proof no one else flies it — a fare search can contradict it.`,
    );
  }
  if (!listed) {
    caveats.push(
      `${pair} is not in this desk's route table. Absence here is not "no service": it is a gap in a hand-kept list.`,
    );
  }
  const unverified = carriers.filter((airline) => airline.paymentOrder === 'unverified');
  if (unverified.length) {
    caveats.push(
      `Payment order is unverified for ${unverified.map((airline) => airline.name).join(', ')}. Assume the traveler must pay at the payment step; do not claim a reservation exists.`,
    );
  }

  const who =
    carriers.length === 1
      ? `${carriers[0]!.name} is the only carrier that flies`
      : `${carriers.map((airline) => airline.name).join(', ')} fly`;
  const summary = listed
    ? `${who} ${lookup.from.city}–${lookup.to.city} (${pair}) in this desk's directory, checked ${lookup.fact!.verifiedOn}. Availability was not checked.`
    : `No carrier is listed for ${lookup.from.city}–${lookup.to.city} (${pair}) in this desk's directory. That is a gap in a hand-kept list, not proof of no service.`;

  return {
    known: true,
    origin: lookup.from.city,
    destination: lookup.to.city,
    from: lookup.from,
    to: lookup.to,
    carriers: carriers.map(describeAirline),
    fallbackCarriers: listed ? [] : fallback.slice(0, 6).map(describeAirline),
    listed,
    singleCarrier: listed && lookup.fact?.confidence === 'single',
    staleDays,
    verification: listed
      ? `Route row last checked ${lookup.fact!.verifiedOn}; carrier rows carry their own dates.`
      : 'Route not listed; carrier rows below are country-level, not route proof.',
    caveats,
    summary,
  };
}

function describeAirline(airline: AirlineProfile): AirlineData['carriers'][number] {
  return {
    id: airline.id,
    name: airline.name,
    iata: airline.iata,
    country: airline.country,
    scope: airline.scope,
    hubs: airline.hubs,
    bookingUrl: airline.bookingUrl,
    channels: airline.channels,
    paymentOrder: airline.paymentOrder,
    evidence: airline.evidence ?? null,
    bookingSteps: airline.bookingSteps ?? [],
    manageBooking: airline.manageBooking ?? null,
    contact: airline.contact ?? null,
    verifiedOn: airline.verifiedOn,
    notes: airline.notes ?? null,
  };
}

import type { DestinationProfile } from './types';

/**
 * Desk cards are original short notes, not a guide book.
 * Prices are round USD ceilings for one person on the ground, flights excluded.
 */
export const DESTINATIONS: DestinationProfile[] = [
  {
    id: 'lisbon',
    name: 'Lisbon',
    country: 'Portugal',
    aliases: ['lisboa'],
    climate: 'temperate',
    bestMonths: 'April–June and September–October',
    coordinates: { lat: 38.7223, lon: -9.1393 },
    dailyUsd: { lean: 110, comfortable: 180, splurge: 320 },
    neighborhoods: [
      {
        name: 'Alfama',
        note: 'Hills, miradouros, and short walks if you pack light shoes.',
      },
      { name: 'Príncipe Real', note: 'Flatter, easier with a bag, good coffee radius.' },
      {
        name: 'Alcântara',
        note: 'LX Factory by day. Quieter if you stay off the main yard.',
      },
    ],
    food: [
      'grilled fish',
      'a pastel de nata that is still warm',
      'a bifana only if you are hungry',
    ],
    transit:
      'Tram 28 is a ride, not a plan. Walk the ridges and use the metro for the river.',
    packingNotes: [
      'cobbles punish thin soles',
      'a light layer for the river wind after dark',
    ],
    themes: [
      {
        title: 'Alfama without the loop',
        summary:
          'Climb once, then stay high. Viewpoints, a church courtyard, and an early dinner.',
        places: [
          'Miradouro da Senhora do Monte',
          'São Vicente de Fora',
          'a grill in Alfama',
        ],
      },
      {
        title: 'Chiado to the river',
        summary:
          'Bookshops, a short museum, then down to the water before the cruise crowds thicken.',
        places: ['Livraria Bertrand', 'Praça do Comércio', 'Ribeira das Naus'],
      },
      {
        title: 'Belém, then stop',
        summary:
          'One monastery, one pastry, one stretch of river. Do not add a third neighborhood.',
        places: ['Jerónimos cloister', 'a pastelaria in Belém', 'the river path'],
      },
      {
        title: 'A flat evening in Príncipe Real',
        summary: 'Garden, wine, and a short walk home. Use this day if your legs are done.',
        places: ['Jardim do Príncipe Real', 'a wine bar nearby', 'Embaixada courtyard'],
      },
    ],
  },
  {
    id: 'kyoto',
    name: 'Kyoto',
    country: 'Japan',
    aliases: [],
    climate: 'variable',
    bestMonths: 'late March–April and November',
    coordinates: { lat: 35.0116, lon: 135.7681 },
    dailyUsd: { lean: 130, comfortable: 210, splurge: 380 },
    neighborhoods: [
      { name: 'Higashiyama', note: 'Temple density. Go at opening, not at 11.' },
      {
        name: 'Downtown',
        note: 'Station, department-store food floors, easy rain backup.',
      },
      {
        name: 'Arashiyama',
        note: 'A half day. The bamboo path is short; the river is the point.',
      },
    ],
    food: [
      'tofu set near a temple',
      'a kaiten sushi that is not on a poster',
      'matcha only once',
    ],
    transit: 'Buses cover the east. The subway is for crossing town. IC card from day one.',
    packingNotes: [
      'temple floors mean shoes come off',
      'a compact umbrella lives in the bag',
    ],
    themes: [
      {
        title: 'East side at opening',
        summary:
          'One temple complex done slowly, then a lane for lunch. Leave before the tour buses settle.',
        places: ['Kiyomizu approach', 'Sannen-zaka', 'a tofu lunch'],
      },
      {
        title: 'Philosopher path, lightly',
        summary: 'Walk the canal, pick one shrine, sit down. This is not a checklist day.',
        places: ['Path along the canal', 'Ginkaku-ji gate', 'a coffee stop in Hyakumanben'],
      },
      {
        title: 'Arashiyama half day',
        summary:
          'Morning river, bamboo if the path is moving, then back to town before dusk.',
        places: ['Katsura riverbank', 'bamboo grove edge', 'a station lunch'],
      },
      {
        title: 'Rain plan downtown',
        summary:
          'Market, a small museum, and the station food floor. Kyoto rewards an indoor day.',
        places: ['Nishiki Market', 'a downtown museum', 'Kyoto Station food floor'],
      },
    ],
  },
  {
    id: 'mexico-city',
    name: 'Mexico City',
    country: 'Mexico',
    aliases: ['cdmx', 'ciudad de mexico', 'mexico df'],
    climate: 'temperate',
    bestMonths: 'November–April, mornings are clearer',
    coordinates: { lat: 19.4326, lon: -99.1332 },
    dailyUsd: { lean: 70, comfortable: 130, splurge: 240 },
    neighborhoods: [
      { name: 'Roma Norte', note: 'Walkable base. Parks, bookshops, long lunches.' },
      {
        name: 'Centro',
        note: 'One morning. Altitude plus crowds. Leave by early afternoon.',
      },
      { name: 'Coyoacán', note: 'A separate half day, not a detour between meetings.' },
    ],
    food: [
      'a market comida corrida',
      'tacos al pastor after 7',
      'fruit from a cup, not a buffet',
    ],
    transit: 'Metro and walking inside a neighborhood. Ride-hail between them after dark.',
    packingNotes: ['the altitude is the packing item people forget', 'a layer for evening'],
    themes: [
      {
        title: 'Roma on foot',
        summary:
          'Park, a long lunch, one gallery. Let the city arrive before you cross it.',
        places: ['Parque México', 'a Roma lunch counter', 'a small gallery'],
      },
      {
        title: 'Centro, then out',
        summary:
          'Zócalo and one museum. Hydrate. Do not stack Chapultepec on the same day.',
        places: ['Zócalo edge', 'a centro museum', 'a juice stand'],
      },
      {
        title: 'Coyoacán afternoon',
        summary:
          'Arrive after lunch, walk the plaza, leave before the evening traffic hardens.',
        places: ['Jardin Centenario', 'a courtyard cafe', 'the market edge'],
      },
      {
        title: 'Chapultepec, one wing',
        summary: 'Pick a single museum wing. The park is the rest of the day.',
        places: ['One museum wing', 'the park path', 'an early dinner back in Roma'],
      },
    ],
  },
  {
    id: 'reykjavik',
    name: 'Reykjavik',
    country: 'Iceland',
    aliases: ['reykjavík'],
    climate: 'cold',
    bestMonths: 'June–August for light, February for a short city stay',
    coordinates: { lat: 64.1466, lon: -21.9426 },
    dailyUsd: { lean: 180, comfortable: 280, splurge: 460 },
    neighborhoods: [
      { name: 'Downtown', note: 'The walkable city is small. Stay inside it.' },
      { name: 'Harbor', note: 'Wind is the attraction and the problem.' },
      { name: 'Grandakari', note: 'Quieter sleep, still a short walk in.' },
    ],
    food: ['lamb soup', 'a bakery bun', 'hot dog only as a joke you actually want'],
    transit: 'Walk the center. A pool visit is a bus or a short ride, and it is worth it.',
    packingNotes: ['windproof shell over warmth', 'pool towel if you hate renting one'],
    themes: [
      {
        title: 'Harbor and hallgrímskirkja',
        summary:
          'One church, one harbor loop, then inside. The wind decides the afternoon.',
        places: ['Hallgrímskirkja', 'harbor path', 'a soup lunch'],
      },
      {
        title: 'Pool morning',
        summary: 'Geothermal soak first. The city looks better after you are warm.',
        places: ['A public pool', 'a bakery', 'a bookstore'],
      },
      {
        title: 'One museum, long coffee',
        summary: 'Pick a single indoor exhibit. Iceland punishes stacked attractions.',
        places: ['One museum', 'a long coffee', 'an early dinner'],
      },
      {
        title: 'Weather hold',
        summary:
          'If the day is horizontal rain, stay in town. Do not force a ring road fantasy.',
        places: ['Indoor market', 'a wool shop window', 'the pool again'],
      },
    ],
  },
  {
    id: 'rome',
    name: 'Rome',
    country: 'Italy',
    aliases: ['roma'],
    climate: 'temperate',
    bestMonths: 'April–June and late September–October',
    coordinates: { lat: 41.9028, lon: 12.4964 },
    dailyUsd: { lean: 130, comfortable: 200, splurge: 360 },
    neighborhoods: [
      { name: 'Monti', note: 'Central without sleeping on a ruin.' },
      { name: 'Trastevere', note: 'Evenings. Days are better across the river.' },
      { name: 'Prati', note: 'Calmer base if the Vatican is the point of the trip.' },
    ],
    food: [
      'a sit-down lunch, not a standing tourist slice',
      'artichokes in season',
      'espresso at the bar',
    ],
    transit:
      'Walk inside the center. Metro for the Vatican and the station. Drink water from the nasoni.',
    packingNotes: ['scarf for church shoulders', 'shoes that survive sampietrini'],
    themes: [
      {
        title: 'Ancient core, one ticket',
        summary: 'Forum or Colosseum, not both at full pace. Then a neighborhood lunch.',
        places: ['One ancient ticket', 'Monti lunch', 'a fountain you sit beside'],
      },
      {
        title: 'Vatican, early',
        summary:
          'Be there at opening. Leave when you stop seeing. Prati for a quiet hour after.',
        places: ['Vatican museums or the basilica', 'Prati cafe', 'the river walk'],
      },
      {
        title: 'Trastevere after four',
        summary:
          'Morning is a market or a church. Evening is the point. Book dinner or eat early.',
        places: ['A morning church', 'Janiculum view', 'Trastevere dinner'],
      },
      {
        title: 'A park and a gallery',
        summary: 'Villa Borghese or one gallery. Rome is better when a day has shade.',
        places: ['A shaded park', 'one gallery', 'gelato on the walk home'],
      },
    ],
  },
  {
    id: 'bangkok',
    name: 'Bangkok',
    country: 'Thailand',
    aliases: ['krung thep'],
    climate: 'hot-humid',
    bestMonths: 'December–February',
    coordinates: { lat: 13.7563, lon: 100.5018 },
    dailyUsd: { lean: 50, comfortable: 95, splurge: 180 },
    neighborhoods: [
      {
        name: 'Bang Rak',
        note: 'River access and walkable blocks if you pick the right street.',
      },
      { name: 'Ari', note: 'Calmer sleep, cafes, a skytrain ride from the temples.' },
      { name: 'Chinatown', note: 'A night, not a base, unless you like the noise.' },
    ],
    food: [
      'boat noodles',
      'a mango sticky rice you did not plan',
      'grill smoke after dark',
    ],
    transit:
      'BTS and boats beat taxis at rush hour. Temples cluster; do not cross the city twice.',
    packingNotes: [
      'breathable clothes',
      'a scarf for temple shoulders',
      'sandals that can get wet',
    ],
    themes: [
      {
        title: 'River temples, morning only',
        summary:
          'Two river sites, then out of the sun. The afternoon is a cafe with air conditioning.',
        places: ['A river temple', 'the boat pier', 'a shaded lunch'],
      },
      {
        title: 'Chinatown at dusk',
        summary: 'Arrive late. Eat while walking. Leave before you are only shuffling.',
        places: ['A lane of stalls', 'a shophouse dinner', 'the river edge'],
      },
      {
        title: 'Ari, on purpose',
        summary: 'A local day. Market, coffee, one small gallery. No temple quota.',
        places: ['Ari market', 'a cafe', 'a neighborhood park'],
      },
      {
        title: 'Heat protocol',
        summary:
          'Museums and malls are not a failure. Bangkok in the afternoon is an indoor city.',
        places: ['One museum', 'a long cold drink', 'a massage only if you want one'],
      },
    ],
  },
  {
    id: 'marrakech',
    name: 'Marrakech',
    country: 'Morocco',
    aliases: ['marrakesh'],
    climate: 'hot-dry',
    bestMonths: 'March–May and October–November',
    coordinates: { lat: 31.6295, lon: -7.9811 },
    dailyUsd: { lean: 70, comfortable: 120, splurge: 240 },
    neighborhoods: [
      {
        name: 'Medina',
        note: 'Stay near a landmark you can find at night. The lanes repeat.',
      },
      { name: 'Gueliz', note: 'Easier streets, useful reset day.' },
      {
        name: 'Palmeraie',
        note: 'Quiet, and a ride from everything. Only if that is the point.',
      },
    ],
    food: [
      'a slow tagine',
      'orange juice you watch being pressed',
      'bread from the communal oven',
    ],
    transit:
      'Walk the medina by day. Agree the taxi fare before you sit, or use a metered car in Gueliz.',
    packingNotes: [
      'sun layer',
      'modest clothing for religious sites',
      'shoes you can slip off',
    ],
    themes: [
      {
        title: 'Medina orientation',
        summary: 'Learn one route from your door to a square. That is the whole morning.',
        places: [
          'Your door to Jemaa el-Fna',
          'a spice stall you do not have to buy from',
          'a riad lunch',
        ],
      },
      {
        title: 'One garden',
        summary: 'Secret garden or a larger park. Shade is the itinerary.',
        places: ['A garden', 'mint tea', 'a short souk loop'],
      },
      {
        title: 'Gueliz reset',
        summary:
          'Wide streets, a gallery, a long coffee. Use this if the medina has worn you out.',
        places: ['A Gueliz gallery', 'a cafe', 'a bookstore'],
      },
      {
        title: 'Evening square, briefly',
        summary: 'Go at dusk, eat somewhere seated, leave when the amplifiers start.',
        places: [
          'Jemaa el-Fna edge',
          'a seated dinner',
          'the walk home you already learned',
        ],
      },
    ],
  },
  {
    id: 'cape-town',
    name: 'Cape Town',
    country: 'South Africa',
    aliases: ['capetown'],
    climate: 'variable',
    bestMonths: 'November–March for dry summer, avoid assuming winter is mild',
    coordinates: { lat: -33.9249, lon: 18.4241 },
    dailyUsd: { lean: 80, comfortable: 150, splurge: 280 },
    neighborhoods: [
      { name: 'City Bowl', note: 'Walkable core, wind in the afternoon.' },
      { name: 'Woodstock', note: 'Food and warehouses. Go by day.' },
      {
        name: 'Sea Point',
        note: 'Promenade walks. A good base if you want the ocean daily.',
      },
    ],
    food: [
      'a bakery breakfast',
      'braai only if someone local is hosting',
      'seafood you can see cooked',
    ],
    transit:
      'Do not assume a car-free peninsula day. The city bowl can be walked; the coast usually cannot.',
    packingNotes: ['a wind shell', 'layers, the mountain and the waterfront disagree'],
    themes: [
      {
        title: 'City and a company garden',
        summary:
          'Museum or gallery, then the garden. Table Mountain only if the tablecloth is off the summit.',
        places: ['A downtown museum', 'Company Garden', 'a long lunch'],
      },
      {
        title: 'Sea Point promenade',
        summary: 'Walk until you are bored, then swim or sit. This is a recovery day.',
        places: ['Promenade', 'a tidal pool if the flags allow', 'sunset from the front'],
      },
      {
        title: 'Woodstock kitchens',
        summary: 'One market hall, one neighborhood. Do not bolt it to a peninsula drive.',
        places: ['A market hall', 'a side street gallery', 'coffee'],
      },
      {
        title: 'Mountain or not',
        summary:
          'Check the wind before you commit. A cancelled summit is a better day than a miserable one.',
        places: [
          'Lower slopes or a substitute beach',
          'a viewpoint you can drive to',
          'early dinner',
        ],
      },
    ],
  },
  {
    id: 'seoul',
    name: 'Seoul',
    country: 'South Korea',
    aliases: [],
    climate: 'variable',
    bestMonths: 'April–June and September–early November',
    coordinates: { lat: 37.5665, lon: 126.978 },
    dailyUsd: { lean: 90, comfortable: 160, splurge: 280 },
    neighborhoods: [
      {
        name: 'Ikseon-dong',
        note: 'Hanok lanes. Pretty, and small. Do not make it the whole trip.',
      },
      { name: 'Seongsu', note: 'Warehouses and coffee. Easy subway.' },
      { name: 'Jongno', note: 'Palaces in the morning, before the school groups.' },
    ],
    food: [
      'a barbecue you do not rush',
      'kimbap from a real shop',
      'cold noodles if the day is hot',
    ],
    transit:
      'T-money card. The subway is the plan. Palaces cluster in the north; do not recross the river twice.',
    packingNotes: ['comfortable walking shoes', 'a layer for aggressive air conditioning'],
    themes: [
      {
        title: 'One palace, done',
        summary:
          'Arrive at opening. One palace is enough. The neighborhood around it is the second half.',
        places: ['A palace', 'a hanok lane', 'a noodle lunch'],
      },
      {
        title: 'Seongsu afternoon',
        summary:
          'Coffee, a small shop, the stream if you want air. Skip the pop-up if the line is an hour.',
        places: ['Seongsu side street', 'a bakery', 'the stream path'],
      },
      {
        title: 'Market evening',
        summary:
          'Gwangjang or a neighborhood market. Eat in courses while standing, then sit for one dish.',
        places: ['A market alley', 'one seated dish', 'a short walk to the subway'],
      },
      {
        title: 'Han river pause',
        summary: 'The city is intense. A river park hour is not wasted time.',
        places: [
          'A river park',
          'convenience-store picnic',
          'back before the last interesting train',
        ],
      },
    ],
  },
  {
    id: 'barcelona',
    name: 'Barcelona',
    country: 'Spain',
    aliases: ['barna'],
    climate: 'temperate',
    bestMonths: 'May–June and September',
    coordinates: { lat: 41.3874, lon: 2.1686 },
    dailyUsd: { lean: 120, comfortable: 190, splurge: 340 },
    neighborhoods: [
      { name: 'Gràcia', note: 'Squares, and a village pace above the grid.' },
      { name: 'El Born', note: 'Pretty and busy. Sleep one street back.' },
      { name: 'Poblenou', note: 'Beach access without the rambla density.' },
    ],
    food: [
      'a vermut hour',
      'tomato bread',
      'a seafood rice you share, not a rushed paella at 7',
    ],
    transit:
      'Metro plus walking the grid. Pickpockets are a practical fact in the tourist spine, not a vibe.',
    packingNotes: ['a light scarf', 'shoes for stone and sand if you mix beach and city'],
    themes: [
      {
        title: 'Gràcia squares',
        summary: 'No monument quota. Coffee, a market, a plaza at dusk.',
        places: ['A Gràcia plaza', 'a market', 'vermut'],
      },
      {
        title: 'Gothic in the morning',
        summary: 'Be early. One church or the Picasso trail, then leave the rambla.',
        places: ['A morning church', 'a side-street bakery', 'the Born edge'],
      },
      {
        title: 'Beach as a half day',
        summary: 'Swim, then a neighborhood that is not the beach bar strip.',
        places: ['A swim', 'a shaded lunch', 'Poblenou streets'],
      },
      {
        title: 'One Gaudí, only one',
        summary:
          'Book the timed entry and do not add a second mosaic. The city grid is the other half.',
        places: [
          'One timed modernist site',
          'a long lunch',
          'a rooftop only if it is free',
        ],
      },
    ],
  },
  {
    id: 'cusco',
    name: 'Cusco',
    country: 'Peru',
    aliases: ['cuzco'],
    climate: 'alpine',
    bestMonths: 'May–September for drier trails',
    coordinates: { lat: -13.532, lon: -71.9675 },
    dailyUsd: { lean: 45, comfortable: 85, splurge: 160 },
    neighborhoods: [
      { name: 'San Blas', note: 'Hills. Lovely, and a bad idea on hour one at altitude.' },
      { name: 'Plaza area', note: 'Easier first night. You can climb tomorrow.' },
      {
        name: 'San Pedro',
        note: 'Market breakfasts. Go hungry, leave before you are tired.',
      },
    ],
    food: ['a simple soup', 'coca tea as a comfort, not a cure', 'fruit you can peel'],
    transit:
      'Walk the center once you are steady. Taxis for hills on day one. Altitude is the constraint, not distance.',
    packingNotes: [
      'layers for sun and a cold evening',
      'any personal altitude medication you already use, ask a clinician before the trip',
    ],
    themes: [
      {
        title: 'Arrival, almost nothing',
        summary:
          'Plaza, water, an early night. Ambition on day one is how people ruin day two.',
        places: ['Plaza de Armas edge', 'a light dinner', 'the hotel stairs, once'],
      },
      {
        title: 'San Pedro and a short walk',
        summary:
          'Market, one museum, stop when your head says so. There is no prize for finishing.',
        places: ['San Pedro market', 'a small museum', 'a courtyard rest'],
      },
      {
        title: 'San Blas slowly',
        summary: 'Climb, look, come down a different lane. One viewpoint is the day.',
        places: ['A San Blas lane', 'one viewpoint', 'a long lunch'],
      },
      {
        title: 'Day trip only if you slept',
        summary:
          'Sacred Valley or a ruin only after a solid night. Otherwise repeat the easy city day.',
        places: ['A nearby ruin or a second easy neighborhood', 'water', 'early dinner'],
      },
    ],
  },
  {
    id: 'vancouver',
    name: 'Vancouver',
    country: 'Canada',
    aliases: [],
    climate: 'temperate',
    bestMonths: 'July–September',
    coordinates: { lat: 49.2827, lon: -123.1207 },
    dailyUsd: { lean: 130, comfortable: 200, splurge: 340 },
    neighborhoods: [
      { name: 'Mount Pleasant', note: 'Cafes and a walkable base south of downtown.' },
      { name: 'Gastown', note: 'A few blocks, not a whole day.' },
      { name: 'Kitsilano', note: 'Beach and a slower evening.' },
    ],
    food: [
      'a bagel or a bao, then a real dinner',
      'seafood you did not eat on a pier tour',
      'coffee as a weather strategy',
    ],
    transit: 'Compass card. Seawall is the best transit of all if the rain is light.',
    packingNotes: [
      'a rain shell even in July',
      'layers; indoor heat and marine air disagree',
    ],
    themes: [
      {
        title: 'Seawall, one direction',
        summary: 'Pick a direction and a turnaround. Do not circumnavigate out of pride.',
        places: ['Seawall segment', 'a lookout', 'a warm lunch'],
      },
      {
        title: 'Granville Island morning',
        summary: 'Market early, then a neighborhood that is not the market.',
        places: ['Public market', 'a studio window', 'Mount Pleasant afternoon'],
      },
      {
        title: 'Stanley Park trees',
        summary: 'Inside the park, not only the rim. Leave before you are cold.',
        places: ['A forest trail', 'a beach edge', 'the bus back'],
      },
      {
        title: 'Rain museum day',
        summary:
          'One museum, a long coffee, an early dinner. Vancouver rain is not a moral failure.',
        places: ['One museum', 'a cafe', 'a neighborhood dinner'],
      },
    ],
  },
  {
    id: 'istanbul',
    name: 'Istanbul',
    country: 'Türkiye',
    aliases: ['constantinople'],
    climate: 'variable',
    bestMonths: 'April–June and September–October',
    coordinates: { lat: 41.0082, lon: 28.9784 },
    dailyUsd: { lean: 70, comfortable: 130, splurge: 240 },
    neighborhoods: [
      { name: 'Karaköy', note: 'Ferry access, and a flatter base than the old hills.' },
      {
        name: 'Sultanahmet',
        note: 'Monuments. Sleep here only if dawn visits are the trip.',
      },
      { name: 'Kadıköy', note: 'The Asian side reset. Markets, fewer postcard pauses.' },
    ],
    food: [
      'a breakfast that takes an hour',
      'fish sandwich as a ferry snack, not dinner',
      'grill smoke in a side street',
    ],
    transit:
      'Istanbulkart. Ferries are part of the plan, not a novelty. Do not cross the city more than twice a day.',
    packingNotes: [
      'a scarf for mosques',
      'shoes for steep stone',
      'a layer for the ferry wind',
    ],
    themes: [
      {
        title: 'One mosque, one museum',
        summary: 'The old peninsula punishes a third ticket. Tea between them.',
        places: ['One major mosque', 'one museum', 'a tea garden'],
      },
      {
        title: 'Ferry to Kadıköy',
        summary:
          'Cross the water, eat in the market, come back before you are navigating tired.',
        places: ['A ferry', 'Kadıköy market', 'the return boat'],
      },
      {
        title: 'Karaköy and the water',
        summary: 'Galleries or a hammam only if you booked it. Otherwise walk the shore.',
        places: ['Karaköy streets', 'the shore path', 'a bakery'],
      },
      {
        title: 'Bazaar with an exit',
        summary:
          'Enter with one item in mind and a door you will use to leave. Then a neighborhood that is quiet.',
        places: ['A short bazaar pass', 'a known exit', 'lunch away from the lanes'],
      },
    ],
  },
  {
    id: 'porto',
    name: 'Porto',
    country: 'Portugal',
    aliases: ['oporto'],
    climate: 'temperate',
    bestMonths: 'May–June and September',
    coordinates: { lat: 41.1579, lon: -8.6291 },
    dailyUsd: { lean: 100, comfortable: 165, splurge: 280 },
    neighborhoods: [
      { name: 'Cedofeita', note: 'Flatter than the ribeira, better sleep.' },
      {
        name: 'Ribeira',
        note: 'The postcard. Visit, do not necessarily sleep in the noise.',
      },
      { name: 'Foz', note: 'Ocean air. A tram or a taxi, then a walk.' },
    ],
    food: [
      'a francesinha only if you are actually hungry',
      'grilled fish',
      'a port tasting, not six',
    ],
    transit:
      'Walk the center. The river crossing is a bridge or a boat, once. Hills are the tax.',
    packingNotes: ['grippy shoes', 'a light rain layer most months'],
    themes: [
      {
        title: 'River once',
        summary:
          'Down to the ribeira, across if you want a cellar, back up before your knees file a complaint.',
        places: ['Ribeira edge', 'a single cellar', 'the walk up'],
      },
      {
        title: 'Bookshops and a miradouro',
        summary: 'One famous bookshop if the line is short. A viewpoint. A long lunch.',
        places: ['A bookshop', 'a viewpoint', 'lunch in Cedofeita'],
      },
      {
        title: 'Foz air',
        summary: 'Ocean, a castle park, an early dinner back in town.',
        places: ['Foz promenade', 'a park', 'the tram or a ride home'],
      },
      {
        title: 'Tile and market morning',
        summary:
          'A station or a church for the tiles, then a market. Stop while you still like tiles.',
        places: ['A tiled hall', 'a market', 'coffee'],
      },
    ],
  },
];

export function findDestination(text: string): DestinationProfile | undefined {
  const haystack = text.toLowerCase();
  const ranked = [...DESTINATIONS].sort(
    (a, b) =>
      b.name.length - a.name.length ||
      b.aliases.join(' ').length - a.aliases.join(' ').length,
  );
  return ranked.find((destination) => {
    const names = [destination.name, ...destination.aliases];
    return names.some((name) => haystack.includes(name.toLowerCase()));
  });
}

export function findDestinationByName(name: string): DestinationProfile | undefined {
  return (
    findDestination(name) ?? DESTINATIONS.find((item) => item.id === name.toLowerCase())
  );
}

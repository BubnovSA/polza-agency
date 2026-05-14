/**
 * ICP (Ideal Customer Profile) filter for Polza Agency.
 *
 * Two stages:
 *   1. nameFilter(company)   — fast pre-filter by company name alone (before site parsing)
 *   2. fullFilter(company)   — full filter using name + description + signal (after site parsing)
 *
 * Target: B2B companies in Russia, 10-250 employees, active sales motion.
 * Exclude: B2C retail, giants, real-estate for individuals, staffing agencies,
 *          fitness/restaurants/hotels, medical clinics, tobacco/vape B2C.
 */

// ─── Exclusion rules ─────────────────────────────────────────────────────────

/**
 * Keywords that, when found in ANY of the checked fields, signal a non-ICP company.
 * Checked against lowercase concatenation of company_name + description + signal.
 */
const EXCLUDE_KEYWORDS = [
  // B2C retail / FMCG
  'супермаркет', 'гипермаркет', 'spar', 'ашан', 'пятёрочка', 'магнит',
  'розничн', 'ритейл', 'retail', 'торговля продуктами',

  // Food & beverage
  'ресторан', 'кафе', ' бар ', 'пиццер', 'суши', 'доставка еды',
  'фастфуд', 'fast food', 'кофейн',

  // Fitness / wellness
  'фитнес', 'спорт-клуб', 'тренажёр', 'тренажер', 'gym', 'кроссфит',
  'йога', 'бассейн',

  // Hospitality
  'отель', 'гостиниц', 'хостел', 'санатор', 'курорт',

  // Travel B2C
  'туроператор', 'турагентств', 'путевк', 'innatour', 'инна тур',

  // Beauty
  'салон красоты', 'барбершоп', 'парикмахер', 'маникюр', 'косметолог',

  // Legal / financial services for individuals (B2C)
  'банкротство физических лиц', 'помощь гражданам', 'физическим лицам',
  'избавление от долгов', 'долги граждан', 'списание долгов',

  // Healthcare B2C
  'стоматолог', 'медицинская клиника', 'медцентр', 'аптек',

  // Real-estate for individuals
  'агентство недвижимости', 'риелтор', 'риэлтор', 'квартиры', 'новостройк',
  'жилая недвижимость', 'dream realty', 'lake realty', 'метриум',
  'недвижимост', // catches "работает с недвижимостью", "рынок недвижимости"

  // B2C education (tutors, school prep)
  'репетитор', 'для школьников', 'школьник', 'для учеников',
  'подготовка к егэ', 'подготовка к огэ', 'онлайн-уроки для', 'занятия для детей',

  // Staffing / HR agencies (they sell HR, don't buy email-outreach)
  'кадровое агентство', 'кадровый центр', 'рекрутинг', 'рекрутинговое',
  'хедхантинг', 'подбор персонала', 'hr-stalker', 'staffberry',

  // Tobacco / vape B2C
  'электронные сигареты', 'вейп', 'plonq', 'fummo',

  // Doors / windows / building materials for consumers
  'двери прованс', 'окна пвх', 'натяжные потолки',

  // Auto dealers (B2C)
  'автосалон', 'автодилер', 'авто с пробегом',

  // Individual entrepreneurs in irrelevant niches
  'ип бакулин', 'rodinka.recruitment',
];

/**
 * Company name fragments that alone are enough to exclude (fast pre-filter).
 * Keep this list short — only obvious unambiguous B2C names.
 */
const EXCLUDE_NAMES = [
  'spar', 'ашан', 'магнит', 'пятёрочка', 'мираторг', 'суэк', 'century 21',
  'метал профиль', 'металл профиль', 'металлпрофиль',
  'gym-gym', 'спорт-марафон', 'ярославские краски',
  'fummo', 'plonq',
  'iv medical', 'медицинская школа',
  'инна тур',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return the reason string if company should be excluded, or null if it passes.
 * @param {string} text  Lowercased concatenation of fields to check
 * @param {string[]} keywords
 * @returns {string|null}
 */
function matchesExclusion(text, keywords) {
  for (const kw of keywords) {
    if (text.includes(kw)) return kw;
  }
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fast pre-filter: check company name only.
 * Run BEFORE site parsing to avoid wasting requests on obvious B2C.
 *
 * @param {{company_name: string}} company
 * @returns {{pass: boolean, reason: string}}
 */
export function nameFilter(company) {
  const name = company.company_name.toLowerCase();
  const reason = matchesExclusion(name, EXCLUDE_NAMES);
  return reason
    ? { pass: false, reason: `name match: "${reason}"` }
    : { pass: true, reason: '' };
}

/**
 * Full ICP filter: check name + description + signal.
 * Run AFTER site parsing when description is available.
 *
 * @param {{company_name: string, description?: string, signal?: string}} company
 * @returns {{pass: boolean, reason: string}}
 */
export function fullFilter(company) {
  // First re-run name filter (catches anything that slipped through)
  const nameResult = nameFilter(company);
  if (!nameResult.pass) return nameResult;

  const combined = [
    company.company_name,
    company.description || '',
    company.signal || '',
  ].join(' ').toLowerCase();

  const reason = matchesExclusion(combined, EXCLUDE_KEYWORDS);
  return reason
    ? { pass: false, reason: `keyword match: "${reason}"` }
    : { pass: true, reason: '' };
}

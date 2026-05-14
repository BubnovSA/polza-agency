import 'dotenv/config';
import { collectFromHH, getCompanySiteFromHH } from './src/parsers/hh.js';
import { collectFromRuward } from './src/parsers/ruward.js';
import { parseSite, normaliseUrl } from './src/parsers/site.js';
import { validateEmail, buildFallbackEmail } from './src/enrichers/email.js';
import { getPersonalization } from './src/enrichers/claude.js';
import { dedupeByName } from './src/utils/dedupe.js';
import { writeLeads } from './src/utils/csv.js';
import { sleep, randomSleep } from './src/utils/sleep.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const HH_QUERIES = [
  'руководитель отдела продаж',
  'менеджер по продажам',
  'коммерческий директор',
  'директор по развитию',
  'head of sales',
];

const _limitArg =
  process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ||
  (process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null) ||
  '100';

// --no-claude: collect data only, skip personalization (for reviewing raw table first)
const NO_CLAUDE = process.argv.includes('--no-claude');

const LIMITS = {
  max_companies: parseInt(_limitArg, 10),
  hh_pages: 5, // 5 queries × 5 pages × ~17 results = ~425 raw → 100 after dedup
};

// Map query text → segment hypothesis
const SEGMENT_MAP = {
  'руководитель отдела продаж': 'Строят отдел продаж',
  'менеджер по продажам':       'Масштабируют продажи',
  'коммерческий директор':      'Реструктуризация продаж',
  'директор по развитию':       'B2B-консалтинг / рост',
  'head of sales':               'IT / SaaS',
};

// ─── Pipeline steps ───────────────────────────────────────────────────────────

/**
 * Step 1: Collect raw companies from HH.ru + Ruward.
 * @returns {Promise<Array>}
 */
async function step1_collectCompanies() {
  console.log('\n═══ ШАГ 1: Сбор компаний (HH.ru + Ruward) ═══');

  // HH.ru
  const hhRaw = await collectFromHH({
    queries: HH_QUERIES,
    pages: LIMITS.hh_pages,
    area: '1',
  });
  const hhWithSegment = hhRaw.map((c) => ({
    ...c,
    segment: SEGMENT_MAP[c._query] || 'Продажи B2B',
    source: 'hh.ru',
  }));

  // Ruward
  console.log('\n🔍 Ruward.ru рейтинги…');
  const ruwardRaw = await collectFromRuward();

  const all = dedupeByName([...hhWithSegment, ...ruwardRaw]);
  console.log(`\n✅ Итого после дедупликации: ${all.length} уникальных компаний`);

  return all.slice(0, LIMITS.max_companies);
}

/**
 * Step 2: Resolve each company's website via HH employer profile.
 * @param {Array<{hh_employer_url: string}>} companies
 * @returns {Promise<Array>}
 */
async function step2_resolveWebsites(companies) {
  console.log('\n═══ ШАГ 2: Получение сайтов ═══');
  const result = [];

  for (let i = 0; i < companies.length; i++) {
    const c = companies[i];

    // Ruward entries already carry a website — skip HH profile lookup
    if (c.website) {
      console.log(`✅ [${i + 1}/${companies.length}] ${c.company_name} — уже есть сайт (${c.source})`);
      result.push(c);
      continue;
    }

    console.log(`🔍 [${i + 1}/${companies.length}] ${c.company_name} — ищем сайт в HH профиле`);
    const website = await getCompanySiteFromHH(c.hh_employer_url);

    if (!website) console.log(`   ⚠️  Сайт не найден в профиле HH`);

    result.push({ ...c, website: website || null });
    await sleep(1500);
  }

  return result;
}

/**
 * Step 3: Scrape each company site for email and text.
 * @param {Array<{website: string|null}>} companies
 * @returns {Promise<Array>}
 */
async function step3_parseSites(companies) {
  console.log('\n═══ ШАГ 3: Парсинг сайтов компаний ═══');
  const result = [];

  for (let i = 0; i < companies.length; i++) {
    const c = companies[i];
    console.log(`🔍 [${i + 1}/${companies.length}] ${c.company_name} — ${c.website || 'нет сайта'}`);

    const EMPTY_SITE = { email: null, email_source: '', phone: '', description: '', site_text: '', contact_name: '', contact_title: '' };

    if (!c.website) {
      result.push({ ...c, ...EMPTY_SITE });
      continue;
    }

    try {
      const siteData = await parseSite(c.website);
      result.push({ ...c, ...siteData });
      console.log(`   ${siteData.email ? `✅ email: ${siteData.email}` : '⚠️  email не найден'}${siteData.phone ? ` | ☎️  ${siteData.phone}` : ''}`);
      if (siteData.description) console.log(`   📋 ${siteData.description.slice(0, 80)}…`);
    } catch (err) {
      console.log(`   ⚠️  Ошибка парсинга: ${err.message}`);
      result.push({ ...c, ...EMPTY_SITE });
    }

    await randomSleep(1500, 3000);
  }

  return result;
}

/**
 * Step 4: Validate emails; apply info@ fallback when missing.
 * @param {Array<{email: string|null, website: string|null}>} companies
 * @returns {Promise<Array>}
 */
async function step4_validateEmails(companies) {
  console.log('\n═══ ШАГ 4: Валидация email (MX) ═══');
  const result = [];

  for (const c of companies) {
    let { email, email_source, website } = c;

    if (!email && website) {
      email = buildFallbackEmail(normaliseUrl(website));
      email_source = 'угадан';
      console.log(`   💡 Fallback email: ${email}`);
    }

    let email_valid = 'нет';
    if (email) {
      const { valid } = await validateEmail(email);
      email_valid = valid ? 'да' : 'нет';
    }

    result.push({ ...c, email, email_source: email_source || (email ? 'сайт' : ''), email_valid });
  }

  return result;
}

/**
 * Step 5: Generate personalization via Claude API.
 * @param {Array<{company_name, signal, site_text}>} companies
 * @returns {Promise<Array>}
 */
async function step5_personalize(companies) {
  if (NO_CLAUDE) {
    console.log('\n⏭️  ШАГ 5 пропущен (--no-claude). Персонализация будет пустой.');
    return companies.map(c => ({ ...c, personalization: '' }));
  }

  console.log('\n═══ ШАГ 5: Персонализация через Claude ═══');
  const result = [];

  for (let i = 0; i < companies.length; i++) {
    const c = companies[i];
    console.log(`🤖 [${i + 1}/${companies.length}] ${c.company_name}`);

    const personalization = await getPersonalization(c);
    console.log(`   ✅ ${personalization.slice(0, 80)}…`);

    result.push({ ...c, personalization });
    await sleep(300);
  }

  return result;
}

/**
 * Build the final CSV row shape from enriched company data.
 * @param {Object} c  Enriched company object
 * @returns {Object}
 */
function toLeadRow(c) {
  return {
    company_name:    c.company_name    || '',
    website:         c.website         || '',
    description:     c.description     || '',
    email:           c.email           || '',
    email_source:    c.email_source    || '',
    email_valid:     c.email_valid     || 'нет',
    phone:           c.phone           || '',
    contact_name:    c.contact_name    || '',
    contact_title:   c.contact_title   || '',
    signal:          c.signal          || '',
    personalization: c.personalization || '',
    segment:         c.segment         || '',
    source:          c.source || 'hh.ru',
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Polza Outreach — старт пайплайна');
  console.log(`   Лимит компаний: ${LIMITS.max_companies}`);
  console.log(`   Режим: ${NO_CLAUDE ? '📋 только сбор данных (--no-claude)' : '🤖 полный (с персонализацией Claude)'}`);

  if (!NO_CLAUDE && !process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY не задан. Создай .env файл или запусти с --no-claude.');
    process.exit(1);
  }

  let companies = await step1_collectCompanies();

  if (companies.length === 0) {
    console.log('⚠️  Компании не найдены. Проверь подключение к HH.ru.');
    process.exit(0);
  }

  companies = await step2_resolveWebsites(companies);
  // Keep only companies where we found a website
  const withSites = companies.filter((c) => c.website);
  console.log(`\n   Компании с сайтом: ${withSites.length} / ${companies.length}`);

  const withEmails  = await step3_parseSites(withSites);
  const validated   = await step4_validateEmails(withEmails);
  const personalized = await step5_personalize(validated);

  const leads = personalized.map(toLeadRow);
  await writeLeads(leads);

  console.log(`\n🎉 Готово! ${leads.length} лидов записано в output/leads.csv`);
}

main().catch((err) => {
  console.error('❌ Критическая ошибка:', err);
  process.exit(1);
});

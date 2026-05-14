import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { sleep, randomSleep } from '../utils/sleep.js';

const BASE_URL = 'https://hh.ru';

// ─── Anti-detection ───────────────────────────────────────────────────────────

// Rotate across real Chrome UAs to avoid fingerprinting by a single string
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Build a browser-realistic header set for a given URL.
 * Referer mimics navigating from the HH search results page.
 * @param {string} referer
 * @returns {Object}
 */
function buildHeaders(referer = BASE_URL) {
  return {
    'User-Agent': randomUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': referer,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Upgrade-Insecure-Requests': '1',
  };
}

/**
 * Fetch a URL with retry on 429/503 (rate-limited or temporarily unavailable).
 * On first 429: waits 8-12s and retries once.
 * @param {string} url
 * @param {Object} headers
 * @param {number} timeout  ms
 * @returns {Promise<string|null>}
 */
async function fetchWithRetry(url, headers, timeout = 12000) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timer);

      if (res.status === 429 || res.status === 503) {
        if (attempt === 1) {
          const wait = Math.floor(Math.random() * 4000) + 8000; // 8-12s
          console.log(`   ⏳ HH вернул ${res.status}, ждём ${(wait / 1000).toFixed(1)}s и повторяем…`);
          await sleep(wait);
          continue;
        }
        console.log(`   ⚠️  HH ${res.status} после retry, пропускаем`);
        return null;
      }

      if (!res.ok) {
        console.log(`   ⚠️  HH HTTP ${res.status} для ${url}`);
        return null;
      }

      return await res.text();
    } catch (err) {
      if (attempt === 2) {
        console.log(`   ⚠️  HH fetch error: ${err.message}`);
        return null;
      }
    }
  }
  return null;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

/**
 * Fetch one HH search page and extract vacancy cards.
 * @param {string} query   Search text
 * @param {number} page    Zero-based page index
 * @param {string} area    Region: '1'=Moscow, '2'=SPb
 * @returns {Promise<Array<{company_name, hh_employer_url, signal}>>}
 */
async function fetchVacancyPage(query, page, area = '1') {
  const searchUrl =
    `${BASE_URL}/search/vacancy?text=${encodeURIComponent(query)}` +
    `&area=${area}&per_page=20&page=${page}&employment=full`;

  console.log(`🔍 HH страница ${page + 1}: ${searchUrl}`);

  const html = await fetchWithRetry(searchUrl, buildHeaders(BASE_URL + '/search/vacancy'));
  if (!html) return [];

  const $ = cheerio.load(html);
  const results = [];

  $('[data-qa="vacancy-serp__vacancy"]').each((_, card) => {
    const $card = $(card);

    // title selector changed in HH Magritte redesign (2024)
    const titleEl = $card.find('[data-qa="serp-item__title"]');
    // employer-text gives clean name without logo alt-text
    const companyEl = $card.find('[data-qa="vacancy-serp__vacancy-employer-text"]');
    const companyLinkEl = $card.find('[data-qa="vacancy-serp__vacancy-employer"]');

    const company_name = companyEl.text().trim() || companyLinkEl.text().trim();
    const signal = titleEl.text().trim();

    let hh_employer_url = companyLinkEl.attr('href') || '';
    if (hh_employer_url && !hh_employer_url.startsWith('http')) {
      hh_employer_url = BASE_URL + hh_employer_url.split('?')[0];
    }

    if (company_name && signal) {
      results.push({ company_name, hh_employer_url, signal, _query: query });
    }
  });

  console.log(`   → найдено ${results.length} вакансий на странице ${page + 1}`);
  return results;
}

/**
 * Get company site URL from the HH employer profile page.
 * @param {string} employerUrl
 * @returns {Promise<string|null>}
 */
export async function getCompanySiteFromHH(employerUrl) {
  if (!employerUrl) return null;

  const cleanUrl = employerUrl.split('?')[0];
  await randomSleep(1500, 3000);

  const html = await fetchWithRetry(
    cleanUrl,
    buildHeaders('https://hh.ru/search/vacancy')
  );
  if (!html) return null;

  const $ = cheerio.load(html);
  let site =
    $('[data-qa="sidebar-company-site"]').attr('href') ||
    $('a[data-qa*="company-site"]').attr('href') ||
    null;

  if (site && !site.startsWith('http')) site = 'https://' + site;
  return site || null;
}

/**
 * Collect companies from HH.ru across multiple queries and pages.
 * @param {Object} opts
 * @param {string[]} opts.queries
 * @param {number}  opts.pages    Pages per query (default 5)
 * @param {string}  opts.area     Region code (default '1' = Moscow)
 * @returns {Promise<Array<{company_name, hh_employer_url, signal, _query}>>}
 */
export async function collectFromHH({ queries, pages = 5, area = '1' }) {
  const all = [];

  for (const query of queries) {
    console.log(`\n🔍 Запрос: "${query}"`);
    for (let page = 0; page < pages; page++) {
      const results = await fetchVacancyPage(query, page, area);
      all.push(...results);
      if (page < pages - 1) await randomSleep(2000, 4000);
    }
    await randomSleep(2500, 5000); // longer pause between different queries
  }

  return all;
}

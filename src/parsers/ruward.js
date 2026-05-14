import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { sleep } from '../utils/sleep.js';

const BASE_URL = 'https://ruward.ru';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

// Rating category pages + display names for the signal
const CATEGORIES = [
  { path: '/rating/',               label: 'общий рейтинг' },
  { path: '/rating/digital/',       label: 'Digital' },
  { path: '/rating/razrabotka/',    label: 'Разработка' },
  { path: '/rating/seo/',           label: 'SEO' },
  { path: '/rating/kontekst/',      label: 'Контекстная реклама' },
];

/**
 * Parse one Ruward rating page and extract agencies.
 * Selector strategy (as of 2024):
 *   .b-rank-block  → each row in the rating table
 *   .b-rank-block__number       → rank position
 *   .b-rank-block__name a       → agency name + href to agency page
 *   .b-rank-block__site a       → direct link to company site (if present)
 *
 * If selectors return 0 results the function logs a debug dump so you can update them.
 *
 * @param {string} path      e.g. '/rating/digital/'
 * @param {string} label     Category name for the signal string
 * @returns {Promise<Array<{company_name, website, signal, segment, source}>>}
 */
async function fetchCategory(path, label) {
  const url = BASE_URL + path;
  console.log(`🔍 Ruward: ${url}`);

  let html;
  try {
    const res = await fetch(url, { headers: HEADERS, timeout: 12000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    console.log(`⚠️  Ruward fetch error (${path}): ${err.message}`);
    return [];
  }

  const $ = cheerio.load(html);
  const results = [];

  // Primary selectors — update these if the site redesigns
  $('.b-rank-block').each((_, row) => {
    const rankText = $(row).find('.b-rank-block__number').text().trim();
    const rank = parseInt(rankText, 10) || 0;

    const nameEl = $(row).find('.b-rank-block__name a');
    const company_name = nameEl.text().trim();

    // Prefer direct site link; fallback to ruward agency page
    const siteEl = $(row).find('.b-rank-block__site a');
    const website = siteEl.attr('href') || '';

    if (!company_name) return;

    const signal = rank
      ? `Входит в топ-${rank} рейтинга Ruward по направлению «${label}»`
      : `Входит в рейтинг Ruward по направлению «${label}»`;

    results.push({
      company_name,
      website: website.startsWith('http') ? website : '',
      hh_employer_url: '',   // no HH profile for ruward entries
      signal,
      segment: `Ruward / ${label}`,
      source: 'ruward',
    });
  });

  // Debug: if nothing found, print first 600 chars of body so selectors can be updated
  if (results.length === 0) {
    console.log(`⚠️  Ruward (${path}): 0 агентств. Первые 600 символов body для диагностики:`);
    console.log($('body').text().slice(0, 600).replace(/\s+/g, ' '));
  } else {
    console.log(`   → найдено ${results.length} агентств в категории «${label}»`);
  }

  return results;
}

/**
 * Collect agencies from multiple Ruward rating categories.
 * @param {Object} opts
 * @param {string[]} [opts.categories]  Subset of category paths to fetch (default: all)
 * @returns {Promise<Array<{company_name, website, signal, segment, source}>>}
 */
export async function collectFromRuward({ categories } = {}) {
  const targets = categories
    ? CATEGORIES.filter(c => categories.includes(c.path))
    : CATEGORIES;

  const all = [];

  for (const cat of targets) {
    const rows = await fetchCategory(cat.path, cat.label);
    all.push(...rows);
    await sleep(1500);
  }

  return all;
}

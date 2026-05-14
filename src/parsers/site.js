import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { randomSleep } from '../utils/sleep.js';

const SITE_TIMEOUT = 8000;

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
];

/**
 * Build headers for a site request. Referer = the site root (looks like internal navigation).
 * @param {string} siteRoot  e.g. 'https://example.ru'
 * @returns {Object}
 */
function buildHeaders(siteRoot) {
  return {
    'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': siteRoot,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Upgrade-Insecure-Requests': '1',
  };
}

// Sub-pages to try when email not found on the main page
const CONTACT_PATHS = ['/contacts', '/kontakty', '/contact', '/about', '/o-nas', '/o-kompanii'];

// ─── Regex patterns ───────────────────────────────────────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Common junk that matches email regex but isn't a real address
const EMAIL_GARBAGE = ['example', '.png', '.jpg', '.gif', '.svg', 'sentry', 'wixpress', 'yourdomain', 'noreply', '@2x', 'schema.org'];

// Russian phone formats: +7 (999) 123-45-67 / 8-999-123-45-67 / +79991234567
const PHONE_RE = /(\+7|8)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/g;

// Keywords that indicate a paragraph is relevant for Claude context
const SIGNAL_WORDS = ['кейс', 'клиент', 'решени', 'услуг', 'разработ', 'продаж', 'автоматиз', 'интеграц', 'внедрени', 'реализ', 'проект'];

// Selectors for team/contact blocks where ЛПР names appear
const CONTACT_SELECTORS = '[class*="team"], [class*="person"], [class*="staff"], [class*="founder"], [class*="contact"], [class*="about"]';

// ─── Low-level helpers ────────────────────────────────────────────────────────

/**
 * Fetch HTML from a URL with an abort-controller timeout. Returns null on any error.
 * @param {string} url
 * @returns {Promise<string|null>}
 */
/**
 * Fetch HTML from a URL with timeout and realistic headers.
 * siteRoot is used as the Referer to simulate internal navigation.
 * @param {string} url
 * @param {string} [siteRoot]
 * @returns {Promise<string|null>}
 */
async function fetchHtml(url, siteRoot) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SITE_TIMEOUT);
    const res = await fetch(url, {
      headers: buildHeaders(siteRoot || url),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Extract clean email addresses from raw HTML, filtering obvious garbage.
 * @param {string} html
 * @returns {string[]}
 */
function extractEmails(html) {
  const matches = html.match(EMAIL_RE) || [];
  return matches.filter(
    (e) => !EMAIL_GARBAGE.some((g) => e.toLowerCase().includes(g))
  );
}

/**
 * Extract Russian phone numbers from raw HTML. Returns first match or empty string.
 * @param {string} html
 * @returns {string}
 */
function extractPhone(html) {
  const matches = html.match(PHONE_RE) || [];
  // Normalise whitespace in the first match
  return matches[0] ? matches[0].replace(/\s+/g, ' ').trim() : '';
}

/**
 * Read <meta name="description"> or <meta property="og:description">.
 * This is the most reliable one-liner about what a company does.
 * @param {import('cheerio').CheerioAPI} $
 * @returns {string}
 */
function extractMetaDescription($) {
  return (
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    ''
  ).trim();
}

/**
 * Build a focused context string for Claude:
 *   meta description → h1 → paragraphs containing signal keywords
 * Much cheaper and more relevant than raw body text.
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} metaDescription  Already extracted meta description
 * @param {number} maxChars
 * @returns {string}
 */
function buildSiteText($, metaDescription, maxChars = 1200) {
  const parts = [];

  if (metaDescription) parts.push(metaDescription);

  const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim();
  if (h1 && h1.length > 5) parts.push(h1);

  // Collect paragraphs that contain at least one signal word
  $('p, li').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text.length < 40) return;
    if (SIGNAL_WORDS.some((w) => text.toLowerCase().includes(w))) {
      parts.push(text);
    }
  });

  // If no signal paragraphs found, fall back to first visible paragraphs
  if (parts.length <= 2) {
    $('p').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text.length > 60) parts.push(text);
    });
  }

  return [...new Set(parts)].join('\n').slice(0, maxChars);
}

/**
 * Try to find an ЛПР name + title from structured team/contact blocks.
 * Pattern: "Иван Иванов, Генеральный директор"
 * @param {import('cheerio').CheerioAPI} $
 * @returns {{contact_name: string, contact_title: string}}
 */
function extractContact($) {
  let contact_name = '';
  let contact_title = '';

  $(CONTACT_SELECTORS).each((_, el) => {
    if (contact_name) return;
    const block = $(el).text().replace(/\s+/g, ' ').trim();
    const m = block.match(
      /([А-ЯЁA-Z][а-яёa-z]+\s[А-ЯЁA-Z][а-яёa-z]+)[,\s]+(CEO|CTO|CPO|директор|руководитель|founder|основатель|генеральный|президент)/i
    );
    if (m) {
      contact_name = m[1].trim();
      contact_title = m[2].trim();
    }
  });

  return { contact_name, contact_title };
}

// ─── Email search across pages ────────────────────────────────────────────────

/**
 * Fetch the main page and, if no email found, try contact sub-pages.
 * Returns the main page HTML regardless (needed for other extractions).
 * @param {string} baseUrl
 * @returns {Promise<{email: string|null, mainHtml: string|null}>}
 */
/**
 * Fetch the main page then, if no email found, try contact sub-pages.
 * Uses randomised delays between sub-page requests.
 * @param {string} baseUrl
 * @returns {Promise<{email: string|null, mainHtml: string|null}>}
 */
async function findEmail(baseUrl) {
  const mainHtml = await fetchHtml(baseUrl, baseUrl);

  if (!mainHtml) return { email: null, mainHtml: null };

  const emails = extractEmails(mainHtml);
  if (emails.length > 0) return { email: emails[0], mainHtml };

  // Try contact/about sub-pages with random delay (looks like human clicking)
  for (const path of CONTACT_PATHS) {
    await randomSleep(600, 1400);
    const subUrl = baseUrl.replace(/\/$/, '') + path;
    const subHtml = await fetchHtml(subUrl, baseUrl); // Referer = site root
    if (!subHtml) continue;
    const subEmails = extractEmails(subHtml);
    if (subEmails.length > 0) return { email: subEmails[0], mainHtml };
  }

  return { email: null, mainHtml };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Normalise a URL: ensure it has a protocol and no trailing slash.
 * @param {string} url
 * @returns {string}
 */
export function normaliseUrl(url) {
  if (!url) return url;
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url.replace(/\/$/, '');
}

/**
 * Parse a company website and extract all lead-relevant data.
 *
 * Returns:
 *   email        — first real email found, or null
 *   email_source — 'сайт' | '' (empty means not found, fallback applied upstream)
 *   phone        — first Russian phone number, or ''
 *   description  — meta description (what the company does in their own words)
 *   site_text    — focused context for Claude (meta + h1 + signal paragraphs)
 *   contact_name — ЛПР name if detected in team/contacts block
 *   contact_title — ЛПР title
 *
 * @param {string} rawUrl
 * @returns {Promise<Object>}
 */
export async function parseSite(rawUrl) {
  const url = normaliseUrl(rawUrl);
  const { email, mainHtml } = await findEmail(url);

  if (!mainHtml) {
    return {
      email: null,
      email_source: '',
      phone: '',
      description: '',
      site_text: '',
      contact_name: '',
      contact_title: '',
    };
  }

  const $ = cheerio.load(mainHtml);
  const description = extractMetaDescription($);
  const phone = extractPhone(mainHtml);
  const site_text = buildSiteText($, description);
  const { contact_name, contact_title } = extractContact($);

  return {
    email,
    email_source: email ? 'сайт' : '',
    phone,
    description,
    site_text,
    contact_name,
    contact_title,
  };
}

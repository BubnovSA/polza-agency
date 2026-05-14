import dns from 'dns/promises';

const EMAIL_SYNTAX = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

/**
 * Check email syntax with a regex.
 * @param {string} email
 * @returns {boolean}
 */
function isValidSyntax(email) {
  return EMAIL_SYNTAX.test(email);
}

/**
 * Check that the email's domain has at least one MX record.
 * @param {string} email
 * @returns {Promise<boolean>}
 */
async function hasMxRecord(email) {
  const domain = email.split('@')[1];
  try {
    const records = await dns.resolveMx(domain);
    return records.length > 0;
  } catch {
    return false;
  }
}

/**
 * Validate an email address (syntax + MX lookup).
 * @param {string} email
 * @returns {Promise<{valid: boolean}>}
 */
export async function validateEmail(email) {
  if (!email || !isValidSyntax(email)) return { valid: false };
  const valid = await hasMxRecord(email);
  return { valid };
}

/**
 * Build a fallback email from a website URL.
 * Returns info@domain.
 * @param {string} websiteUrl
 * @returns {string}
 */
export function buildFallbackEmail(websiteUrl) {
  try {
    const host = new URL(websiteUrl).hostname.replace(/^www\./, '');
    return `info@${host}`;
  } catch {
    return '';
  }
}

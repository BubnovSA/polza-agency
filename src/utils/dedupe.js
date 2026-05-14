/**
 * Remove duplicate companies by company_name (case-insensitive trim).
 * @param {Array<{company_name: string}>} companies
 * @returns {Array<{company_name: string}>}
 */
export function dedupeByName(companies) {
  const seen = new Set();
  return companies.filter((c) => {
    const key = c.company_name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

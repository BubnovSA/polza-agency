import { createObjectCsvWriter } from 'csv-writer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '../../output/leads.csv');

const COLUMNS = [
  { id: 'company_name',    title: 'company_name' },
  { id: 'website',         title: 'website' },
  { id: 'description',     title: 'description' },
  { id: 'email',           title: 'email' },
  { id: 'email_source',    title: 'email_source' },
  { id: 'email_valid',     title: 'email_valid' },
  { id: 'phone',           title: 'phone' },
  { id: 'contact_name',    title: 'contact_name' },
  { id: 'contact_title',   title: 'contact_title' },
  { id: 'signal',          title: 'signal' },
  { id: 'personalization',  title: 'personalization' },
  { id: 'segment',         title: 'segment' },
  { id: 'source',          title: 'source' },
];

/**
 * Write lead records to output/leads.csv (overwrites on each run).
 * @param {Object[]} leads
 * @returns {Promise<void>}
 */
export async function writeLeads(leads) {
  const writer = createObjectCsvWriter({
    path: OUTPUT_PATH,
    header: COLUMNS,
  });
  await writer.writeRecords(leads);
  console.log(`✅ Записано ${leads.length} строк → ${OUTPUT_PATH}`);
}

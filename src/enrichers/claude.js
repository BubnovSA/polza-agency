import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
// ANTHROPIC_API_KEY is read automatically from process.env

/**
 * Build the personalization prompt for a company.
 * @param {{company_name: string, signal: string, site_text: string}} company
 * @returns {string}
 */
function buildPrompt({ company_name, signal, site_text }) {
  return `Компания: ${company_name}
Сигнал: ${signal}
Текст с сайта: ${(site_text || '').slice(0, 1500)}

Напиши 1-2 предложения персонализации для холодного B2B письма от лица аутрич-агентства.

Требования:
- Используй конкретный факт о компании ИЛИ сигнал из вакансии
- Объясни, почему именно им нужен email-аутрич прямо сейчас
- Запрещено: "ведущая компания", "динамично развивается", "лидер рынка", "активно развивается"
- Запрещено: общие слова без привязки к конкретной ситуации компании
- Только конкретика и логика "сигнал → потребность → решение"

Формат: просто текст, 1-2 предложения, без кавычек и markdown.`;
}

/**
 * Call Claude Haiku to generate personalization for one company.
 * @param {{company_name: string, signal: string, site_text: string}} company
 * @returns {Promise<string>}
 */
async function callClaude(company) {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{ role: 'user', content: buildPrompt(company) }],
  });
  return response.content[0].text.trim();
}

/**
 * Get personalization text, falling back to the signal on Claude error.
 * @param {{company_name: string, signal: string, site_text: string}} company
 * @returns {Promise<string>}
 */
export async function getPersonalization(company) {
  try {
    return await callClaude(company);
  } catch (err) {
    console.log(`⚠️  Claude error (${company.company_name}): ${err.message} — используем сигнал`);
    return company.signal;
  }
}

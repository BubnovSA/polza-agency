import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
// ANTHROPIC_API_KEY is read automatically from process.env

/**
 * Build the personalization prompt for a company.
 * @param {{company_name: string, signal: string, site_text: string}} company
 * @returns {string}
 */
function buildPrompt({ company_name, signal, site_text, description }) {
  const context = description || site_text || '';
  return `Компания: ${company_name}
Чем занимается: ${context.slice(0, 800)}
Сигнал с HH: ${signal}

Напиши персонализацию для холодного B2B письма. Строго 2 предложения, максимум 40 слов суммарно.

Правила:
- Предложение 1: конкретный факт из описания компании — что они делают, кто их клиенты, какой продукт. НЕ упоминай вакансию.
- Предложение 2: одна конкретная причина почему им нужен email-аутрич именно сейчас.
- Запрещено начинать с: "Вижу", "Я вижу", "Это означает", "Понимаю"
- Запрещено: "ведущая компания", "динамично", "лидер рынка", "масштабировать воронку"
- Запрещено: упоминать название вакансии или слово "руководитель"

Формат: просто текст, без кавычек и markdown.`;
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
  const text = response.content[0].text.trim();
  // If Claude couldn't generate (no description, garbled text) — fall back to signal
  if (text.toLowerCase().startsWith('извините') || text.toLowerCase().startsWith('к сожалению')) {
    return null;
  }
  return text;
}

/**
 * Get personalization text, falling back to the signal on Claude error.
 * @param {{company_name: string, signal: string, site_text: string}} company
 * @returns {Promise<string>}
 */
export async function getPersonalization(company) {
  try {
    const result = await callClaude(company);
    return result || company.signal;
  } catch (err) {
    console.log(`⚠️  Claude error (${company.company_name}): ${err.message} — используем сигнал`);
    return company.signal;
  }
}

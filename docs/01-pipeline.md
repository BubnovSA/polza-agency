# 01 — Архитектура пайплайна

## Схема

```
HH.ru (вакансии "менеджер по продажам")
    │
    ├─► название компании
    ├─► ссылка на профиль HH
    └─► сигнал = название вакансии
          │
          ▼
    HH профиль компании
          │
          └─► URL сайта компании
                    │
                    ▼
              Сайт компании
                    │
                    ├─► email (regex)
                    ├─► имя ЛПР (если есть)
                    └─► текст для персонализации
                              │
                              ▼
                        Валидация email
                        (MX-запись домена)
                              │
                              ▼
                         Claude API
                              │
                              ├─► signal (1 предложение)
                              └─► personalization (1-2 предложения)
                                        │
                                        ▼
                                 output/leads.csv
```

---

## Модули

### `src/parsers/hh.js`
**Вход:** поисковый запрос (строка), количество страниц  
**Выход:** массив `{ company_name, hh_url, signal }`  
**Логика:**
- GET `https://hh.ru/search/vacancy?text=...&area=1&per_page=20&page=N`
- cheerio: селектор карточки вакансии → название компании + ссылка + заголовок вакансии
- sleep 2000ms между страницами
- дедупликация по `company_name`

### `src/parsers/site.js`
**Вход:** URL сайта  
**Выход:** `{ email, contact_name, site_text }`  
**Логика:**
- GET главная страница → regex email
- если не найден → GET `/contacts` или `/o-nas` или `/about`
- извлечь первые 1500 символов текста (без HTML тегов)
- timeout: 8000ms

### `src/enrichers/email.js`
**Вход:** email строка  
**Выход:** `{ valid: boolean, source: 'site'|'guessed' }`  
**Логика:**
- синтаксис: regex
- MX-запись: `dns.resolveMx(domain)`
- fallback: `info@domain` с `source: 'guessed'`

### `src/enrichers/claude.js`
**Вход:** `{ company_name, signal, site_text }`  
**Выход:** `{ personalization: string }`  
**Логика:**
- модель: `claude-haiku-4-5-20251001` (дешевле, быстрее)
- max_tokens: 200
- промпт: см. CURSOR_PROMPT.md

---

## Обработка ошибок

| Ситуация | Действие |
|---|---|
| Сайт не открылся | log ⚠️, пропустить, записать без email |
| Email не найден | fallback `info@domain`, `guessed: true` |
| Claude вернул ошибку | записать signal как personalization |
| HH заблокировал | увеличить sleep, retry 1 раз |
| MX не резолвится | `email_valid: false`, не пропускать запись |

---

## Лимиты и задержки

```javascript
const DELAYS = {
  between_hh_pages: 2000,
  between_companies: 2000,
  between_site_requests: 1000,
  site_timeout: 8000,
};

const LIMITS = {
  max_companies: 60,
  hh_pages: 3,
  site_text_chars: 1500,
  claude_max_tokens: 200,
};
```

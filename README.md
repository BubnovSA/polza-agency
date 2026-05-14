# Polza Outreach Automation

Скрипт для автоматического сбора базы B2B-компаний и генерации персонализации для email-аутрича.

## Что делает

1. Парсит вакансии с HH.ru → получает список компаний + сигнал
2. Для каждой компании находит сайт
3. С сайта извлекает email и текст
4. Валидирует email через MX-запись
5. Через Claude API генерирует персонализацию (1-2 предложения)
6. Сохраняет результат в `output/leads.csv`

## Скриншоты

**Пайплайн в работе — сбор компаний с HH.ru**

Слева — архитектура пайплайна, справа — логи шагов 1–2: парсинг вакансий, резолвинг сайтов через HH-профили, ICP pre-filter отсекает нерелевантные компании по имени.

![Pipeline running](assets/Screenshot%202569-05-14%20at%2021.58.43.png)

---

**Финальный результат — CSV и персонализация Claude**

Слева — `output/leads.csv` с 55 лидами (company_name, website, email, phone, signal, personalization). Справа — шаг 5: Claude Haiku генерирует 2-предложную персонализацию для каждой компании на основе описания с сайта и сигнала с HH.

![Final CSV and Claude personalization](assets/Screenshot%202569-05-14%20at%2023.48.47.png)

## Установка

```bash
git clone <repo>
cd polza-outreach
npm install
cp .env.example .env
# вставь ANTHROPIC_API_KEY в .env
```

## Запуск

```bash
node index.js
```

Результат: `output/leads.csv` — импортируй в Google Sheets.

## Переменные окружения

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Структура проекта

```
src/
  parsers/
    hh.js         # парсинг HH.ru
    site.js       # парсинг сайтов
  enrichers/
    email.js      # поиск и валидация email
    claude.js     # персонализация через Claude API
  utils/
    sleep.js
    dedupe.js
    csv.js
docs/             # документация по каждому этапу
output/           # результаты
```

## Документация

- [Архитектура пайплайна](docs/01-pipeline.md)
- [Источники данных](docs/02-sources.md)
- [Персонализация](docs/03-personalization.md)
- [Цепочки писем](docs/04-email-sequences.md)
- [Критерии ТЗ](docs/05-criteria.md)

# UA Auto Check Bot

Production-oriented Telegram-бот для бесплатного поиска автомобиля по украинскому номеру или VIN в собственной PostgreSQL-базе, сформированной из официальных открытых данных. Бизнес-логика отделена от aiogram, поэтому её можно использовать в будущем REST API.

> Важно: сервис не показывает и не импортирует ФИО, адреса, телефоны, документы или другие персональные данные. Отсутствие записи не доказывает отсутствие автомобиля, регистрации, страхования или ДТП.

## Дерево проекта

```text
.
├── alembic/
│   ├── versions/20260819_0001_initial.py
│   └── env.py
├── app/
│   ├── bot/handlers/{user.py,admin.py}
│   ├── cache/redis.py
│   ├── database/{models.py,session.py}
│   ├── domain/normalization.py
│   ├── locales/messages.py
│   ├── repositories/vehicles.py
│   ├── schemas/vehicle.py
│   ├── services/
│   │   ├── insurance/
│   │   ├── payments/
│   │   ├── access.py
│   │   ├── analytics.py
│   │   ├── rate_limit.py
│   │   ├── reports.py
│   │   └── vehicles.py
│   ├── config.py
│   └── main.py
├── data_importer/
│   ├── __main__.py
│   ├── files.py
│   ├── importer.py
│   └── parser.py
├── tests/
├── compose.yaml
├── Dockerfile
├── .env.example
└── pyproject.toml
```

## 1. Создание бота через BotFather

1. Откройте в Telegram официальный аккаунт `@BotFather`.
2. Выполните `/newbot`, задайте имя и username, оканчивающийся на `bot`.
3. Скопируйте выданный HTTP API token. Не публикуйте его и не добавляйте `.env` в Git.
4. При необходимости настройте `/setdescription`, `/setabouttext` и команды:

   ```text
   start - запустить бота
   admin - панель администратора
   ```

Если token утёк, немедленно отзовите его командой `/revoke` у BotFather.

## 2. Конфигурация `.env`

```bash
cp .env.example .env
```

Заполните минимум `BOT_TOKEN`, `POSTGRES_PASSWORD`, `QUERY_HASH_SALT` и `ADMIN_IDS` (Telegram ID через запятую). Сгенерировать секреты можно командой `python -c "import secrets; print(secrets.token_urlsafe(48))"`.

По умолчанию включён бесплатный режим и отключены реальные платежи:

```dotenv
PAYMENTS_ENABLED=false
FREE_PLATE_SEARCH=true
FREE_VIN_SEARCH=true
FREE_HISTORY=true
FREE_INSURANCE_SEARCH=true
PDF_REPORTS_ENABLED=false
EXTERNAL_PAID_DATA_ENABLED=false
```

`INSURANCE_PROVIDER=mock` возвращает только явно обозначенный тестовый результат. Для production без официальной интеграции задайте `INSURANCE_PROVIDER=disabled`.

## 3. Запуск Docker Compose

Требуются Docker Engine 24+ и Compose v2.

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f bot
```

Compose поднимает `postgres`, `redis` и `bot`, ждёт healthchecks, применяет Alembic-миграции, затем запускает long polling. PostgreSQL, Redis AOF и datasets находятся в именованных volumes. Порты БД наружу не публикуются.

Остановка без удаления данных:

```bash
docker compose down
```

Удаление volumes уничтожит БД, поэтому `docker compose down -v` используйте только осознанно после резервной копии.

## 4. Alembic

В контейнере миграции применяются автоматически. Вручную:

```bash
docker compose exec bot alembic current
docker compose exec bot alembic upgrade head
```

Для новой миграции после изменения моделей:

```bash
docker compose exec bot alembic revision --autogenerate -m "describe change"
```

Просмотрите сгенерированный файл перед применением и сначала проверьте миграцию на копии production-базы.

## 5. Официальные открытые данные и импорт

Основной рекомендованный источник — набор МВС Украины «Відомості про транспортні засоби та їх власників» на `data.gov.ua`, лицензия CC BY 4.0:

<https://data.gov.ua/dataset/06779371-308f-42d7-895e-5a39833375f0>

После первого запуска PostgreSQL пуст. Для автоматической загрузки и последовательного импорта официальных ZIP-ресурсов за 2022 год и новее выполните в PowerShell:

```powershell
.\scripts\import-official-data.ps1
```

Полная доступная история с 2013 года:

```powershell
.\scripts\import-official-data.ps1 -FromYear 2013
```

Импорт больших архивов может занять продолжительное время. Скрипт получает список ресурсов через официальный CKAN API `data.gov.ua`, запускает штатный importer для каждого ZIP и в конце показывает количество автомобилей и событий.

При публикации результатов сохраняйте ссылку и название источника. Набор может содержать чувствительные исходные столбцы; импортёр использует только разрешённый whitelist автомобильных и регистрационных полей.

Скопируйте CSV или ZIP в dataset volume:

```bash
docker compose cp ./reestrTZ.zip bot:/data/mvs.zip
docker compose exec bot python -m data_importer --file /data/mvs.zip
```

Или используйте отдельный одноразовый worker:

```bash
docker compose --profile tools run --rm worker \
  --file /data/mvs.zip --source-name "МВС України / data.gov.ua"
```

Скачивание по прямому официальному URL ресурса:

```bash
docker compose exec bot python -m data_importer \
  --url "https://официальный-прямой-url/resource.zip"
```

Не подставляйте HTML-страницу набора вместо прямого URL файла. URL можно сохранить в `DATASET_DEFAULT_URL`, после чего достаточно `python -m data_importer`.

### Конвейер импорта

1. Потоковое скачивание и SHA-256 checksum.
2. Безопасная распаковка ZIP и автоматический поиск CSV.
3. Определение UTF-8/CP1251/UTF-16 и разделителя.
4. Проверка уникальности headers и обязательных групп колонок.
5. Сравнение схемы с прошлым успешным dataset. При сходстве меньше 60% статус становится `REQUIRES_REVIEW`, merge не выполняется.
6. Чтение Polars батчами без загрузки всего файла в RAM.
7. Нормализация номера/VIN и разбор дат/чисел.
8. Связывание по VIN, затем исходному vehicle ID, затем номеру с проверками марки, года и категории.
9. Merge небольшими транзакциями. Бот продолжает читать уже зафиксированные данные.
10. Дедупликация событий по SHA-256 fingerprint и идемпотентность всего файла по checksum.
11. Запись статистики в `datasets` и инвалидация `vehicle:*` cache.

Статус последних импортов доступен администратору через `/import_status`. Команда `/import /data/file.zip` запускает импорт фоном и принимает только файл внутри `/data`.

## 6. Поиск по номеру и VIN

Пользователь может выбрать кнопку или просто отправить текст. Поддерживаются `AA1234BB`, `AA 1234 BB`, `АА1234ВВ`, `АА 1234 ВВ`. Совместимые кириллические буквы переводятся в латиницу, пробелы и дефисы удаляются.

VIN должен содержать ровно 17 символов; `I`, `O`, `Q` запрещены. SQL строится параметризованными SQLAlchemy-запросами. По VIN собираются все события и прежние номера. По номеру возможны несколько кандидатов: конфликтующие автомобили намеренно не объединяются.

Кеши:

```text
vehicle:plate:AA1234BB
vehicle:vin:WVWZZZ3CZHE123456
insurance:plate:AA1234BB
```

TTL управляются `VEHICLE_CACHE_TTL` и `INSURANCE_CACHE_TTL`.

## 7. Аналитика истории

Сервис вычисляет первую/последнюю известную регистрацию, число событий, предполагаемые смены владельца, смены номера, регионы и интервалы. Порог быстрой перепродажи и частых смен задаётся через `.env`. Это эвристики, а не юридические факты; отчёт всегда сообщает об ограниченном покрытии данных.

## 8. Страхование

Официальный пользовательский сервис проверки ОСЦПВ МТСБУ доступен по адресу <https://policy.mtsbu.ua/Search/Main/>. В открыто опубликованных материалах проекта не обнаружена документация публичного API, разрешающая серверные автоматизированные запросы. Поэтому проект не обходит CAPTCHA, не использует скрытые endpoints и не скрейпит страницу.

Реализованы `InsuranceProvider`, `MockInsuranceProvider` и `DisabledInsuranceProvider`. Реального провайдера следует добавлять только после получения официальной документации/договора, API key, правил rate limit и разрешения на автоматизацию. Новый класс должен реализовать `check_plate`, при наличии поддержки `check_vin`, и возвращать `InsuranceResult`. Никогда не преобразуйте техническую ошибку в утверждение «страховки нет».

## 9. Бесплатный режим и будущая монетизация

`AccessService.can_access(user, feature)` вызывается до бизнес-операции. При `PAYMENTS_ENABLED=false` работают бесплатные feature flags. При включении оплаты учитываются бесплатность функции, активная подписка и `report_balance`.

`PaymentProvider` отделяет платёжный шлюз от handlers. Сейчас есть только `MockPaymentProvider`; его URL заведомо нерабочий и он не предназначен для денег. Для Telegram Stars, Monobank, LiqPay, WayForPay или Stripe добавьте отдельный provider, проверку webhook-подписи, идемпотентность, ledger и refund flow. До этого не включайте `PAYMENTS_ENABLED=true` в production.

## 10. Ограничения и защита от выгрузки базы

Redis считает минутные, суточные и повторные запросы. После подозрительной серии одинаковых запросов пользователь временно блокируется. Администраторы обходят лимиты. Публичного REST endpoint и массовой выгрузки нет.

Настройки: `RATE_LIMIT_PER_MINUTE`, `DAILY_SEARCH_LIMIT`, `DUPLICATE_QUERY_LIMIT`, `SUSPICIOUS_BLOCK_SECONDS`. Для нескольких bot replicas Redis обеспечивает общий счётчик.

## 11. «Мои проверки» и приватность

История фильтруется по внутреннему `user_id`; чужие запросы не выдаются. Идентификатор запроса хранится как HMAC-SHA256 с `QUERY_HASH_SALT`. Для UX сохраняется лишь маска VIN или нормализованный номер. При ротации salt исторические хеши остаются безопасными, но перестают совпадать с новыми.

## 12. Администрирование

Доступ только для `ADMIN_IDS`:

```text
/admin
/user TELEGRAM_ID
/block TELEGRAM_ID
/unblock TELEGRAM_ID
/credit TELEGRAM_ID COUNT
/import_status
/import /data/file.zip
/cache_clear NUMBER_OR_VIN
/broadcast текст
```

Рассылка выполняется с задержкой, но для большой аудитории рекомендуется отдельная очередь/worker и учёт Telegram flood limits.

## 13. Тесты и локальная разработка

Python 3.12+:

```bash
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
ruff check .
mypy app data_importer
pytest -q
```

Тесты используют SQLite только для быстрой доменной проверки. Перед релизом дополнительно выполните integration tests на той же major-версии PostgreSQL и Redis, что production.

## 14. Резервное копирование и восстановление

Создать логический backup:

```bash
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > autocheck.dump
```

Проверяйте, что файл ненулевой, шифруйте его и храните вне сервера. Восстановление в пустую тестовую БД:

```bash
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < autocheck.dump
```

Перед production-восстановлением остановите bot, сделайте дополнительный snapshot и сначала отрепетируйте процедуру. Dataset-файлы можно скачать повторно из официального источника, но храните checksum и метаданные для воспроизводимости.

## 15. Обновление dataset

1. Скачайте новый ресурс только с официального портала.
2. Сверьте дату публикации, лицензию и структуру.
3. Сделайте backup PostgreSQL.
4. Запустите importer и проверьте `/import_status`.
5. При `REQUIRES_REVIEW` сравните headers и значения вручную; код намеренно не делает merge.
6. Проверьте несколько известных номеров/VIN и агрегаты до/после.

Повторный импорт того же файла безопасно пропускается. Новый файл с уже известными событиями не создаёт дубликаты.

## 16. Production deployment

- Используйте отдельный Linux VM/cluster, firewall и регулярные обновления образов.
- Не публикуйте PostgreSQL/Redis в интернет; Compose уже оставляет их во внутренней сети.
- Храните `.env` в secret manager с правами `0600`, ротируйте bot token и пароли.
- Закрепляйте образы по digest в контролируемых релизах и сканируйте зависимости.
- Настройте централизованный сбор JSON-логов, alerts по рестартам, ошибкам, диску, latency и статусу импорта.
- Делайте ежедневный encrypted backup с проверяемым restore и политикой retention.
- Для rolling deployment используйте webhook или обеспечьте единственный polling instance; два polling-процесса с одним token конфликтуют.
- Запускайте миграции отдельным release job перед масштабированием приложения.
- Для больших импортов используйте worker, контролируйте I/O и размер транзакций.
- Добавьте reverse proxy и TLS только когда появится webhook/API; текущий polling не требует входящего порта.

## 17. Бесплатный вариант: Cloudflare Worker + GitHub Releases

В каталоге [`worker`](worker/README.md) реализован отдельный serverless-вариант без PostgreSQL,
Redis и постоянно работающего VPS. GitHub Actions проверяет официальный набор МВС, при изменении
строит поисковый индекс и публикует 16 ZIP-архивов в GitHub Releases. Cloudflare Worker принимает
Telegram webhook и через HTTP Range загружает только небольшой фрагмент нужного архива.

Это не «реальное время» источника: бот обновится после публикации нового файла на `data.gov.ua`.
Ежедневная проверка лишь быстро подхватит официальное обновление. Инструкция по первому запуску,
секретам и регистрации webhook находится в [`worker/README.md`](worker/README.md).

## Финальные команды

```bash
cp .env.example .env
# заполнить .env
docker compose up -d --build
docker compose exec bot alembic current
docker compose cp ./reestrTZ.zip bot:/data/mvs.zip
docker compose exec bot python -m data_importer --file /data/mvs.zip
docker compose logs -f bot
```

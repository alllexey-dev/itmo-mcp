# itmo-mcp

MCP-сервер для сервисов Университета ИТМО: [my.itmo.ru](https://my.itmo.ru) и [БАРС](https://bars.itmo.ru), а также
[ITMO.Widgets](https://widgets.alllexey.dev) (отзывы о преподавателях, ссылки предметов, очереди на физкультуру).
Подключите его к Claude, Codex, Cursor или другому MCP-клиенту и спрашивайте обычным языком:
"какие пары завтра?", "сколько баллов по матану в БАРС?", "куда записаться на волейбол на этой неделе?",
"что пишут про преподавателя по матану?".

По умолчанию сервер только читает данные. Запись на физкультуру, бронирование аудиторий и подачу заявок
можно включить отдельно (см. "Изменение данных"): каждое действие сначала показывается и выполняется
только после вашего подтверждения.

> Неофициальный проект. Не связан с Университетом ИТМО. API сервисов может измениться без предупреждения.

## Быстрая настройка через агента

Отправьте своему агенту (Claude Code, Codex, Cursor):

```text
Настрой мне MCP-сервер itmo-mcp по README https://github.com/alllexey-dev/itmo-mcp
```

## Что умеет

| Инструмент | Что возвращает |
|---|---|
| `itmo_get_profile` | Ваш профиль: ИСУ, ФИО, факультет, группа, курс |
| `itmo_get_schedule` | Расписание пар за период (по умолчанию 7 дней) |
| `itmo_get_grades` | Зачётка за семестр: баллы, оценки, тип контроля |
| `itmo_get_grade_details` | Разбивка баллов по одной дисциплине зачётки |
| `itmo_get_study_plan` | Дисциплины учебного плана за семестр: ЗЕТ, часы, кафедра |
| `bars_get_scores` | Баллы БАРС текущего семестра по контрольным точкам |
| `itmo_get_sport_status` | Физкультура: баллы, секции, ближайшие занятия, долги |
| `itmo_get_sport_points_history` | История начисления баллов по физкультуре |
| `itmo_get_sport_schedule` | Занятия по физкультуре со свободными местами |
| `itmo_get_sport_filters` | Виды спорта, корпуса и семестры для фильтров |
| `itmo_get_sport_competitions` | Спортивные соревнования |
| `itmo_get_scholarship` | Стипендия и выплаты: суммы по категориям и история |
| `itmo_get_dormitory` | Общежитие: статус, договор, баланс и график оплаты |
| `itmo_get_room_bookings` | Ваши брони аудиторий и коворкингов |
| `itmo_get_queue_appointments` | Записи в электронную очередь |
| `itmo_get_requests` | Ваши заявки и справки |
| `itmo_get_election_status` | Сроки выбора дисциплин |
| `itmo_search_people`, `itmo_get_person` | Поиск студентов и сотрудников, профиль по ИСУ |
| `itmo_booking_places`, `itmo_booking_search_rooms` | Где можно забронировать аудиторию или коворкинг |
| `itmo_booking_availability` | Свободное время комнат на дату (чужие брони только как "занято") |
| `itmo_requests_catalog`, `itmo_request_form` | Какие справки и заявки можно подать, поля формы |
| `itmo_get_request_details` | Статус и поля поданной заявки |
| `widgets_get_teacher_reviews` | Отзывы о преподавателе из ITMO.Widgets и сводка по ним (доступ «Отзывы о преподавателях») |
| `widgets_get_subject_links` | Ссылки и чаты предмета от однокурсников (доступ «Ссылки предметов») |
| `widgets_get_sport_queue` | Ваши очереди на физкультуру в ITMO.Widgets (доступ «Очереди на физкультуру») |

Инструменты `widgets_*` работают после подключения через приложение ITMO.Widgets (см. "Вход в ИТМО"). Если
нужного доступа нет, инструмент скажет, какой переключатель включить в приложении: Профиль -> Устройства.

## Изменение данных

Включается переменной `ITMO_MCP_ENABLE_WRITES=true` и добавляет инструменты:

| Инструмент | Что делает |
|---|---|
| `itmo_sport_signup_preview`, `itmo_sport_cancel_preview` | Запись на занятие физкультурой или в секцию на семестр, отписка |
| `itmo_sport_competition_preview` | Регистрация на соревнование или отказ от участия |
| `itmo_booking_create_preview`, `itmo_booking_cancel_preview` | Бронь аудитории или коворкинга, отмена своей брони |
| `itmo_request_submit_preview`, `itmo_request_cancel_preview` | Подача заявки (например, справки с места учёбы), отмена |
| `widgets_sport_queue_join_preview`, `widgets_sport_queue_leave_preview` | Очередь ITMO.Widgets на свободное место или автозапись, выход из очереди (записывает телефон) |
| `itmo_confirm_action` | Выполняет подготовленное действие |

Любое изменение идёт в два шага. Инструмент `*_preview` ничего не меняет: он перечитывает данные, проверяет
правила (свободные места, попытки, пересечения, обязательные поля) и возвращает описание действия и одноразовый
`confirmation_token` на 10 минут. Агент показывает его вам, и только после вашего согласия вызывает
`itmo_confirm_action`. Клиенты MCP дополнительно спрашивают разрешение на этот вызов, потому что он помечен
как изменяющий данные.

Чего сервер не делает никогда: не подписывает документы электронной подписью, не платит, не трогает медданные
и не подаёт заявления, меняющие статус студента (отчисление, академический отпуск, перевод).

## Вход в ИТМО

### Через приложение ITMO.Widgets (рекомендуется)

```bash
npx -y itmo-mcp setup
```

`setup` показывает QR-код, а потом предлагает добавить сервер в Claude Code, Codex и Cursor. Только подключить
без клиентов: `npx -y itmo-mcp pair`.

1. В приложении ITMO.Widgets: Профиль -> Устройства -> «Подключить устройство», отсканируйте QR или вставьте
   ссылку из терминала. Ссылка действует 2 минуты, не пересылайте её.
2. Сверьте код проверки в терминале и на телефоне, выберите доступы и войдите в ITMO.ID в окне приложения.
3. Телефон передаёт серверу зашифрованный вход: отдельную сессию ITMO.ID только для этого сервера (на
   [id.itmo.ru/activity](https://id.itmo.ru/activity) это отдельная строка) и токен ITMO.Widgets. Ни пароль, ни
   cookie телефона сервер не получает.

| Команда | Что делает |
|---|---|
| `itmo-mcp pair` | Подключение по QR-коду (`--name`, `--scopes reviews:read,links:read,sport:queue`) |
| `itmo-mcp setup` | `pair`, затем добавляет сервер в Claude Code, Codex и Cursor (спрашивает про каждый) |
| `itmo-mcp status` | Доступы, состояние входа в ИТМО и дата его окончания, доступность ITMO.Widgets |
| `itmo-mcp renew` | Новый вход в ИТМО для того же подключения (QR-код ещё раз) |
| `itmo-mcp unpair` | Завершает свою сессию ITMO.ID, отключает сервер в ITMO.Widgets и стирает его данные |

- Сессия ITMO.ID живёт не больше 90 дней с входа. Когда ИТМО её закрывает, инструменты my.itmo.ru отвечают, что
  нужен `itmo-mcp renew`, а приложение видит это в «Устройствах».
- Если отключить сервер в приложении, при следующем запросе он сам завершит свою сессию ITMO.ID и сотрёт данные.
- Через подключение доступен только my.itmo.ru. **Инструменты БАРС** работают только с `ITMO_KEYCLOAK_IDENTITY`
  ниже, на ваш риск: эта cookie даёт полный доступ к аккаунту ITMO.ID, поэтому приложение её не передаёт.
- Сервер показывает только инструменты, которые сейчас могут работать: `bars_*` - пока есть `ITMO_KEYCLOAK_IDENTITY`,
  которую ITMO.ID принимает, `widgets_*` - после подключения к приложению.

### Без приложения (переменные окружения)

| Переменная | Доступ | Комментарий |
|---|---|---|
| `ITMO_KEYCLOAK_IDENTITY` | my.itmo.ru и БАРС | Cookie живёт около 90 дней. Это весь аккаунт: храните как пароль |
| `ITMO_REFRESH_TOKEN` | только my.itmo.ru | Токен живёт 30 дней и обновляется сам |

После подключения через приложение my.itmo.ru работает только через свою сессию, а `ITMO_KEYCLOAK_IDENTITY` нужна
лишь для БАРС. Вход по логину и паролю (`ITMO_USERNAME`, `ITMO_PASSWORD`) убран в 0.3.0.

Как получить `KEYCLOAK_IDENTITY`: войдите на [my.itmo.ru](https://my.itmo.ru), откройте DevTools
(F12) -> Application -> Cookies -> `https://id.itmo.ru` и скопируйте значение `KEYCLOAK_IDENTITY`.

ITMO.ID меняет токены при каждом входе. Сервер сохраняет свежие значения и подключение в
`~/.config/itmo-mcp/state.json` (права `600`), поэтому после первого входа переменные можно не обновлять. Папку можно
поменять через `ITMO_MCP_STATE_DIR`.

| Переменная | Назначение |
|---|---|
| `ITMO_MCP_ENABLE_WRITES` | `true` разрешает запись, бронь, заявки и очереди (см. "Изменение данных") |
| `ITMO_BROWSER_UA` | По умолчанию `true`: свои входы в ITMO.ID выглядят как Chrome. `false`: честная подпись `ITMO Widgets MCP bot` |
| `ITMO_WIDGETS_URL` | Сервер ITMO.Widgets, по умолчанию `https://widgets.alllexey.dev` |

## Подключение

Нужен [Node.js](https://nodejs.org) 20 или новее.

### Claude Desktop

Сначала подключите сервер (`npx -y itmo-mcp pair`), затем Settings -> Developer -> Edit Config, добавьте в
`claude_desktop_config.json` (переменные окружения из "Вход в ИТМО" кладутся в `"env"`):

```json
{
  "mcpServers": {
    "itmo": {
      "command": "npx",
      "args": ["-y", "itmo-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add --scope user itmo -- npx -y itmo-mcp
```

### Codex

```bash
codex mcp add itmo -- npx -y itmo-mcp
```

Или вручную в `~/.codex/config.toml`. Первый запуск `npx` скачивает пакет, поэтому таймаут старта увеличен:

```toml
[mcp_servers.itmo]
command = "npx"
args = ["-y", "itmo-mcp"]
startup_timeout_sec = 60
```

### Cursor, VS Code и другие клиенты

Используйте ту же команду (`npx -y itmo-mcp`) и те же переменные окружения в настройках MCP вашего клиента.

### Docker вместо Node.js

Подключение сохраняется в томе `itmo-mcp`:

```bash
docker run -it --rm -v itmo-mcp:/state ghcr.io/alllexey-dev/itmo-mcp:v0.3.1 pair
```

```json
{
  "mcpServers": {
    "itmo": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-v", "itmo-mcp:/state", "ghcr.io/alllexey-dev/itmo-mcp:v0.3.1", "--stdio"]
    }
  }
}
```

## Свой сервер (HTTP)

Сервер умеет Streamable HTTP: `POST /mcp`, health check на `GET /healthz`. Подключите его так же, как в Docker
выше (`... -v itmo-mcp:/state ... pair`), затем:

```bash
docker run -d --name itmo-mcp -p 8080:8080 \
  -e ITMO_MCP_HTTP_TOKEN="$(openssl rand -hex 32)" \
  -e ITMO_MCP_HTTP_ALLOWED_HOSTS=mcp.example.com \
  -v itmo-mcp:/state \
  ghcr.io/alllexey-dev/itmo-mcp:v0.3.1
```

| Переменная | Назначение |
|---|---|
| `ITMO_MCP_HTTP_TOKEN` | Клиент должен прислать `Authorization: Bearer <токен>` |
| `ITMO_MCP_HTTP_ALLOWED_HOSTS` | Допустимые значения заголовка `Host`, через запятую (защита от DNS rebinding) |

Один сервер обслуживает один аккаунт ИТМО. Не открывайте его в интернет без токена или прокси с авторизацией:
любой, кто до него достучится, увидит ваши данные. Подключение из Claude Code:

```bash
claude mcp add --transport http itmo https://mcp.example.com/mcp --header "Authorization: Bearer <токен>"
```

Из Codex (токен берётся из переменной окружения `ITMO_MCP_TOKEN`):

```bash
codex mcp add itmo --url https://mcp.example.com/mcp --bearer-token-env ITMO_MCP_TOKEN
```

## Приватность

- Сервер обращается напрямую к `id.itmo.ru`, `my.itmo.ru` и `bars.itmo.ru`, а после подключения ещё к ITMO.Widgets
  (`widgets.alllexey.dev`): за отзывами, ссылками и очередями и чтобы сообщить, работает ли его вход в ИТМО. Токены
  ИТМО к ITMO.Widgets не уходят.
- Ответы инструментов попадают в контекст модели и, значит, к провайдеру LLM, которым вы пользуетесь.
- Токены и cookie не попадают в ответы инструментов и в логи.

## OpenAPI и клиент

В `openapi/` лежат описания API (OpenAPI 3.1), восстановленные по веб-клиентам и проверенные на живых ответах:

- `openapi/my-itmo.yaml`: расписание, зачётка, учебный план, физкультура, финансы, общежитие и другое;
- `openapi/bars.yaml`: БАРС.

По ним сгенерирован типизированный клиент на [openapi-fetch](https://openapi-ts.dev/openapi-fetch/), который можно
использовать как библиотеку:

```ts
import { createToolDeps, loadConfig, result } from "itmo-mcp";

const { my } = createToolDeps(loadConfig());
const requests = await result("getMyRequests", my.GET("/api/requests/my"));
```

## Исследование API ИТМО

В папке [`research/`](research/) собрана документация по студенческим сервисам ИТМО (my.itmo.ru, БАРС, бэкенды
мобильного приложения и другие): откуда данные, как устроена авторизация, карта хостов и отдельный документ на
каждый сервис с таблицей ручек и статусом проверки. Там же лежат исследовательские OpenAPI-спецификации для ручек,
которых нет в контракте выше. Это справочный материал, а не часть сервера.

## Разработка

```bash
npm install
npm test             # юнит-тесты и проверка спек на фикстурах
npm run lint:spec    # линтер OpenAPI
npm run gen          # перегенерировать src/generated после правки openapi/
npm run verify:live  # сверить спеки с живыми ответами (нужны ITMO_* переменные)
npm run build
```

`verify:live` выводит только названия операций, HTTP-статусы и пути ошибок схемы, без самих данных.
Новые фикстуры добавляйте только после `scripts/sanitize-fixture.ts`, он убирает персональные данные.

## Изменения

См. [CHANGELOG.md](CHANGELOG.md).

## Лицензия

MIT

<h1 align="center">itmo-mcp</h1>

<p align="center">
  <strong>ИТМО для ИИ-ассистентов</strong>
  <br />
  MCP-сервер my.itmo.ru, БАРС и ITMO.Widgets для Claude, Codex, Cursor и других клиентов
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/itmo-mcp"><img src="https://img.shields.io/npm/v/itmo-mcp?style=flat-square&color=blue" alt="npm" /></a>
  <a href="https://github.com/alllexey-dev/itmo-mcp/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/alllexey-dev/itmo-mcp/ci.yml?branch=main&style=flat-square&label=CI" alt="CI" /></a>
  <img src="https://img.shields.io/badge/Node.js-20%2B-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 20+" />
  <a href="LICENSE"><img src="https://img.shields.io/github/license/alllexey-dev/itmo-mcp?style=flat-square" alt="MIT" /></a>
</p>

<p align="center">
  <a href="#быстрый-старт"><strong>Быстрый старт</strong></a> ·
  <a href="#что-умеет">Что умеет</a> ·
  <a href="#подключение">Подключение</a> ·
  <a href="#приватность">Приватность</a> ·
  <a href="CHANGELOG.md">История изменений</a>
</p>

MCP-сервер для сервисов Университета ИТМО: [my.itmo.ru](https://my.itmo.ru) и [БАРС](https://bars.itmo.ru), а также
[ITMO.Widgets](https://widgets.alllexey.dev) (отзывы о преподавателях, ссылки к предметам, очереди на физкультуру).
MCP (Model Context Protocol) - стандартный способ дать ИИ-ассистенту доступ к внешним данным. Подключите сервер
к своему ассистенту и спрашивайте обычным языком:

- "какие пары завтра?"
- "сколько баллов по матану в зачётке?"
- "куда записаться на волейбол на этой неделе?"
- "что пишут про преподавателя по матану?"

По умолчанию сервер только читает данные. Запись на физкультуру, бронирование аудиторий и подачу заявок
можно включить отдельно (см. "Изменение данных"): каждое действие сначала показывается и выполняется
только после вашего подтверждения.

> Неофициальный проект. Не связан с Университетом ИТМО. API сервисов может измениться без предупреждения.

## Быстрый старт

Нужны [Node.js](https://nodejs.org) 20 или новее и приложение
[ITMO.Widgets](https://github.com/alllexey-dev/ITMO.Widgets) на телефоне.

```bash
npx -y itmo-mcp setup
```

Команда показывает QR-код: отсканируйте его в приложении (Профиль -> Устройства -> «Подключить устройство»),
и она предложит добавить сервер в Claude Code, Codex и Cursor. После этого спросите ассистента, какие пары
завтра.

Можно поручить настройку самому агенту (Claude Code, Codex, Cursor). Отправьте ему:

```text
Настрой мне MCP-сервер itmo-mcp по README https://github.com/alllexey-dev/itmo-mcp
```

Шаги подключения подробно, вход без приложения и другие клиенты: "Вход в ИТМО" и "Подключение" ниже.

## Что умеет

| Инструмент | Что возвращает |
|---|---|
| **Учёба** | |
| `itmo_get_profile` | Ваш профиль: ИСУ, ФИО, факультет, группа, курс |
| `itmo_get_schedule` | Расписание пар за период (по умолчанию 7 дней) |
| `itmo_get_grades` | Зачётка за семестр: баллы, оценки, тип контроля |
| `itmo_get_grade_details` | Разбивка баллов по одной дисциплине зачётки |
| `itmo_get_study_plan` | Дисциплины учебного плана за семестр: ЗЕТ, часы, кафедра |
| `bars_get_scores` | Баллы БАРС текущего семестра по контрольным точкам |
| `itmo_get_election_status` | Сроки выбора дисциплин |
| **Физкультура** | |
| `itmo_get_sport_status` | Физкультура: баллы, секции, ближайшие занятия, долги |
| `itmo_get_sport_points_history` | История начисления баллов по физкультуре |
| `itmo_get_sport_schedule` | Занятия по физкультуре со свободными местами |
| `itmo_get_sport_filters` | Виды спорта, корпуса и семестры для фильтров |
| `itmo_get_sport_competitions` | Спортивные соревнования |
| **Стипендия и общежитие** | |
| `itmo_get_scholarship` | Стипендия и выплаты: суммы по категориям и история |
| `itmo_get_dormitory` | Общежитие: статус, договор, баланс и график оплаты |
| **Аудитории и электронная очередь** | |
| `itmo_get_room_bookings` | Ваши брони аудиторий и коворкингов |
| `itmo_booking_places`, `itmo_booking_search_rooms` | Где можно забронировать аудиторию или коворкинг |
| `itmo_booking_availability` | Свободное время комнат на дату (чужие брони только как "занято") |
| `itmo_get_queue_appointments` | Записи в электронную очередь |
| **Заявки и справки** | |
| `itmo_get_requests` | Ваши заявки и справки |
| `itmo_requests_catalog`, `itmo_request_form` | Какие справки и заявки можно подать, поля формы |
| `itmo_get_request_details` | Статус и поля поданной заявки |
| **Люди** | |
| `itmo_search_people`, `itmo_get_person` | Поиск студентов и сотрудников, профиль по ИСУ |
| **ITMO.Widgets** | |
| `widgets_get_teacher_reviews` | Отзывы о преподавателе из ITMO.Widgets и сводка по ним (доступ «Отзывы о преподавателях») |
| `widgets_get_subject_links` | Ссылки и чаты предмета от однокурсников (доступ «Ссылки предметов») |
| `widgets_get_sport_queue` | Ваши очереди на физкультуру в ITMO.Widgets (доступ «Очереди на физкультуру») |

Инструменты `widgets_*` работают после подключения через приложение ITMO.Widgets (см. "Вход в ИТМО"). Если
нужного доступа нет, инструмент скажет, какой переключатель включить в приложении: Профиль -> Устройства.

`bars_get_scores` появляется только с cookie ITMO.ID: с полным доступом из приложения (`itmo-mcp pair
--itmo-cookie`, см. "Полный доступ к ITMO.ID") или с `ITMO_KEYCLOAK_IDENTITY` (см. "Без приложения").

## Изменение данных

Включается переменной окружения `ITMO_MCP_ENABLE_WRITES=true`. Запустите с ней настройку
(`ITMO_MCP_ENABLE_WRITES=true npx -y itmo-mcp setup`), и команда перенесёт её в настройки клиентов; в уже
настроенном клиенте добавьте её в `env` MCP-сервера. Переменная добавляет инструменты:

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
2. Проверьте, что телефон показывает этот сервер, выберите доступы и войдите в ITMO.ID в окне приложения.
3. Телефон передаёт MCP-серверу зашифрованный вход: отдельную сессию ITMO.ID только для этого сервера (на
   [id.itmo.ru/activity](https://id.itmo.ru/activity) это отдельная строка) и токен ITMO.Widgets. Ни пароль, ни
   cookie телефона сервер не получает.

| Команда | Что делает |
|---|---|
| `itmo-mcp pair` | Подключение по QR-коду (`--name`, `--scopes reviews:read,links:read,sport:queue`, `--itmo-cookie`) |
| `itmo-mcp setup` | `pair`, затем добавляет сервер в Claude Code, Codex и Cursor (спрашивает про каждый); те же флаги |
| `itmo-mcp status` | Доступы, состояние входа в ИТМО и дата его окончания, чего не хватает для БАРС, доступность ITMO.Widgets |
| `itmo-mcp renew` | Новый вход в ИТМО для того же подключения (QR-код ещё раз); `--itmo-cookie` просит и полный доступ |
| `itmo-mcp unpair` | Завершает свою сессию ITMO.ID, отключает сервер в ITMO.Widgets и стирает его данные |

- Сессия ITMO.ID живёт не больше 90 дней с входа. Когда ИТМО её закрывает, инструменты my.itmo.ru отвечают, что
  нужен `itmo-mcp renew`, а приложение видит это в «Устройствах».
- Если отключить сервер в приложении, при следующем запросе он сам завершит свою сессию ITMO.ID и сотрёт данные.
- Без флага подключение даёт только my.itmo.ru. **Инструментам БАРС** нужен полный доступ к ITMO.ID (ниже) или
  `ITMO_KEYCLOAK_IDENTITY`.
- Сервер показывает только инструменты, которые сейчас могут работать: `bars_*` - пока есть cookie ITMO.ID, которую
  ITMO.ID принимает, `widgets_*` - после подключения к приложению, `itmo_*` - пока у подключения есть вход в ИТМО.
  Если на телефоне выключить все доступы ИТМО, работают только `widgets_*`; вернуть вход: `itmo-mcp renew`.

### Полный доступ к ITMO.ID (`--itmo-cookie`)

```bash
npx -y itmo-mcp pair --itmo-cookie     # новое подключение
npx -y itmo-mcp renew --itmo-cookie    # уже подключённый сервер
```

С флагом сервер просит у приложения выбрать доступы по одному, и среди них полный доступ к ITMO.ID. `pair` пишет
в терминале, что он просит и что без чего не заработает:

| Доступ | Что даёт серверу | Без него |
|---|---|---|
| Доступы ITMO.Widgets (`widgets:*`, по умолчанию отзывы и ссылки, `--scopes` меняет список) | Инструменты `widgets_*` | Нет этих инструментов |
| Вход в my.itmo (`itmo:refresh:student-personal-cabinet`) | Токен my.itmo этой сессии: инструменты `itmo_*` | `itmo_*` работают через полный доступ, а без обоих их нет |
| Полный доступ к ITMO.ID (`itmo:sso`) | Cookie `KEYCLOAK_IDENTITY` этой сессии: баллы БАРС, вход в my.itmo без повторной привязки | Нет инструментов БАРС (`bars_*`) |

На телефоне любой доступ можно выключить; полный доступ выключен по умолчанию и включается с подтверждением.

> **Внимание.** Полный доступ - это cookie сессии ITMO.ID. С ней сервер входит в любой сервис ИТМО от вашего
> имени: my.itmo, БАРС, ИСУ и сам ITMO.ID, а не только в расписание и баллы. Она действует, пока сессия жива (до
> 90 дней с входа) или пока вы не заберёте доступ в приложении. Включайте его, только если это ваш компьютер: кто
> прочитает `state.json`, получит весь аккаунт ИТМО на этот срок.

- При подключении сервер один раз молча входит в my.itmo с этой cookie и проверяет, что она от той же сессии, что
  отдал телефон (совпадают `sid` и ИСУ). Если нет, он завершает эту сессию и подключение не создаётся.
- Когда токен my.itmo перестаёт работать, сервер получает новый по cookie и только потом считает вход закрытым.
- `unpair` и отключение в приложении завершают сессию (OIDC logout токеном или токеном, полученным по cookie) и
  стирают токен, cookie и подключение из `state.json`.
- Без флага запрос остаётся прежним, и его понимают и версии приложения без выбора доступов. Флаг требует
  обновлённых ITMO.Widgets и его сервера.

### Без приложения (переменные окружения)

| Переменная | Доступ | Комментарий |
|---|---|---|
| `ITMO_KEYCLOAK_IDENTITY` | my.itmo.ru и БАРС | Cookie живёт около 90 дней. Это весь аккаунт: храните как пароль |
| `ITMO_REFRESH_TOKEN` | только my.itmo.ru | Токен живёт 30 дней и обновляется сам |

После подключения через приложение my.itmo.ru работает только через свою сессию, а `ITMO_KEYCLOAK_IDENTITY` нужна
лишь для БАРС и только пока у подключения нет полного доступа: с ним БАРС работает через cookie подключения. Вход по логину и паролю (`ITMO_USERNAME`, `ITMO_PASSWORD`) убран в 0.3.0.

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

## Экосистема

| Репозиторий | Что это |
|---|---|
| [ITMO.Widgets](https://github.com/alllexey-dev/ITMO.Widgets) | Приложение для Android и iPhone |
| [itmo-widgets-backend](https://github.com/alllexey-dev/itmo-widgets-backend) | Сервер: друзья, приватность, очереди на спорт, отзывы, уведомления |
| [itmo-widgets-web](https://github.com/alllexey-dev/itmo-widgets-web) | Сайт и веб-версия |
| [itmo-widgets-agent](https://github.com/alllexey-dev/itmo-widgets-agent) | Агент для компьютера или сервера: автозапись на спорт без телефона |
| **itmo-mcp** (этот репозиторий) | MCP-сервер ИТМО для Claude, Codex, Cursor и других ассистентов |
| [my-itmo-api](https://github.com/alllexey-dev/my-itmo-api) | Библиотека для My ITMO и БАРС: Kotlin Multiplatform и Java |

## Разработчикам

### OpenAPI и клиент

Сервер ходит в my.itmo.ru и БАРС через типизированный клиент на
[openapi-fetch](https://openapi-ts.dev/openapi-fetch/), сгенерированный из двух спецификаций OpenAPI 3.1 в
`openapi/`. Его можно использовать как библиотеку:

```ts
import { createToolDeps, loadConfig, result } from "itmo-mcp";

const { my } = createToolDeps(loadConfig());
const requests = await result("getMyRequests", my.GET("/api/requests/my"));
```

### Описание API ИТМО

Разбор API сервисов ИТМО живёт в отдельном репозитории:
[my-itmo-api/spec](https://github.com/alllexey-dev/my-itmo-api/tree/master/spec). Там описаны вход через ITMO.ID,
карта хостов, общие правила ответов, отдельный документ на каждый сервис и все спецификации OpenAPI с примерами
ответов. По ним можно написать свой клиент на любом языке.

`openapi/my-itmo.yaml` и `openapi/bars.yaml` здесь - копии спецификаций оттуда. Править их нужно в my-itmo-api,
а сюда переносить командой `npm run spec:sync`.

### Сборка и тесты

```bash
npm install
npm test             # юнит-тесты и проверка спек на фикстурах
npm run lint:spec    # линтер OpenAPI
npm run spec:sync    # обновить openapi/ из my-itmo-api
npm run gen          # перегенерировать src/generated после обновления openapi/
npm run verify:live  # сверить спеки с живыми ответами (нужны ITMO_* переменные)
npm run build
```

`verify:live` выводит только названия операций, HTTP-статусы и пути ошибок схемы, без самих данных.
Новые фикстуры добавляйте только после `scripts/sanitize-fixture.ts`, он убирает персональные данные.

## Обратная связь

Ошибки и идеи: [Issues](https://github.com/alllexey-dev/itmo-mcp/issues) или [@itmowidgets](https://t.me/itmowidgets).

## Лицензия

[MIT](LICENSE).

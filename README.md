# itmo-mcp

MCP-сервер для сервисов Университета ИТМО: [my.itmo.ru](https://my.itmo.ru) и [БАРС](https://bars.itmo.ru).
Подключите его к Claude, Cursor или другому MCP-клиенту и спрашивайте обычным языком:
"какие пары завтра?", "сколько баллов по матану в БАРС?", "куда записаться на волейбол на этой неделе?",
"когда приходила стипендия?".

Сервер только читает данные: он ничего не меняет, не записывает на занятия и не подаёт заявки.

> Неофициальный проект. Не связан с Университетом ИТМО. API сервисов может измениться без предупреждения.

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

## Вход в ИТМО

Сервер входит в ITMO.ID от вашего имени. Подойдёт любой из вариантов (переменные окружения):

| Переменные | Доступ | Комментарий |
|---|---|---|
| `ITMO_USERNAME` + `ITMO_PASSWORD` | my.itmo.ru и БАРС | Проще всего. Пароль хранится в конфиге MCP-клиента |
| `ITMO_KEYCLOAK_IDENTITY` | my.itmo.ru и БАРС | Без пароля. Cookie живёт около 90 дней |
| `ITMO_REFRESH_TOKEN` | только my.itmo.ru | Токен живёт 30 дней и обновляется сам |

Как получить `KEYCLOAK_IDENTITY`: войдите на [my.itmo.ru](https://my.itmo.ru), откройте DevTools
(F12) -> Application -> Cookies -> `https://id.itmo.ru` и скопируйте значение `KEYCLOAK_IDENTITY`.

ITMO.ID меняет токены при каждом входе. Сервер сохраняет свежие значения в `~/.config/itmo-mcp/state.json`
(права `600`), поэтому после первого входа переменные можно не обновлять. Папку можно поменять через
`ITMO_MCP_STATE_DIR`.

## Подключение

Нужен [Node.js](https://nodejs.org) 20 или новее.

### Claude Desktop

Settings -> Developer -> Edit Config, добавьте в `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "itmo": {
      "command": "npx",
      "args": ["-y", "itmo-mcp"],
      "env": {
        "ITMO_USERNAME": "123456",
        "ITMO_PASSWORD": "ваш пароль"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add itmo -e ITMO_USERNAME=123456 -e ITMO_PASSWORD='ваш пароль' -- npx -y itmo-mcp
```

### Cursor, VS Code и другие клиенты

Используйте ту же команду (`npx -y itmo-mcp`) и те же переменные окружения в настройках MCP вашего клиента.

### Docker вместо Node.js

```json
{
  "mcpServers": {
    "itmo": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "ITMO_USERNAME", "-e", "ITMO_PASSWORD",
               "-v", "itmo-mcp:/state", "ghcr.io/alllexey-dev/itmo-mcp:v0.1.0", "--stdio"],
      "env": { "ITMO_USERNAME": "123456", "ITMO_PASSWORD": "ваш пароль" }
    }
  }
}
```

## Свой сервер (HTTP)

Сервер умеет Streamable HTTP: `POST /mcp`, health check на `GET /healthz`.

```bash
docker run -d --name itmo-mcp -p 8080:8080 \
  -e ITMO_USERNAME=123456 -e ITMO_PASSWORD='ваш пароль' \
  -e ITMO_MCP_HTTP_TOKEN="$(openssl rand -hex 32)" \
  -e ITMO_MCP_HTTP_ALLOWED_HOSTS=mcp.example.com \
  -v itmo-mcp:/state \
  ghcr.io/alllexey-dev/itmo-mcp:v0.1.0
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

## Приватность

- Сервер обращается напрямую к `id.itmo.ru`, `my.itmo.ru` и `bars.itmo.ru`. Других адресатов у данных нет.
- Ответы инструментов попадают в контекст модели и, значит, к провайдеру LLM, которым вы пользуетесь.
- Пароль и токены не попадают в ответы инструментов и в логи.

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

## Лицензия

MIT

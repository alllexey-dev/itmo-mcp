# Голосования и семестр (отдельные сервисы)

## Голосования (voting.itmo.ru)

Платформа электронных голосований и выборов ИТМО. Фронтенд `voting.itmo.ru` (Nuxt 2), бэкенд
`https://api.voting.itmo.su/api/v1`. Вход через ITMO.ID, но отдельным клиентом `voting-is`
(redirect `https://voting.itmo.ru/login/callback`), не `student-personal-cabinet`. Токен `voting-is` получается
тем же тихим входом по `KEYCLOAK_IDENTITY`, что и для сайта, см. [../auth.md](../auth.md).

| Метод | Путь | Что делает | Статус |
|---|---|---|---|
| GET | `/api/v1/events` | Текущие голосования пользователя | проверено |
| GET | `/api/v1/elections/` | Список выборов | сайт |
| GET | `/api/v1/events/{eventId}` | Одно событие голосования | сайт |
| GET | `/api/v1/elections/{id}` | Одни выборы | сайт |
| GET | `/api/v1/elections/{id}/info` `/list` `/count` `/is_admin` | Информация, бюллетени, явка, признак админа | сайт |
| PUT | `/api/v1/elections/{id}` | Проголосовать (`{id:[кандидаты]}`) | сайт |

Проверено 2026-10-05: токен `voting-is` принимается; `GET /api/v1/events` отвечает, но на проверочном аккаунте
активных голосований нет (`error_code` 100, "Ошибка получения текущих голосований"), поэтому id выборов взять
неоткуда и формы ответов `elections/*` не сняты. Создание выборов и загрузка бюллетеней (`POST .../ballots`,
`/observers`, `/publickey`, `/decode`) - для админов.

Голосование (`PUT`) - необратимое действие, в MCP только через предпросмотр и подтверждение.

## Текущий семестр (semester.itmo.su)

`https://semester.itmo.su/` редиректит на публичную Yandex Cloud Function, которая без авторизации отдаёт текущий
академический семестр.

| Метод | Путь | Что делает | Статус |
|---|---|---|---|
| GET | `https://semester.itmo.su/` | Текущий семестр: `id`, `number`, `date_start`, `date_end`, `st_year`, `sem_id` | проверено |

Конверт `{error_code, error_message, result}`, CORS `*`. Удобно, чтобы узнать номер и даты текущего семестра без
токена ITMO.ID. Описано в [../openapi/itmo-services.yaml](../openapi/itmo-services.yaml) (`getCurrentSemester`).

## Покрытие в itmo-mcp

Нет.

## Риски и открытые вопросы

- Формы ответов выборов не сняты: на аккаунте не было активных голосований.
- Принимает ли бэкенд голосований токен `student-personal-cabinet` вместо `voting-is`, не проверялось (у них
  разные client_id, скорее всего нет).

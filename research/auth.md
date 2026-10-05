# Авторизация: ITMO.ID, БАРС, ИСУ

ITMO.ID - Keycloak, realm `itmo`. Все студенческие сервисы получают доступ через него: my.itmo.ru и мобильное
приложение - по OIDC-токенам, БАРС - по своей сессии после обмена кода, ИСУ - по SSO-cookie Keycloak.

## Realm и точки входа

Issuer: `https://id.itmo.ru/auth/realms/itmo`. Пути ниже даны относительно него.

| Метод | Путь | Назначение | Статус |
|---|---|---|---|
| GET | `/protocol/openid-connect/auth` | Authorization endpoint: форма входа или сразу редирект с `code` | проверено |
| POST | `/login-actions/authenticate?...` | Отправка формы логина; точный URL берётся из страницы входа | проекты |
| POST | `/protocol/openid-connect/token` | Обмен кода, refresh, password grant | проверено |
| GET | `/protocol/openid-connect/certs` | JWKS для проверки подписи токенов | проекты |
| GET | `/protocol/openid-connect/userinfo` | Профиль по access token | приложение |

## Клиенты

| client_id | Кто использует | redirect_uri | PKCE | scope | Статус |
|---|---|---|---|---|---|
| `student-personal-cabinet` | my.itmo.ru, itmo-mcp, my-itmo-api, ITMO.Widgets | `https://my.itmo.ru/login/callback` | S256 | `openid profile` в itmo-mcp | проверено |
| `student-personal-cabinet-dev` | dev.my.itmo.su | `https://dev.my.itmo.su/login/callback` | не проверялось | - | проекты |
| `bars` | bars.itmo.ru, itmo-mcp | `https://bars.itmo.ru/rest/login` | нет | `openid` | проверено |
| `is-app` | Мобильное приложение my.itmo | не используется (password grant) | - | `openid email profile offline_access` | приложение |

- `student-personal-cabinet` - публичный клиент: код обменивается без секрета. Код клиента `bars` обменивает бэкенд
  БАРС, поэтому, публичный ли он, неизвестно и для нас неважно.
- `is-app` - клиент мобильного приложения; его настройки здесь не описываются.
- В окружении Nuxt my.itmo.ru есть `ALLOWED_AZP` со значениями `student-personal-cabinet` и `isu`: сайт принимает
  токены этих двух `azp`. Клиент `isu` в наших источниках больше не встречается (статус: сайт).

## Потоки

### Вход по паролю (форма Keycloak)

1. `GET /protocol/openid-connect/auth?response_type=code&client_id=...&redirect_uri=...&scope=...&state=...`
   (для `student-personal-cabinet` ещё `code_challenge` и `code_challenge_method=S256`), без следования редиректам.
2. Тема ITMO.ID рисует форму из JSON-конфига в странице: URL отправки - поле `loginAction` (запасной вариант -
   атрибут `action` у `<form>`). Сохранить cookie ответа: `AUTH_SESSION_ID`, `KC_RESTART` и другие.
3. `POST loginAction` с телом `application/x-www-form-urlencoded`: `username`, `password`, `rememberMe=on`,
   с cookie из шага 2, `redirect: manual`.
4. Успех - 302 на `redirect_uri` с `code` и тем же `state` в `Location`, плюс `Set-Cookie: KEYCLOAK_IDENTITY`.
   Любой другой ответ (снова страница входа) - неверный логин или пароль.

Статус: проекты. Форма и её редирект наблюдались в SP-21 (ITMO.Widgets); программный POST в itmo-mcp покрыт
тестами на моках, на живом аккаунте не запускался.

### Тихий вход по `KEYCLOAK_IDENTITY`

Один запрос authorize с заголовком `Cookie: KEYCLOAK_IDENTITY=...` и `redirect: manual`. Если SSO-сессия жива,
Keycloak сразу отвечает 302 на `redirect_uri` с `code`; иначе отдаёт страницу входа (значит, cookie истекла).
Keycloak при каждом таком входе выдаёт в `Set-Cookie` новый `KEYCLOAK_IDENTITY` (и `KEYCLOAK_SESSION`,
`KEYCLOAK_REMEMBER_ME`, `AUTH_SESSION_ID`, `KC_AUTH_SESSION_HASH`, `KC_RESTART`, `KEYCLOAK_LOCALE`); хранить нужно
последний полученный. Статус: проверено для `student-personal-cabinet` и `bars`.

### Обмен кода и refresh

| Запрос | Поля формы | Статус |
|---|---|---|
| Обмен кода | `grant_type=authorization_code`, `client_id`, `redirect_uri`, `code`, `code_verifier` (если PKCE) | проверено |
| Refresh | `grant_type=refresh_token`, `client_id`, `refresh_token` | проверено |
| Password grant (`is-app`) | `grant_type=password`, `username`, `password`, `otp` (если включён второй фактор), `scope` | приложение |

- Ответ токен-эндпоинта: `access_token`, `expires_in`, `refresh_token`, `refresh_expires_in`, `id_token`, `scope`,
  `session_state`, `token_type`, `not-before-policy`.
- Refresh token ротируется при каждом обновлении: старый больше не годится, новый нужно сохранить сразу.

### Сессия БАРС

1. Получить `code` для клиента `bars` (паролем или тихим входом).
2. `GET https://bars.itmo.ru/backend/rest/login?code=...&customRedirectUri=https://bars.itmo.ru/rest/login`.
   Бэкенд БАРС сам обменивает код в ITMO.ID.
3. Сессия - значение заголовка ответа `authorization` (`Bearer ...`); его отправляют обратно как `Authorization`.

Сессия живёт около 30 минут, refresh нет, из токена my.itmo.ru её не получить: продлевать можно только новым кодом
через SSO-cookie (так делает ITMO.Widgets, решение 0012). Статус: проверено. Контракт:
[../openapi/bars.yaml](../openapi/bars.yaml).

### Сессия ИСУ

ИСУ (Oracle APEX) пускает по `KEYCLOAK_IDENTITY` через цепочку редиректов на id.itmo.ru. Подробно:
[services/isu.md](services/isu.md).

## Сроки жизни

| Что | Срок | Источник | Статус |
|---|---|---|---|
| access token | 1800 с (`expires_in`) | SP-21, itmo-mcp | проверено |
| id token | 1800 с | SP-21 | проекты |
| refresh token | 30 дней (`refresh_expires_in` 2592000), ротируется | SP-21, itmo-mcp | проверено |
| `KEYCLOAK_IDENTITY` | около 90 дней при `rememberMe=on`, переиздаётся при каждом SSO-входе; путь `/auth/realms/itmo/`, Secure, HttpOnly | SP-21 | проекты |
| `KEYCLOAK_SESSION` | около 90 дней | SP-21 | проекты |
| `KEYCLOAK_REMEMBER_ME` | 365 дней | SP-21 | проекты |
| `AUTH_SESSION_ID`, `KC_RESTART`, `KEYCLOAK_LOCALE` | сессионные | SP-21 | проекты |
| `KC_AUTH_SESSION_HASH` | 60 с | SP-21 | проекты |
| Сессия БАРС | около 30 минут, без refresh | ITMO.Widgets, my-itmo-api | проекты |

Срок `KEYCLOAK_IDENTITY` без галочки "запомнить меня" не измерялся.

## Содержимое токенов

- access token: JWT RS256. Claims: `allowed-origins`, `auth_time`, `azp`, `email`, `exp`, `iat`, `iss`, `isu`,
  `jti`, `preferred_username`, `scope`, `sid`, `sub`, `typ`.
- `isu` - номер ИСУ пользователя (целое). itmo-mcp берёт номер из этого claim для профиля (`/api/personalities/persons/{isu}`) и для брони помещений.
- refresh token: JWT HS512 (подписан секретом realm, проверить нельзя и не нужно).
- id token: RS256, кроме профиля содержит `isu`, `groups`, `is_student`.

### Проверка токена на своём сервере

Как в itmo-widgets-backend (`ItmoJwtVerifier.kt`): взять JWKS из `/protocol/openid-connect/certs` (кэш ключей на
дни), найти ключ по `kid` из заголовка JWT, проверить подпись RS256 и `iss` = issuer, допуск по времени 60 с.
`azp` и `aud` там не проверяются; если важно, от какого клиента токен, `azp` стоит проверять отдельно.

## Ограничения

- Принимаются только зарегистрированные `redirect_uri`: свой callback не подставить, поэтому сторонние клиенты
  перехватывают редирект на официальный callback.
- Device Authorization Grant выключен для `student-personal-cabinet` и `student-personal-cabinet-dev`
  (itmo-fastpick).
- У my.itmo.ru нет CORS: preflight на защищённую ручку получает 405 без `Access-Control-Allow-Origin`. Браузерному
  приложению с другого домена нужен свой серверный relay.
- Токен my.itmo.ru не подходит для БАРС и наоборот.

## Как это сделано в itmo-mcp

Код: [../src/auth/](../src/auth/). Секреты читаются из окружения: `ITMO_USERNAME`, `ITMO_PASSWORD`,
`ITMO_REFRESH_TOKEN`, `ITMO_KEYCLOAK_IDENTITY`.

| Файл | Роль |
|---|---|
| `itmo-id.ts` | Клиенты `student-personal-cabinet` (PKCE S256, `openid profile`) и `bars` (без PKCE, `openid`); authorize, форма, обмен, refresh; чтение `isu` из access token |
| `sso.ts` | Получение `code` для любого клиента: сначала `KEYCLOAK_IDENTITY` |
| `token-manager.ts` | Access token для my.itmo.ru: кэш, refresh, затем SSO |
| `bars-session.ts` | Сессия БАРС через `sso.ts` и `/login` |
| `state-store.ts` | Файл `state.json` |

Порядок получения access token для my.itmo.ru:

1. Токен в памяти, если до истечения больше 30 с.
2. Refresh token: из памяти, из `state.json`, из `ITMO_REFRESH_TOKEN` (по очереди, отвергнутый пропускается).
3. Код через SSO: `KEYCLOAK_IDENTITY` из `state.json`, затем из `ITMO_KEYCLOAK_IDENTITY`, затем логин и пароль;
   код обменивается на токены.

Подробности:

- Получение токенов и сессии БАРС - single-flight: параллельные вызовы ждут один запрос.
- На 401 от my.itmo.ru токен обновляется принудительно и запрос повторяется один раз; на 401 от БАРС сессия
  забывается и создаётся заново.
- `state.json` лежит в `ITMO_MCP_STATE_DIR` (по умолчанию `~/.config/itmo-mcp`) и хранит `refreshToken` и
  `keycloakIdentity`. Запись атомарная (временный файл и rename), права 0600, каталог 0700. Каждый новый refresh
  token и каждый переизданный `KEYCLOAK_IDENTITY` сохраняются сразу, поэтому после перезапуска вход остаётся тихим.
- Ошибки входа не содержат секретов: `AuthError` и `CredentialRejectedError` (отвергнутый credential, пробуется
  следующий).

## Открытые вопросы

- Discovery-документ `/.well-known/openid-configuration` в наших источниках не использовался: список grant types и
  scopes по клиентам не сверялся.
- PKCE и scope клиента `student-personal-cabinet-dev` не проверялись.
- Какие права даёт токен `is-app` на прокси my.itmo.ru и наоборот (одинаковы ли `azp`, audience и роли) - неизвестно.
- Что за клиент `isu` из `ALLOWED_AZP` и где он используется.
- Срок `KEYCLOAK_IDENTITY` без `rememberMe=on`.

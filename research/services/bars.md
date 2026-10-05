# БАРС (балльно-рейтинговая система)

## Назначение

Журнал текущих баллов по дисциплинам: контрольные точки, баллы, экзамен, итоговая оценка. Студент видит свой
журнал; преподаватели и администраторы выставляют баллы, дедлайны, утверждают ведомости. Веб-клиент -
`https://bars.itmo.ru` (React SPA).

## Хосты и авторизация

| Что | Значение |
|---|---|
| REST | `https://bars.itmo.ru/backend/rest` (бандл обращается к `/rest/...` относительно своего префикса) |
| Вход | ITMO.ID, клиент `bars`, authorization code без PKCE, redirect `https://bars.itmo.ru/rest/login` |
| Сессия | GET `/login?code&customRedirectUri` возвращает заголовок ответа `authorization: Bearer ...`; его отправляют как `Authorization` |
| Срок | Около 30 минут, refresh-токена нет, токен my.itmo на сессию БАРС не обменивается |
| Продление | Повторить авторизацию ITMO.ID с cookie сессии ITMO.ID и обменять новый code |

Подробности входа и cookie - в [../auth.md](../auth.md). Ответы БАРС не обёрнуты в `{error_code, result}`:
тело - сразу массив или объект.

## Ручки

Пути относительно `https://bars.itmo.ru/backend/rest`. Пометка "(GET снят)" означает, что ответ получен
вживую при исследовании, но со схемой не сверялся.

| Метод | Путь | Что делает | Статус |
|---|---|---|---|
| GET | `/login?code&customRedirectUri` | Обмен кода ITMO.ID на сессию в заголовке `authorization`; выполняется в каждом прогоне `verify:live`, тело не сверяется | проверено |
| GET | `/users/current_user/` | Пользователь, роли, выбранный период `selected_year`, `selected_term` | проверено |
| GET | `/config/` | Глобальные настройки `[{id, name, value}]`, в том числе `current_year`, `current_term` | проверено |
| GET | `/journal/disciplines?withCheckpointPlansOnly` | Дисциплины выбранного периода: `id`, `name`, `terms`, `checkpoint_plan_ids` | проверено |
| GET | `/journal/groups-and-flows?checkpointPlanId` | Группы и потоки журнала: `type`, `identifier`, `checkpoint_plan_ids` | проверено |
| GET | `/marks/{checkpointPlanId}/{type}/{identifier}/student` | Журнал студента: заголовки контрольных точек и свои баллы | проверено |
| GET | `/marks/{cp}/{type}/{identifier}/student/{studentId}/history?checkpointId` | История изменений баллов (GET снят, пустой массив) | сайт |
| GET | `/deadline` | Дедлайны пользователя (GET снят, пустой массив) | сайт |
| GET | `/config/personal` | Личные настройки (GET снят) | сайт |
| POST | `/config/personal` | Смена личной настройки `{name: "current_year" или "current_term", value}`, то есть периода | сайт |
| DELETE | `/config/personal/{id}` | Удаление личной настройки | сайт |
| POST | `/marks/{cp}/student/agreement` | "Ознакомлен с системой оценивания", без тела, необратимо | сайт |
| GET | `/journal/checkpoint-plans`, `/journal/cache?term` | Планы контрольных точек и кэш журнала; роль не выяснена | сайт |

Преподавательские и административные ручки из бандла (не для студента, не описываются подробно): `/marks/final/`,
`/marks/additional/`, `/marks/{cp}/{type}/approval/{id}/history`, approve, `/deadline/{a}/{b}/{c}`,
`/deadline/single/...`, `/checkpoint_plans*`, `/checkpoint_types*`, `/disciplines*`, `/flows*`, `/groups`,
`/personal_plans*`, `/report*`, `/tests`, `/users*`, `/users/set_selected_role`, `/set_me_to/{id}`,
`/registration/token*`, `/google/import/sheet`, `/google/export/sheet`, `/educational_programs/`. Статус: сайт.

## Модели и правила

| Тема | Правило |
|---|---|
| Поиск журнала | `disciplines` -> каждый `checkpoint_plan_ids` -> `groups-and-flows?checkpointPlanId` -> `marks/{cp}/{type}/{identifier}/student` |
| `groups-and-flows` | Для студента фильтровать по `checkpointPlanId`; один `disciplineId` дал 400 |
| `type`, `identifier` | Непрозрачные сегменты пути, кодировать отдельно |
| Период | Определяется личной настройкой на сервере; смена через POST `/config/personal` видна и в веб-интерфейсе |
| Журнал | `headers.plan.regular_checkpoints` и `final_checkpoint` с `min_grade`, `max_grade`, `week`, `key`; у студента `marks.regular`, `regularSum`, `additional`, `final`, `total`, `active_approvals` |
| Права | В журнале есть флаги `can_edit_*`, `can_approve_*`; у студента ожидаемо ложны |
| Согласие | `setAgreement` отмечает, что студент ознакомлен с системой оценивания; отменить нельзя |
| Идентификаторы | id БАРС не совпадают с id my.itmo |

## Покрытие в itmo-mcp

| Инструмент | Ручки |
|---|---|
| `bars_get_scores` | `users/current_user/`, `journal/disciplines?withCheckpointPlansOnly=true`, `journal/groups-and-flows?checkpointPlanId`, `marks/.../student` (до 4 параллельно) |

Сессия получается автоматически через ITMO.ID и хранится в памяти; при отказе БАРС забывается и запрашивается
заново. Смена периода, история, дедлайны и согласие не используются: инструмент читает только текущий период.
Контракт: [../../openapi/bars.yaml](../../openapi/bars.yaml).

## Риски и открытые вопросы

- Чтение другого семестра требует POST `/config/personal`, что меняет выбранный период и в веб-интерфейсе.
  ITMO.Widgets после чтения возвращает прежний период (статус: проекты); itmo-mcp так не делает.
- Форма ответов `history` и `deadline` не известна: на исследуемом аккаунте пустые массивы.
- Что произойдёт без согласия `agreement` (скрытие баллов или только баннер), не выяснено.
- Время жизни сессии около 30 минут получено наблюдением; сервер может завершить её раньше.
- Роль `/journal/cache` и `/journal/checkpoint-plans` для студента не изучена.

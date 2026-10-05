import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Russian summaries appended to tool descriptions. Users ask in Russian ("расписание", "май итмо", "БАРС"),
 * and clients that search deferred tools by keywords must be able to find these tools by such words.
 */
export const RUSSIAN_KEYWORDS: Record<string, string> = {
  itmo_get_profile: "Мой профиль ИТМО (my.itmo.ru, май итмо): ИСУ, ФИО, факультет, группа, курс.",
  itmo_search_people: "Поиск людей ИТМО: студенты, преподаватели, сотрудники, номер ИСУ, контакты.",
  itmo_get_person: "Профиль человека ИТМО по номеру ИСУ: должности, контакты, группа.",
  itmo_get_schedule: "Расписание пар ИТМО (my.itmo.ru, май итмо): какие пары сегодня, завтра, на неделе; аудитории, преподаватели.",
  itmo_get_grades: "Зачётка ИТМО (my.itmo.ru): оценки, баллы, экзамены и зачёты за семестр.",
  itmo_get_grade_details: "Разбивка баллов по дисциплине из зачётки ИТМО.",
  itmo_get_study_plan: "Учебный план ИТМО: дисциплины семестра, ЗЕТ, часы, кафедры, элективы.",
  itmo_get_sport_status: "Физкультура ИТМО: баллы, секции, ближайшие занятия, попытки записи, долги, группа здоровья.",
  itmo_get_sport_points_history: "История баллов по физкультуре ИТМО.",
  itmo_get_sport_schedule: "Расписание физкультуры ИТМО: занятия со свободными местами, куда можно записаться.",
  itmo_get_sport_filters: "Справочники физкультуры ИТМО: виды спорта, корпуса, семестры.",
  itmo_get_sport_competitions: "Спортивные соревнования ИТМО.",
  itmo_get_scholarship: "Стипендия ИТМО: выплаты и суммы по категориям.",
  itmo_get_dormitory: "Общежитие ИТМО: статус, договор, баланс, график оплаты.",
  itmo_get_room_bookings: "Мои брони аудиторий и коворкингов ИТМО.",
  itmo_get_queue_appointments: "Электронная очередь ИТМО: мои записи в деканат, студофис.",
  itmo_get_requests: "Мои заявки и справки ИТМО в my.itmo.ru (май итмо).",
  itmo_get_request_details: "Статус и поля поданной заявки ИТМО.",
  itmo_get_election_status: "Выбор дисциплин ИТМО (элективы): сроки кампании.",
  itmo_booking_places: "Бронирование аудиторий ИТМО: где можно забронировать коворкинг или аудиторию.",
  itmo_booking_search_rooms: "Поиск аудитории или коворкинга ИТМО для бронирования.",
  itmo_booking_availability: "Свободное время аудиторий и коворкингов ИТМО на дату.",
  itmo_requests_catalog: "Каталог заявок и справок ИТМО: справка с места учёбы, справка об обучении и другие.",
  itmo_request_form: "Поля формы заявки или справки ИТМО.",
  bars_get_scores: "БАРС ИТМО (bars.itmo.ru): баллы текущего семестра по контрольным точкам, лабораторным, экзамену.",
  itmo_sport_signup_preview: "Записаться на физкультуру ИТМО: предпросмотр записи на занятие или в секцию.",
  itmo_sport_cancel_preview: "Отписаться от занятия физкультурой ИТМО: предпросмотр.",
  itmo_sport_competition_preview: "Записаться на спортивное соревнование ИТМО или отказаться: предпросмотр.",
  itmo_booking_create_preview: "Забронировать аудиторию или коворкинг ИТМО: предпросмотр брони.",
  itmo_booking_cancel_preview: "Отменить свою бронь аудитории ИТМО: предпросмотр.",
  itmo_request_submit_preview: "Заказать справку или подать заявку в ИТМО (my.itmo.ru): предпросмотр.",
  itmo_request_cancel_preview: "Отменить поданную заявку ИТМО: предпросмотр.",
  itmo_confirm_action: "Подтвердить действие в ИТМО после предпросмотра: запись, бронь, заявка, отмена.",
};

/** Makes every tool registered on the server carry its Russian summary after the English description. */
export function withRussianKeywords(server: McpServer): McpServer {
  const register = server.registerTool.bind(server);
  const patched = (name: string, config: { description?: string }, callback: unknown) => {
    const russian = RUSSIAN_KEYWORDS[name];
    const description = russian ? `${config.description ?? ""}\n${russian}`.trim() : config.description;
    return register(name, { ...config, description } as never, callback as never);
  };
  server.registerTool = patched as unknown as typeof server.registerTool;
  return server;
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { result } from "../clients/my-itmo.js";
import { addDays, isoDate, today } from "./dates.js";
import type { ToolDeps } from "./deps.js";
import { READ_ONLY, run } from "./format.js";

export function registerCampusTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "itmo_get_scholarship",
    {
      title: "Scholarship and payouts",
      description:
        "Scholarship and other payouts: totals by category for a period and individual payments with breakdown. " +
        "Defaults to the last 365 days.",
      inputSchema: { date_from: isoDate.optional(), date_to: isoDate.optional() },
      annotations: { title: "Scholarship and payouts", ...READ_ONLY },
    },
    ({ date_from, date_to }) =>
      run(async () => {
        const to = date_to ?? today(deps.now());
        const from = date_from ?? addDays(to, -364);
        const [totals, payouts] = await Promise.all([
          result(
            "getScholarshipTotal",
            deps.my.GET("/api/finances/scholarship/total", { params: { query: { dateFrom: from, dateTo: to } } }),
          ),
          result("getScholarshipIncome", deps.my.GET("/api/finances/scholarship/income")),
        ]);
        return {
          range: { from, to },
          totals_rub: totals?.map((t) => ({ category: t.category_name.trim(), sum: t.sum })),
          payouts: payouts
            ?.filter((p) => p.payment_date.slice(0, 10) >= from && p.payment_date.slice(0, 10) <= to)
            .map((p) => ({
              date: p.payment_date.slice(0, 10),
              credited: p.payment.income?.map((i) => ({ item: i.item_name, sum: i.sum, account: i.account })),
              details: p.payment.income_details?.map((i) => ({ item: i.item_name, sum: i.sum })),
            })),
        };
      }),
  );

  server.registerTool(
    "itmo_get_dormitory",
    {
      title: "Dormitory",
      description: "Dormitory status (queue place, assigned dormitory and address) and housing contracts with balance and payment schedule.",
      annotations: { title: "Dormitory", ...READ_ONLY },
    },
    () =>
      run(async () => {
        const [status, periods] = await Promise.all([
          result("getDormitoryStatus", deps.my.GET("/api/dormitory/status/full")),
          result("getDormitoryPaymentPeriods", deps.my.GET("/api/dormitory/payments/contracts/periods")),
        ]);
        const latest = periods?.toSorted((a, b) => b.dateFrom.localeCompare(a.dateFrom))[0];
        const contracts = latest
          ? await result(
              "getDormitoryContracts",
              deps.my.GET("/api/dormitory/payments/contracts", {
                params: { query: { from: latest.dateFrom, to: latest.dateTo } },
              }),
            )
          : undefined;
        return {
          status: status && {
            status_id: status.statusId,
            queue_place: status.queuePlace,
            type: status.dormType,
            dormitory: status.assignedDormitory && {
              name: status.assignedDormitory.name,
              address: status.assignedDormitory.address,
            },
          },
          period: latest,
          contracts: contracts?.map((c) => ({
            number: c.number,
            name: c.name,
            active: c.active,
            start: c.dateStart?.slice(0, 10),
            end: c.dateEnd?.slice(0, 10),
            balance_rub: c.balance,
            payments: c.payments?.map((p) => ({ period: p.period, due: p.payUntil?.slice(0, 10), sum: p.sum, paid: p.paid })),
          })),
        };
      }),
  );

  server.registerTool(
    "itmo_get_room_bookings",
    {
      title: "My room bookings",
      description: "Rooms (meeting rooms, coworkings, classrooms) booked by or shared with the student.",
      annotations: { title: "My room bookings", ...READ_ONLY },
    },
    () =>
      run(async () => {
        const bookings = await result("getMyRoomBookings", deps.my.GET("/api/booking/bookings/my"));
        return bookings?.list?.map((b) => ({
          booking_id: b.booking_id,
          name: b.name,
          start: b.start_datetime,
          end: b.end_datetime,
          room: [b.room?.room_name, b.room?.room_number].filter(Boolean).join(" "),
          address: b.room?.address,
          status: b.status?.status_name,
          category: b.category?.category_name,
          participants: b.participants,
          owner: b.owner_fio,
        }));
      }),
  );

  server.registerTool(
    "itmo_get_queue_appointments",
    {
      title: "Electronic queue appointments",
      description: "Appointments in the ITMO electronic queue (dean's office, student office, etc.).",
      inputSchema: { include_past: z.boolean().default(false) },
      annotations: { title: "Electronic queue appointments", ...READ_ONLY },
    },
    ({ include_past }) =>
      run(async () => {
        const [current, past] = await Promise.all([
          result("getCurrentQueueEntries", deps.my.GET("/api/queues/current")),
          include_past ? result("getArchivedQueueEntries", deps.my.GET("/api/queues/archive")) : undefined,
        ]);
        const view = (entries: typeof current) =>
          entries?.map((q) => ({
            queue: q.table_name,
            address: q.table_address,
            time: q.date,
            consultant: q.consult_fio,
            comment: q.comment ?? q.queue_comment,
          }));
        return { upcoming: view(current) ?? [], past: view(past) };
      }),
  );

  server.registerTool(
    "itmo_get_requests",
    {
      title: "My requests",
      description: "Applications and certificate requests submitted through my.itmo.ru with their status.",
      annotations: { title: "My requests", ...READ_ONLY },
    },
    () =>
      run(async () => {
        const requests = await result("getMyRequests", deps.my.GET("/api/requests/my"));
        return requests?.map((r) => ({
          request_id: r.id,
          name: r.name,
          status: r.status_name,
          notice: r.notice,
          created: r.created_at,
          updated: r.updated_at,
        }));
      }),
  );

  server.registerTool(
    "itmo_get_election_status",
    {
      title: "Discipline election campaign",
      description: "Status and dates of the current elective discipline selection campaign.",
      annotations: { title: "Discipline election campaign", ...READ_ONLY },
    },
    () => run(() => result("getElectionAvailability", deps.my.GET("/api/election/students/availability"))),
  );
}

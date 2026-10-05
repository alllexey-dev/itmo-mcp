import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { result } from "../clients/my-itmo.js";
import type { PendingActions } from "./actions.js";
import { daysBetween, hourMinute, isoDate, minutesOf, moscowDateTime, moscowInstant, timeOf, today } from "./dates.js";
import type { ToolDeps } from "./deps.js";
import { PREVIEW, READ_ONLY, run, ToolRefusal } from "./format.js";

/** Statuses that occupy a room: approved, sent, needs editing, under review, done. */
const BUSY_STATUSES = [1, 2, 5, 6, 8];
/** Statuses an owner may cancel: approved, sent, draft, needs editing, under review. */
const CANCELLABLE_STATUSES = [1, 2, 4, 5, 6];
const DAY_START = 8 * 60;
const DAY_END = 23 * 60;
const MIN_DURATION = 30;

interface Interval {
  start: number;
  end: number;
}

/** Free intervals of the booking day after removing busy intervals. */
export function freeIntervals(busy: Interval[], dayStart = DAY_START, dayEnd = DAY_END): Interval[] {
  const free: Interval[] = [];
  let cursor = dayStart;
  for (const slot of [...busy].sort((a, b) => a.start - b.start)) {
    if (slot.start > cursor) free.push({ start: cursor, end: Math.min(slot.start, dayEnd) });
    cursor = Math.max(cursor, slot.end);
    if (cursor >= dayEnd) break;
  }
  if (cursor < dayEnd) free.push({ start: cursor, end: dayEnd });
  return free.filter((i) => i.end - i.start >= MIN_DURATION);
}

/** "+7 (921) 123-45-67" from any 10 or 11 digit Russian number. */
export function normalizePhone(phone: string): string | undefined {
  const digits = phone.replace(/\D/g, "");
  const local = digits.length === 11 && /^[78]/.test(digits) ? digits.slice(1) : digits.length === 10 ? digits : undefined;
  if (!local) return undefined;
  return `+7 (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6, 8)}-${local.slice(8, 10)}`;
}

const range = (i: Interval) => `${timeOf(i.start)}-${timeOf(i.end)}`;

export function registerBookingTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "itmo_booking_places",
    {
      title: "Bookable places",
      description:
        "Room groups (coworkings, meeting rooms, classrooms, halls) and their categories (usually buildings) " +
        "with how many days ahead they can be booked. Use category_id with itmo_booking_availability.",
      annotations: { title: "Bookable places", ...READ_ONLY },
    },
    () =>
      run(async () => {
        const groups = (await result("getBookingRoomGroups", deps.my.GET("/api/booking/dictionary/rooms/groups"))) ?? [];
        return Promise.all(
          groups.map(async (g) => {
            const categories = await result(
              "getBookingRoomCategories",
              deps.my.GET("/api/booking/dictionary/rooms/categories", { params: { query: { groupId: g.group_id } } }),
            );
            return {
              group: g.group_name,
              categories: categories?.map((c) => ({
                category_id: c.category_id,
                name: c.category_name,
                bookable_from_days: c.min_days,
                bookable_until_days: c.max_days,
              })),
            };
          }),
        );
      }),
  );

  server.registerTool(
    "itmo_booking_search_rooms",
    {
      title: "Find bookable rooms",
      description: "Find bookable rooms by name or number; returns room_id and category_id for availability and booking.",
      inputSchema: { query: z.string().min(1).describe("Room name or number, e.g. 1301 or Коворкинг") },
      annotations: { title: "Find bookable rooms", ...READ_ONLY },
    },
    ({ query }) =>
      run(async () => {
        const rooms = await result(
          "searchBookingRooms",
          deps.my.GET("/api/booking/rooms/byName", { params: { query: { search: query } } }),
        );
        return rooms?.map((r) => ({
          room_id: r.room_id,
          name: r.room_name,
          category_id: r.category?.category_id,
          category: r.category?.category_name,
          group: r.group?.group_name,
        }));
      }),
  );

  server.registerTool(
    "itmo_booking_availability",
    {
      title: "Room availability",
      description:
        "Free time (08:00-23:00, Moscow) of every room in a category on a date, with capacity and equipment. " +
        "Other people's bookings are shown only as busy time.",
      inputSchema: {
        category_id: z.number().int().describe("category_id from itmo_booking_places or itmo_booking_search_rooms"),
        date: isoDate,
        min_capacity: z.number().int().min(1).optional().describe("Only rooms that fit this many people"),
        room_id: z.number().int().optional(),
      },
      annotations: { title: "Room availability", ...READ_ONLY },
    },
    ({ category_id, date, min_capacity, room_id }) =>
      run(async () => {
        const [rooms, bookings, isu] = await Promise.all([
          result("getBookingRooms", deps.my.GET("/api/booking/rooms/roomsInCategory", { params: { query: { categoryId: category_id } } })),
          roomBookings(deps, category_id, date),
          deps.isu(),
        ]);
        return (rooms ?? [])
          .filter((r) => !room_id || r.room_id === room_id)
          .filter((r) => !min_capacity || (r.max_cap ?? Infinity) >= min_capacity)
          .map((r) => {
            const busy = bookings.get(r.room_id) ?? [];
            return {
              room_id: r.room_id,
              name: r.room_name,
              number: r.room_number,
              address: r.address,
              floor: r.floor,
              capacity: [r.min_cap, r.max_cap].filter((x) => x != null).join("-"),
              equipment: r.equipment?.map((e) => e.equipment_name),
              free: freeIntervals(busy).map(range),
              my_bookings: busy.filter((b) => b.owner === isu).map(range),
            };
          });
      }),
  );
}

export function registerBookingActionTools(server: McpServer, deps: ToolDeps, actions: PendingActions): void {
  server.registerTool(
    "itmo_booking_create_preview",
    {
      title: "Preview: book a room",
      description:
        "Checks a room booking (time window, booking horizon, capacity, overlaps) and prepares it. " +
        "Some rooms need approval after booking. Nothing changes until itmo_confirm_action.",
      inputSchema: {
        room_id: z.number().int(),
        category_id: z.number().int(),
        date: isoDate,
        start: hourMinute,
        end: hourMinute,
        title: z.string().min(1).max(200).describe("Event name shown in the booking"),
        participants: z.number().int().min(1),
        comment: z.string().max(1000).optional(),
        phone: z.string().optional().describe("Contact phone; defaults to the phone in the student's booking profile"),
      },
      annotations: { title: "Preview: book a room", ...PREVIEW },
    },
    (input) =>
      run(async () => {
        const start = minutesOf(input.start);
        const end = minutesOf(input.end);
        if (start < DAY_START || end > DAY_END) throw new ToolRefusal("Rooms can be booked between 08:00 and 23:00");
        if (end - start < MIN_DURATION) throw new ToolRefusal("A booking must last at least 30 minutes");
        if (moscowInstant(input.date, input.start) <= deps.now()) throw new ToolRefusal("The start time is in the past");

        const rooms = await result(
          "getBookingRooms",
          deps.my.GET("/api/booking/rooms/roomsInCategory", { params: { query: { categoryId: input.category_id } } }),
        );
        const room = rooms?.find((r) => r.room_id === input.room_id);
        if (!room) throw new ToolRefusal(`Room ${input.room_id} is not in category ${input.category_id}`);
        if (room.min_cap && input.participants < room.min_cap) throw new ToolRefusal(`The room needs at least ${room.min_cap} participants`);
        if (room.max_cap && input.participants > room.max_cap) throw new ToolRefusal(`The room fits at most ${room.max_cap} participants`);

        await checkHorizon(deps, room.group?.group_id, input.category_id, input.date);

        const busy = (await roomBookings(deps, input.category_id, input.date)).get(room.room_id) ?? [];
        const clash = busy.find((b) => b.start < end && start < b.end);
        if (clash) throw new ToolRefusal(`The room is busy ${range(clash)}; free: ${freeIntervals(busy).map(range).join(", ") || "none"}`);

        const profile = input.phone ? undefined : await result("getBookingUser", deps.my.GET("/api/booking/users/status"));
        const phone = normalizePhone(input.phone ?? profile?.phone_number ?? "");
        if (!phone) throw new ToolRefusal("A contact phone is needed: pass phone, e.g. +7 921 123-45-67");

        const booking = {
          name: input.title,
          additional_info: input.comment ?? "",
          participants: input.participants,
          contact_phone: phone,
          event_id: null,
          co_bookers: [],
          start_datetime: `${input.date} ${input.start.padStart(5, "0")}`,
          end_datetime: `${input.date} ${input.end.padStart(5, "0")}`,
          room_id: room.room_id,
          equipment: [],
          tech_support: false,
        };
        return actions.propose(
          {
            action: `Book ${room.room_name ?? room.room_number} on ${input.date} ${input.start}-${input.end}`,
            details: {
              room: room.room_name,
              number: room.room_number,
              address: room.address,
              date: input.date,
              time: `${input.start}-${input.end}`,
              title: input.title,
              participants: input.participants,
              contact_phone: phone,
              comment: input.comment,
            },
          },
          async () => {
            await result("createRoomBooking", deps.my.POST("/api/booking/bookings/", { body: [booking] }));
            const mine = await result("getMyRoomBookings", deps.my.GET("/api/booking/bookings/my"));
            const created = mine?.list?.find(
              (b) => b.room?.room_id === room.room_id && moscowDateTime(b.start_datetime).time === booking.start_datetime.slice(11),
            );
            return { booking_id: created?.booking_id, status: created?.status?.status_name };
          },
        );
      }),
  );

  server.registerTool(
    "itmo_booking_cancel_preview",
    {
      title: "Preview: cancel a room booking",
      description: "Prepares cancellation of the student's own room booking that has not started. Nothing changes until itmo_confirm_action.",
      inputSchema: { booking_id: z.number().int().describe("booking_id from itmo_get_room_bookings") },
      annotations: { title: "Preview: cancel a room booking", ...PREVIEW },
    },
    ({ booking_id }) =>
      run(async () => {
        const [mine, isu] = await Promise.all([
          result("getMyRoomBookings", deps.my.GET("/api/booking/bookings/my")),
          deps.isu(),
        ]);
        const booking = mine?.list?.find((b) => b.booking_id === booking_id);
        if (!booking) throw new ToolRefusal(`Booking ${booking_id} is not among the student's bookings`);
        if (booking.owner_isu !== isu) throw new ToolRefusal("Only the owner can cancel this booking");
        if (!CANCELLABLE_STATUSES.includes(booking.status?.status_id ?? -1)) {
          throw new ToolRefusal(`A booking in status "${booking.status?.status_name}" cannot be cancelled`);
        }
        if (new Date(booking.start_datetime) <= deps.now()) throw new ToolRefusal("The booking has already started");
        return actions.propose(
          {
            action: `Cancel the booking "${booking.name}" on ${booking.start_datetime}`,
            details: { room: booking.room?.room_name, start: booking.start_datetime, end: booking.end_datetime },
          },
          async () => {
            await result(
              "cancelRoomBooking",
              deps.my.DELETE("/api/booking/bookings/{bookingId}", { params: { path: { bookingId: booking_id } } }),
            );
            return { cancelled_booking_id: booking_id };
          },
        );
      }),
  );
}

/** Busy intervals per room on a date, keeping only the owner's ISU (never names). */
async function roomBookings(deps: ToolDeps, categoryId: number, date: string) {
  const rooms = await result(
    "getBookingRoomBookings",
    deps.my.GET("/api/booking/rooms/roomBookings", {
      params: { query: { categoryId, date, status: BUSY_STATUSES } },
    }),
  );
  const busy = new Map<number, (Interval & { owner?: number | null })[]>();
  for (const room of rooms ?? []) {
    busy.set(
      room.room_id,
      room.bookings
        .filter((b) => BUSY_STATUSES.includes(b.status?.status_id ?? 1))
        .map((b) => {
          const from = moscowDateTime(b.start_datetime);
          const to = moscowDateTime(b.end_datetime);
          return {
            start: from.date < date ? 0 : minutesOf(from.time),
            end: to.date > date ? 24 * 60 : minutesOf(to.time),
            owner: b.owner_isu,
          };
        }),
    );
  }
  return busy;
}

async function checkHorizon(deps: ToolDeps, groupId: number | undefined, categoryId: number, date: string) {
  if (!groupId) return;
  const categories = await result(
    "getBookingRoomCategories",
    deps.my.GET("/api/booking/dictionary/rooms/categories", { params: { query: { groupId } } }),
  );
  const category = categories?.find((c) => c.category_id === categoryId);
  const ahead = daysBetween(today(deps.now()), date);
  if (category?.min_days != null && ahead < category.min_days) {
    throw new ToolRefusal(`Rooms in this category must be booked at least ${category.min_days} days ahead`);
  }
  if (category?.max_days != null && ahead > category.max_days) {
    throw new ToolRefusal(`Rooms in this category can be booked at most ${category.max_days} days ahead`);
  }
}

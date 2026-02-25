import { addDays, addMonths, differenceInCalendarDays } from "date-fns";

export type IntervalUnit = "days" | "months";

export function addInterval(date: Date, value: number, unit: IntervalUnit): Date {
  return unit === "months" ? addMonths(date, value) : addDays(date, value);
}

export function adjustWeekend(date: Date): Date {
  const dow = date.getDay(); // 0=Dom, 6=Sáb
  if (dow === 6) return addDays(date, 2);
  if (dow === 0) return addDays(date, 1);
  return date;
}

export function calcNextDate(lastApplied: Date, value: number, unit: IntervalUnit): Date {
  return adjustWeekend(addInterval(lastApplied, value, unit));
}

export function daysToNext(nextDate: Date, today: Date): number {
  return differenceInCalendarDays(nextDate, today);
}

export type Status = "overdue" | "upcoming" | "later";

export function statusFromDays(days: number): Status {
  if (days < 0) return "overdue";
  if (days <= 60) return "upcoming";
  return "later";
}
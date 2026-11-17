const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

const sameDayInMonth = (anchor: Date, year: number, month: number): Date => {
  const normalizedYear = year + Math.floor(month / 12);
  const normalizedMonth = ((month % 12) + 12) % 12;
  return new Date(
    Date.UTC(
      normalizedYear,
      normalizedMonth,
      Math.min(anchor.getUTCDate(), daysInMonth(normalizedYear, normalizedMonth)),
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
};

/** Estimates the next monthly refill by repeating the cycle end's UTC day and time, clamped to short months. */
export const nextMonthlyRefill = (cycleEnd: Date, now: Date): Date | undefined => {
  if (Number.isNaN(cycleEnd.getTime()) || cycleEnd <= now) return undefined;
  const thisMonth = sameDayInMonth(cycleEnd, now.getUTCFullYear(), now.getUTCMonth());
  return thisMonth > now
    ? thisMonth
    : sameDayInMonth(cycleEnd, now.getUTCFullYear(), now.getUTCMonth() + 1);
};

const pad = (value: number): string => String(value).padStart(2, "0");

/** Formats a date as ISO 8601 in the local time zone with its UTC offset. */
export const localIso = (date: Date): string => {
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const absolute = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
};

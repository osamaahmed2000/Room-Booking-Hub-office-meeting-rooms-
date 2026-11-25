import { DomainError, Result } from '../models/booking.types';

export const CAIRO_TIMEZONE = 'Africa/Cairo';

export interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday .. 6 = Saturday */
  weekdayIndex: number;
  /** YYYY-MM-DD in the target timezone */
  date: string;
  /** Minutes since local midnight (0..1439) */
  minuteOfDay: number;
}

const WEEKDAY_MAP: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

const ISO_INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

const LOCAL_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function isValidCalendarDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return false;
  }
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day &&
    check.getUTCHours() === hour &&
    check.getUTCMinutes() === minute &&
    check.getUTCSeconds() === second
  );
}

/**
 * Normalizes a `Date` or ISO-8601 string (with explicit Z or +-HH:MM) to UTC epoch ms.
 */
export function parseInstantInput(value: Date | string): Result<number, DomainError> {
  if (value instanceof Date) {
    const ms = value.getTime();
    if (!Number.isFinite(ms)) {
      return {
        ok: false,
        error: { code: 'INVALID_TIMESTAMP', message: 'Invalid Date instance.' },
      };
    }
    return { ok: true, value: ms };
  }
  return parseIsoInstant(value);
}

/**
 * Parses an ISO-8601 timestamp with an explicit offset (Z or +-HH:MM) to UTC epoch ms.
 * Rejects date-only strings, naive local datetimes, and calendar overflows.
 */
export function parseIsoInstant(value: string): Result<number, DomainError> {
  if (typeof value !== 'string') {
    return {
      ok: false,
      error: { code: 'INVALID_TIMESTAMP', message: 'Timestamp must be a string.' },
    };
  }

  const match = ISO_INSTANT_RE.exec(value.trim());
  if (!match) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TIMESTAMP',
        message: 'Timestamp must be an ISO-8601 instant with explicit Z or +-HH:MM offset.',
      },
    };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;
  const ms = match[7] ? Number(match[7].padEnd(3, '0')) : 0;

  if (!isValidCalendarDateTime(year, month, day, hour, minute, second)) {
    return {
      ok: false,
      error: { code: 'INVALID_TIMESTAMP', message: 'Calendar date or time is out of range.' },
    };
  }

  let offsetMinutes = 0;
  if (match[8] !== 'Z') {
    const sign = match[9] === '-' ? -1 : 1;
    const offH = Number(match[10]);
    const offM = Number(match[11]);
    if (offH > 23 || offM > 59) {
      return {
        ok: false,
        error: { code: 'INVALID_TIMESTAMP', message: 'Timezone offset is out of range.' },
      };
    }
    offsetMinutes = sign * (offH * 60 + offM);
  }

  const utcMs =
    Date.UTC(year, month - 1, day, hour, minute, second, ms) -
    offsetMinutes * 60_000;
  return { ok: true, value: utcMs };
}

/**
 * Projects a UTC epoch ms instant into wall-clock parts for the given IANA timezone.
 */
export function getZonedDateTimeParts(
  epochMs: number,
  timeZone: string,
): ZonedDateTimeParts {
  const parts = getFormatter(timeZone).formatToParts(new Date(epochMs));
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let weekdayIndex = 0;

  for (const part of parts) {
    switch (part.type) {
      case 'year':
        year = Number(part.value);
        break;
      case 'month':
        month = Number(part.value);
        break;
      case 'day':
        day = Number(part.value);
        break;
      case 'hour':
        hour = Number(part.value) % 24;
        break;
      case 'minute':
        minute = Number(part.value);
        break;
      case 'second':
        second = Number(part.value);
        break;
      case 'weekday':
        weekdayIndex = WEEKDAY_MAP[part.value] ?? 0;
        break;
    }
  }

  const pad2 = (n: number) => String(n).padStart(2, '0');
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekdayIndex,
    date: `${year}-${pad2(month)}-${pad2(day)}`,
    minuteOfDay: hour * 60 + minute,
  };
}

function getZoneOffsetMs(epochMs: number, timeZone: string): number {
  const p = getZonedDateTimeParts(epochMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const roundedEpoch = Math.floor(epochMs / 1000) * 1000;
  return asUtc - roundedEpoch;
}

/**
 * Resolves an offsetless local wall-clock datetime (YYYY-MM-DDTHH:mm[:ss]) in `timeZone`
 * to a UTC epoch ms instant. Explicitly rejects nonexistent (spring-forward) and
 * ambiguous (fall-back) local times without silently shifting.
 */
export function resolveLocalDateTimeToInstant(
  localDateTime: string,
  timeZone: string,
): Result<number, DomainError> {
  const match = LOCAL_DATETIME_RE.exec(localDateTime.trim());
  if (!match) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TIMESTAMP',
        message: 'Local datetime must match YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss.',
      },
    };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;

  if (!isValidCalendarDateTime(year, month, day, hour, minute, second)) {
    return {
      ok: false,
      error: { code: 'INVALID_TIMESTAMP', message: 'Calendar date or time is out of range.' },
    };
  }

  const utcApprox = Date.UTC(year, month - 1, day, hour, minute, second);
  const baseOffset = getZoneOffsetMs(utcApprox, timeZone);
  const baseCandidate = utcApprox - baseOffset;

  const probeOffsets = new Set<number>([
    baseOffset,
    getZoneOffsetMs(baseCandidate - 3_600_000, timeZone),
    getZoneOffsetMs(baseCandidate + 3_600_000, timeZone),
    getZoneOffsetMs(baseCandidate - 7_200_000, timeZone),
    getZoneOffsetMs(baseCandidate + 7_200_000, timeZone),
  ]);

  const matches: number[] = [];
  for (const offset of probeOffsets) {
    const candidate = utcApprox - offset;
    const p = getZonedDateTimeParts(candidate, timeZone);
    if (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.hour === hour &&
      p.minute === minute &&
      p.second === second
    ) {
      matches.push(candidate);
    }
  }

  matches.sort((a, b) => a - b);

  if (matches.length === 0) {
    return {
      ok: false,
      error: {
        code: 'NONEXISTENT_LOCAL_TIME',
        message: `Local time ${localDateTime} does not exist in ${timeZone} due to DST transition.`,
      },
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      error: {
        code: 'AMBIGUOUS_LOCAL_TIME',
        message: `Local time ${localDateTime} is ambiguous in ${timeZone} due to DST fallback.`,
      },
    };
  }

  return { ok: true, value: matches[0]! };
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function formatLocalSlotToIsoUtc(
  dateStr: string,
  minuteOfDay: number,
  timeZone: string,
): Result<string, DomainError> {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const localStr = `${dateStr}T${pad2(hour)}:${pad2(minute)}:00`;
  const resolved = resolveLocalDateTimeToInstant(localStr, timeZone);
  if (!resolved.ok) return resolved;
  return { ok: true, value: new Date(resolved.value).toISOString() };
}

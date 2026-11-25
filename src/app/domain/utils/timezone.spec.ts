import { describe, expect, it } from 'vitest';
import {
  CAIRO_TIMEZONE,
  getZonedDateTimeParts,
  parseIsoInstant,
  resolveLocalDateTimeToInstant,
} from './timezone';

describe('timezone utilities (Africa/Cairo)', () => {
  it('normalizes Z, +02:00, and +03:00 ISO instants to identical epoch ms', () => {
    const utc = parseIsoInstant('2026-11-25T07:00:00Z');
    const cairoWinter = parseIsoInstant('2026-11-25T09:00:00+02:00');
    const offsetThree = parseIsoInstant('2026-11-25T10:00:00+03:00');

    expect(utc.ok).toBe(true);
    expect(cairoWinter.ok).toBe(true);
    expect(offsetThree.ok).toBe(true);

    if (utc.ok && cairoWinter.ok && offsetThree.ok) {
      expect(utc.value).toBe(cairoWinter.value);
      expect(cairoWinter.value).toBe(offsetThree.value);
    }
  });

  it('rejects date-only and offset-less local strings in parseIsoInstant', () => {
    const dateOnly = parseIsoInstant('2026-11-25');
    const naiveLocal = parseIsoInstant('2026-11-25T09:00:00');
    const garbage = parseIsoInstant('not-a-date');
    const impossibleMonth = parseIsoInstant('2026-13-01T09:00:00Z');

    expect(dateOnly.ok).toBe(false);
    expect(naiveLocal.ok).toBe(false);
    expect(garbage.ok).toBe(false);
    expect(impossibleMonth.ok).toBe(false);
  });

  it('projects winter (+02:00) and summer (+03:00) instants accurately in Africa/Cairo', () => {
    const winter = parseIsoInstant('2026-11-25T06:00:00Z');
    const summer = parseIsoInstant('2026-07-01T05:00:00Z');

    expect(winter.ok).toBe(true);
    expect(summer.ok).toBe(true);

    if (winter.ok && summer.ok) {
      const winterParts = getZonedDateTimeParts(winter.value, CAIRO_TIMEZONE);
      const summerParts = getZonedDateTimeParts(summer.value, CAIRO_TIMEZONE);

      expect(winterParts.date).toBe('2026-11-25');
      expect(winterParts.hour).toBe(8);
      expect(winterParts.minute).toBe(0);

      expect(summerParts.date).toBe('2026-07-01');
      expect(summerParts.hour).toBe(8);
      expect(summerParts.minute).toBe(0);
    }
  });

  it('detects nonexistent Cairo local wall-clock time on spring-forward DST transition', () => {
    // Egypt springs forward on 2026-04-24 at 00:00 -> 01:00
    const nonexistent = resolveLocalDateTimeToInstant(
      '2026-04-24T00:30:00',
      CAIRO_TIMEZONE,
    );

    expect(nonexistent.ok).toBe(false);
    if (!nonexistent.ok) {
      expect(nonexistent.error.code).toBe('NONEXISTENT_LOCAL_TIME');
    }
  });

  it('detects ambiguous Cairo local wall-clock time on fall-back DST transition', () => {
    // Egypt falls back on 2026-10-29 at 24:00 (2026-10-30 00:00 -> 2026-10-29 23:00)
    const ambiguous = resolveLocalDateTimeToInstant(
      '2026-10-29T23:30:00',
      CAIRO_TIMEZONE,
    );

    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) {
      expect(ambiguous.error.code).toBe('AMBIGUOUS_LOCAL_TIME');
    }
  });
});


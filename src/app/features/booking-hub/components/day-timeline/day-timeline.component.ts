import { Component, EventEmitter, Output, computed, inject } from '@angular/core';
import {
  Booking,
  DEFAULT_OFFICE_POLICY,
  Room,
  addDaysToDateString,
  getZonedDateTimeParts,
  parseIsoInstant,
} from '../../../../domain';
import { APP_CLOCK, BookingHubStore } from '../../../../state';
import { RoomFiltersComponent } from '../room-filters/room-filters.component';

export interface TimelineBlockView {
  booking: Booking;
  leftPercent: number;
  widthPercent: number;
  timeRangeLabel: string;
  isOwn: boolean;
}

export interface TimelineRowView {
  room: Room;
  blocks: TimelineBlockView[];
}

@Component({
  selector: 'app-day-timeline',
  standalone: true,
  imports: [RoomFiltersComponent],
  templateUrl: './day-timeline.component.html',
  styleUrl: './day-timeline.component.scss',
})
export class DayTimelineComponent {
  readonly store = inject(BookingHubStore);
  private readonly clock = inject(APP_CLOCK);

  @Output() readonly bookRoomRequested = new EventEmitter<{ roomId?: string }>();
  @Output() readonly bookingSelected = new EventEmitter<Booking>();

  readonly hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  private readonly dayStartMinute = DEFAULT_OFFICE_POLICY.dayHours[0]!.startMinute;
  private readonly totalMinutes =
    DEFAULT_OFFICE_POLICY.dayHours[0]!.endMinute - DEFAULT_OFFICE_POLICY.dayHours[0]!.startMinute;

  readonly timelineRows = computed<TimelineRowView[]>(() => {
    const uid = this.store.currentUserId();
    return this.store.roomTimelineData().map((entry) => ({
      room: entry.room,
      blocks: entry.bookings.map((booking) => {
        const leftPercent = this.getBlockLeftPercent(booking);
        return {
          booking,
          leftPercent,
          widthPercent: this.getBlockWidthPercent(booking, leftPercent),
          timeRangeLabel: this.formatCairoTimeRange(booking),
          isOwn: booking.userId === uid,
        };
      }),
    }));
  });

  onDateChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value) {
      void this.store.selectDate(value);
    }
  }

  previousDay(): void {
    void this.store.selectDate(addDaysToDateString(this.store.selectedDate(), -1));
  }

  nextDay(): void {
    void this.store.selectDate(addDaysToDateString(this.store.selectedDate(), 1));
  }

  goToToday(): void {
    const today = getZonedDateTimeParts(
      this.clock.nowMs(),
      DEFAULT_OFFICE_POLICY.timezone,
    ).date;
    void this.store.selectDate(today);
  }

  isOwnBooking(booking: Booking): boolean {
    return booking.userId === this.store.currentUserId();
  }

  getBlockLeftPercent(booking: Booking): number {
    const start = parseIsoInstant(booking.start);
    if (!start.ok) return 0;
    const parts = getZonedDateTimeParts(start.value, DEFAULT_OFFICE_POLICY.timezone);
    const offset = Math.max(0, parts.minuteOfDay - this.dayStartMinute);
    return Math.min(100, (offset / this.totalMinutes) * 100);
  }

  private getBlockWidthPercent(booking: Booking, leftPercent: number): number {
    const start = parseIsoInstant(booking.start);
    const end = parseIsoInstant(booking.end);
    if (!start.ok || !end.ok) return 10;
    const durationMin = Math.max(15, (end.value - start.value) / 60_000);
    return Math.min(100 - leftPercent, (durationMin / this.totalMinutes) * 100);
  }

  formatCairoTimeRange(booking: Booking): string {
    const s = parseIsoInstant(booking.start);
    const e = parseIsoInstant(booking.end);
    if (!s.ok || !e.ok) return '';
    const sp = getZonedDateTimeParts(s.value, DEFAULT_OFFICE_POLICY.timezone);
    const ep = getZonedDateTimeParts(e.value, DEFAULT_OFFICE_POLICY.timezone);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(sp.hour)}:${pad(sp.minute)}–${pad(ep.hour)}:${pad(ep.minute)}`;
  }

  formatHourLabel(hour: number): string {
    return `${String(hour).padStart(2, '0')}:00`;
  }
}


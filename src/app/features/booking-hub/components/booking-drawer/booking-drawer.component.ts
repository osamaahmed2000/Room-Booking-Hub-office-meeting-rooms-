import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  BookingDraft,
  DEFAULT_OFFICE_POLICY,
  DomainError,
  Equipment,
  RecurringWeekResult,
  Room,
  SlotSuggestion,
  getZonedDateTimeParts,
  resolveLocalDateTimeToInstant,
} from '../../../../domain';
import { DialogFocusDirective } from '../../../../shared/a11y/dialog-focus.directive';
import { BookingHubStore } from '../../../../state';

const EQUIPMENT_LIST: readonly { value: Equipment; label: string }[] = [
  { value: 'projector', label: 'Projector' },
  { value: 'whiteboard', label: 'Whiteboard' },
  { value: 'video', label: 'Video Conf' },
];

@Component({
  selector: 'app-booking-drawer',
  standalone: true,
  imports: [FormsModule, DialogFocusDirective],
  templateUrl: './booking-drawer.component.html',
  styleUrl: './booking-drawer.component.scss',
})
export class BookingDrawerComponent implements OnChanges {
  readonly store = inject(BookingHubStore);
  readonly equipmentList = EQUIPMENT_LIST;

  @Input() open = false;
  @Input() initialRoomId: string | null = null;
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly bookingCreated = new EventEmitter<string>();

  readonly title = signal('');
  readonly roomId = signal('');
  readonly date = signal('');
  readonly startTime = signal('09:00');
  readonly endTime = signal('10:00');
  readonly attendees = signal(2);
  readonly needs = signal<Equipment[]>([]);
  readonly recurringWeeks = signal(1);
  readonly touched = signal(false);

  readonly selectedRoom = computed<Room | undefined>(() =>
    this.store.rooms().find((r) => r.id === this.roomId()),
  );

  readonly draft = computed<BookingDraft | null>(() => {
    const d = this.date();
    const s = this.startTime();
    const e = this.endTime();
    if (!d || !s || !e) return null;

    const startInst = resolveLocalDateTimeToInstant(
      `${d}T${s}:00`,
      DEFAULT_OFFICE_POLICY.timezone,
    );
    const endInst = resolveLocalDateTimeToInstant(
      `${d}T${e}:00`,
      DEFAULT_OFFICE_POLICY.timezone,
    );

    if (!startInst.ok || !endInst.ok) {
      return {
        roomId: this.roomId(),
        userId: this.store.currentUserId(),
        title: this.title(),
        start: startInst.ok ? new Date(startInst.value).toISOString() : 'INVALID_LOCAL_TIME',
        end: endInst.ok ? new Date(endInst.value).toISOString() : 'INVALID_LOCAL_TIME',
        attendees: Number(this.attendees()),
        needs: this.needs(),
      };
    }

    return {
      roomId: this.roomId(),
      userId: this.store.currentUserId(),
      title: this.title().trim(),
      start: new Date(startInst.value).toISOString(),
      end: new Date(endInst.value).toISOString(),
      attendees: Number(this.attendees()),
      needs: this.needs(),
    };
  });

  readonly validationErrors = computed<DomainError[]>(() => {
    const d = this.draft();
    if (!d) {
      return [
        {
          code: 'INVALID_REQUEST',
          message: 'Please provide date, start time, and end time.',
        },
      ];
    }
    return this.store.validateDraft(d);
  });

  readonly recurringCheck = computed<{ ok: boolean; failedWeeks: RecurringWeekResult[] }>(() => {
    const weeks = Number(this.recurringWeeks());
    const d = this.draft();
    if (weeks <= 1 || !d) {
      return { ok: true, failedWeeks: [] };
    }
    const res = this.store.validateRecurringDraft(d, weeks);
    return { ok: res.ok, failedWeeks: res.failedWeeks };
  });

  readonly liveSuggestions = computed<SlotSuggestion[]>(() => {
    const d = this.draft();
    if (!d) return [];
    const hasConflictOrHoursIssue = this.validationErrors().some(
      (e) =>
        e.code === 'ROOM_CONFLICT' ||
        e.code === 'OUTSIDE_WORKING_HOURS' ||
        e.code === 'NON_WORKING_DAY' ||
        e.code === 'CAPACITY_EXCEEDED' ||
        e.code === 'MISSING_EQUIPMENT',
    );
    if (!hasConflictOrHoursIssue) return [];
    return this.store.suggestForDraft(d, 3);
  });

  readonly isValid = computed(
    () => this.validationErrors().length === 0 && this.recurringCheck().ok,
  );

  ngOnChanges(): void {
    if (this.open) {
      const rooms = this.store.rooms();
      const targetRoomId = this.initialRoomId ?? rooms[0]?.id ?? '';
      if (!this.roomId() || this.initialRoomId) {
        this.roomId.set(targetRoomId);
      }
      if (!this.store.error()) {
        this.date.set(this.store.selectedDate());
      }
      this.touched.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open && !this.store.submitting()) {
      this.closed.emit();
    }
  }

  toggleNeed(eq: Equipment): void {
    this.needs.update((prev) =>
      prev.includes(eq) ? prev.filter((item) => item !== eq) : [...prev, eq],
    );
  }

  hasNeed(eq: Equipment): boolean {
    return this.needs().includes(eq);
  }

  fieldErrors(field: DomainError['field']): DomainError[] {
    if (!this.touched() && this.title().trim().length === 0) return [];
    return this.validationErrors().filter((e) => e.field === field);
  }

  applySuggestion(slot: SlotSuggestion): void {
    const sp = getZonedDateTimeParts(slot.start.getTime(), DEFAULT_OFFICE_POLICY.timezone);
    const ep = getZonedDateTimeParts(slot.end.getTime(), DEFAULT_OFFICE_POLICY.timezone);
    const pad = (n: number) => String(n).padStart(2, '0');
    this.roomId.set(slot.roomId);
    this.date.set(sp.date);
    this.startTime.set(`${pad(sp.hour)}:${pad(sp.minute)}`);
    this.endTime.set(`${pad(ep.hour)}:${pad(ep.minute)}`);
  }

  getRoomName(id: string): string {
    return this.store.rooms().find((r) => r.id === id)?.name ?? id;
  }

  formatSuggestionLabel(slot: SlotSuggestion): string {
    const sp = getZonedDateTimeParts(slot.start.getTime(), DEFAULT_OFFICE_POLICY.timezone);
    const ep = getZonedDateTimeParts(slot.end.getTime(), DEFAULT_OFFICE_POLICY.timezone);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${this.getRoomName(slot.roomId)} · ${sp.date} ${pad(sp.hour)}:${pad(sp.minute)}–${pad(ep.hour)}:${pad(ep.minute)}`;
  }

  async submit(): Promise<void> {
    this.touched.set(true);
    const d = this.draft();
    if (!d || !this.isValid()) {
      return;
    }

    const weeks = Number(this.recurringWeeks());
    if (weeks > 1) {
      const recOutcome = await this.store.createRecurringBooking(d, weeks);
      if (recOutcome.ok) {
        const count = recOutcome.bookings.length;
        this.title.set('');
        this.needs.set([]);
        this.recurringWeeks.set(1);
        this.touched.set(false);
        this.bookingCreated.emit(`Booked ${count} weekly occurrences.`);
        this.closed.emit();
      } else if (recOutcome.reason === 'conflict') {
        this.closed.emit();
      }
      return;
    }

    const outcome = await this.store.createBooking(d);
    if (outcome.ok) {
      const createdTitle = outcome.booking.title;
      this.title.set('');
      this.needs.set([]);
      this.recurringWeeks.set(1);
      this.touched.set(false);
      this.bookingCreated.emit(`Booked "${createdTitle}" successfully.`);
      this.closed.emit();
    } else if (outcome.reason === 'conflict') {
      this.closed.emit();
    }
  }
}

import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  BOOKING_GATEWAY,
  BookingEventReconciler,
  GatewayError,
} from '../data';
import {
  Booking,
  BookingDraft,
  BookingEvent,
  DEFAULT_OFFICE_POLICY,
  DomainError,
  Equipment,
  RecurringWeekResult,
  Room,
  SlotSuggestion,
  deduplicateBookings,
  getZonedDateTimeParts,
  parseIsoInstant,
  suggestSlots,
  validateBooking,
  validateRecurringBooking,
} from '../domain';
import { APP_CLOCK } from './clock.token';

export interface RoomFilters {
  floor: number | null;
  minCapacity: number | null;
  requiredEquipment: Equipment[];
  searchQuery: string;
}

export interface ConflictDetails {
  draft: BookingDraft;
  conflicts: Booking[];
  message: string;
}

export interface RoomTimelineEntry {
  room: Room;
  bookings: Booking[];
}

export interface BookingCounts {
  totalActive: number;
  myActiveOnSelectedDate: number;
  quotaLimit: number;
  quotaRemaining: number;
}

export interface PendingUndoCancellation {
  booking: Booking;
  expiresAtMs: number;
}

export type CreateBookingOutcome =
  | { ok: true; booking: Booking }
  | { ok: false; reason: 'duplicate_submission' }
  | { ok: false; reason: 'validation'; errors: DomainError[] }
  | { ok: false; reason: 'conflict'; details: ConflictDetails; suggestions: SlotSuggestion[] }
  | { ok: false; reason: 'gateway_error'; error: GatewayError };

export type CreateRecurringOutcome =
  | { ok: true; bookings: Booking[] }
  | { ok: false; reason: 'duplicate_submission' }
  | { ok: false; reason: 'recurring_validation'; failedWeeks: RecurringWeekResult[] }
  | { ok: false; reason: 'conflict'; details: ConflictDetails; suggestions: SlotSuggestion[] }
  | { ok: false; reason: 'gateway_error'; error: GatewayError };

const UNDO_WINDOW_MS = 10_000;

@Injectable({ providedIn: 'root' })
export class BookingHubStore {
  private readonly gateway = inject(BOOKING_GATEWAY);
  private readonly clock = inject(APP_CLOCK);
  private readonly destroyRef = inject(DestroyRef);

  private readonly reconciler = new BookingEventReconciler();
  private initialized = false;
  private bookingsRequestSeq = 0;
  private optimisticCounter = 0;
  private readonly undoTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    this.destroyRef.onDestroy(() => {
      for (const timer of this.undoTimers.values()) {
        clearTimeout(timer);
      }
      this.undoTimers.clear();
    });
  }

  // Core writable state signals
  readonly rooms = signal<Room[]>([]);
  readonly bookings = signal<Booking[]>([]);
  readonly selectedDate = signal<string>(
    getZonedDateTimeParts(this.clock.nowMs(), DEFAULT_OFFICE_POLICY.timezone).date,
  );
  readonly selectedRoomId = signal<string | null>(null);
  readonly currentUserId = signal<string>('user-osama');
  readonly filters = signal<RoomFilters>({
    floor: null,
    minCapacity: null,
    requiredEquipment: [],
    searchQuery: '',
  });
  readonly loading = signal<boolean>(false);
  readonly submitting = signal<boolean>(false);
  readonly cancellingBookingIds = signal<ReadonlySet<string>>(new Set());
  readonly pendingUndoCancellations = signal<PendingUndoCancellation[]>([]);
  readonly error = signal<GatewayError | null>(null);
  readonly selectedBooking = signal<Booking | null>(null);
  readonly conflictDetails = signal<ConflictDetails | null>(null);
  readonly suggestedSlots = signal<SlotSuggestion[]>([]);

  // Derived computed signals
  readonly activeBookings = computed(() =>
    this.bookings().filter((b) => b.status === 'confirmed'),
  );

  readonly myBookings = computed(() => {
    const uid = this.currentUserId();
    return this.activeBookings()
      .filter((b) => b.userId === uid)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  });

  readonly availableRooms = computed(() => {
    const f = this.filters();
    const query = f.searchQuery.trim().toLowerCase();

    return this.rooms().filter((room) => {
      if (f.floor !== null && room.floor !== f.floor) return false;
      if (f.minCapacity !== null && room.capacity < f.minCapacity) return false;
      if (
        f.requiredEquipment.length > 0 &&
        !f.requiredEquipment.every((eq) => room.equipment.includes(eq))
      ) {
        return false;
      }
      if (query && !room.name.toLowerCase().includes(query)) return false;
      return true;
    });
  });

  readonly filteredBookings = computed(() => {
    const targetDate = this.selectedDate();
    const roomId = this.selectedRoomId();
    return this.activeBookings()
      .filter((b) => {
        if (roomId && b.roomId !== roomId) return false;
        const parsed = parseIsoInstant(b.start);
        if (!parsed.ok) return false;
        return (
          getZonedDateTimeParts(parsed.value, DEFAULT_OFFICE_POLICY.timezone).date ===
          targetDate
        );
      })
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  });

  readonly roomTimelineData = computed<RoomTimelineEntry[]>(() => {
    const dayBookings = this.filteredBookings();
    return this.availableRooms().map((room) => ({
      room,
      bookings: dayBookings.filter((b) => b.roomId === room.id),
    }));
  });

  readonly bookingCounts = computed<BookingCounts>(() => {
    const targetDate = this.selectedDate();
    const uid = this.currentUserId();
    const active = this.activeBookings();
    const myActiveOnSelectedDate = active.filter((b) => {
      if (b.userId !== uid) return false;
      const parsed = parseIsoInstant(b.start);
      if (!parsed.ok) return false;
      return (
        getZonedDateTimeParts(parsed.value, DEFAULT_OFFICE_POLICY.timezone).date ===
        targetDate
      );
    }).length;

    const quotaLimit = DEFAULT_OFFICE_POLICY.maxActiveBookingsPerDay;
    return {
      totalActive: active.length,
      myActiveOnSelectedDate,
      quotaLimit,
      quotaRemaining: Math.max(0, quotaLimit - myActiveOnSelectedDate),
    };
  });

  readonly canCreateBooking = computed(
    () => !this.submitting() && this.bookingCounts().quotaRemaining > 0,
  );

  async initialize(): Promise<void> {
    if (!this.initialized) {
      this.initialized = true;
      this.gateway.events$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((event) => this.handleBookingEvent(event));
    }

    await Promise.all([this.loadRooms(), this.loadBookings(this.selectedDate())]);
  }

  async loadRooms(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await this.gateway.getRooms();
      if (res.ok) {
        this.rooms.set(res.value);
        this.error.set(null);
      } else {
        this.error.set(res.error);
      }
    } finally {
      this.loading.set(false);
    }
  }

  async loadBookings(date: string): Promise<void> {
    const requestSeq = ++this.bookingsRequestSeq;
    this.loading.set(true);
    try {
      const res = await this.gateway.getBookings(date);
      if (requestSeq !== this.bookingsRequestSeq) {
        return;
      }
      if (res.ok) {
        const deduped = deduplicateBookings(res.value.bookings);
        this.reconciler.reset(res.value.seq, deduped);
        this.bookings.set(deduped);
        this.error.set(null);
      } else {
        this.error.set(res.error);
      }
    } finally {
      if (requestSeq === this.bookingsRequestSeq) {
        this.loading.set(false);
      }
    }
  }

  async selectDate(date: string): Promise<void> {
    this.selectedDate.set(date);
    this.clearConflict();
    await this.loadBookings(date);
  }

  selectRoom(roomId: string | null): void {
    this.selectedRoomId.set(roomId);
  }

  setFilters(partial: Partial<RoomFilters>): void {
    this.filters.update((prev) => ({ ...prev, ...partial }));
  }

  selectBooking(booking: Booking | null): void {
    this.selectedBooking.set(booking);
  }

  async createBooking(request: BookingDraft): Promise<CreateBookingOutcome> {
    if (this.submitting()) {
      return { ok: false, reason: 'duplicate_submission' };
    }

    this.submitting.set(true);
    this.error.set(null);
    this.clearConflict();

    let optimisticId: string | null = null;

    try {
      const now = new Date(this.clock.nowMs());
      const room = this.rooms().find((r) => r.id === request.roomId);
      const userBookings = this.bookings().filter((b) => b.userId === request.userId);
      const validation = validateBooking(
        request,
        room,
        this.bookings(),
        userBookings,
        now,
        DEFAULT_OFFICE_POLICY,
      );

      if (!validation.ok) {
        return { ok: false, reason: 'validation', errors: validation.errors };
      }

      // Optimistic insert before gateway call
      optimisticId = `optimistic-${++this.optimisticCounter}`;
      const optimisticBooking: Booking = {
        ...request,
        id: optimisticId,
        status: 'confirmed',
      };
      this.bookings.update((prev) => [...prev, optimisticBooking]);

      const res = await this.gateway.createBooking(request);
      if (res.ok) {
        this.bookings.update((prev) => prev.filter((b) => b.id !== optimisticId));
        this.bookings.set(
          this.reconciler.reconcileMutation(
            this.bookings(),
            res.value.booking,
            res.value.seq,
          ),
        );
        return { ok: true, booking: res.value.booking };
      }

      // Rollback optimistic booking on 409 or 500
      this.bookings.update((prev) => prev.filter((b) => b.id !== optimisticId));

      if (res.error.kind === 'conflict') {
        const parsedStart = parseIsoInstant(request.start);
        const affectedDate = parsedStart.ok
          ? getZonedDateTimeParts(parsedStart.value, DEFAULT_OFFICE_POLICY.timezone).date
          : this.selectedDate();

        await this.loadBookings(affectedDate);

        const freshNow = new Date(this.clock.nowMs());
        const suggestions = suggestSlots(
          request,
          this.rooms(),
          this.bookings(),
          freshNow,
          3,
          DEFAULT_OFFICE_POLICY,
        );

        const details: ConflictDetails = {
          draft: request,
          conflicts: res.error.conflicts,
          message: res.error.message,
        };
        this.conflictDetails.set(details);
        this.suggestedSlots.set(suggestions);

        return { ok: false, reason: 'conflict', details, suggestions };
      }

      this.error.set(res.error);
      return { ok: false, reason: 'gateway_error', error: res.error };
    } finally {
      this.submitting.set(false);
    }
  }

  async createRecurringBooking(
    request: BookingDraft,
    weeks: number,
  ): Promise<CreateRecurringOutcome> {
    if (this.submitting()) {
      return { ok: false, reason: 'duplicate_submission' };
    }

    this.submitting.set(true);
    this.error.set(null);
    this.clearConflict();

    try {
      const now = new Date(this.clock.nowMs());
      const room = this.rooms().find((r) => r.id === request.roomId);
      const userBookings = this.bookings().filter((b) => b.userId === request.userId);

      const recValidation = validateRecurringBooking(
        request,
        weeks,
        room,
        this.bookings(),
        userBookings,
        now,
        DEFAULT_OFFICE_POLICY,
      );

      if (!recValidation.ok) {
        return {
          ok: false,
          reason: 'recurring_validation',
          failedWeeks: recValidation.failedWeeks,
        };
      }

      const drafts: BookingDraft[] = recValidation.occurrences.map((occ) => ({
        ...request,
        start: occ.start.toISOString(),
        end: occ.end.toISOString(),
      }));

      if (!this.gateway.createRecurringBookings) {
        return {
          ok: false,
          reason: 'gateway_error',
          error: {
            kind: 'server_error',
            status: 500,
            message: 'Recurring booking is not supported by active gateway.',
            retryable: true,
            operation: 'createBooking',
          },
        };
      }

      const res = await this.gateway.createRecurringBookings(drafts);
      if (res.ok) {
        let next = [...this.bookings()];
        for (const created of res.value.bookings) {
          next = this.reconciler.reconcileMutation(next, created, res.value.seq);
        }
        this.bookings.set(next);
        return { ok: true, bookings: res.value.bookings };
      }

      if (res.error.kind === 'conflict') {
        await this.refreshBookings();
        const suggestions = suggestSlots(
          request,
          this.rooms(),
          this.bookings(),
          new Date(this.clock.nowMs()),
          3,
          DEFAULT_OFFICE_POLICY,
        );
        const details: ConflictDetails = {
          draft: request,
          conflicts: res.error.conflicts,
          message: res.error.message,
        };
        this.conflictDetails.set(details);
        this.suggestedSlots.set(suggestions);
        return { ok: false, reason: 'conflict', details, suggestions };
      }

      this.error.set(res.error);
      return { ok: false, reason: 'gateway_error', error: res.error };
    } finally {
      this.submitting.set(false);
    }
  }

  /**
   * Cancels with a 10-second Undo window. Optimistically marks cancelled in UI,
   * then commits DELETE to server after 10s unless undone.
   */
  requestCancelWithUndo(bookingId: string, undoMs: number = UNDO_WINDOW_MS): void {
    const target = this.bookings().find(
      (b) => b.id === bookingId && b.status === 'confirmed',
    );
    if (!target || this.undoTimers.has(bookingId)) return;

    this.bookings.update((prev) =>
      prev.map((b) => (b.id === bookingId ? { ...b, status: 'cancelled' } : b)),
    );
    if (this.selectedBooking()?.id === bookingId) {
      this.selectedBooking.set(null);
    }

    this.pendingUndoCancellations.update((prev) => [
      ...prev,
      { booking: target, expiresAtMs: this.clock.nowMs() + undoMs },
    ]);

    const timer = setTimeout(() => {
      this.undoTimers.delete(bookingId);
      this.pendingUndoCancellations.update((prev) =>
        prev.filter((item) => item.booking.id !== bookingId),
      );
      void this.commitServerCancel(target);
    }, undoMs);

    this.undoTimers.set(bookingId, timer);
  }

  undoPendingCancel(bookingId: string): void {
    const timer = this.undoTimers.get(bookingId);
    if (timer) {
      clearTimeout(timer);
      this.undoTimers.delete(bookingId);
    }
    const pending = this.pendingUndoCancellations().find(
      (item) => item.booking.id === bookingId,
    );
    this.pendingUndoCancellations.update((prev) =>
      prev.filter((item) => item.booking.id !== bookingId),
    );
    if (pending) {
      this.bookings.update((prev) =>
        prev.map((b) => (b.id === bookingId ? pending.booking : b)),
      );
    }
  }

  async cancelBooking(bookingId: string): Promise<boolean> {
    const target = this.bookings().find((b) => b.id === bookingId);
    return this.commitServerCancel(target ?? { id: bookingId } as Booking);
  }

  private async commitServerCancel(original: Booking): Promise<boolean> {
    const bookingId = original.id;
    if (this.cancellingBookingIds().has(bookingId)) {
      return false;
    }

    this.cancellingBookingIds.update((prev) => {
      const next = new Set(prev);
      next.add(bookingId);
      return next;
    });
    this.error.set(null);

    try {
      const res = await this.gateway.cancelBooking(bookingId);
      if (!res.ok) {
        // Restore confirmed state if optimistic undo-cancel failed on server
        if (original.status === 'confirmed') {
          this.bookings.update((prev) =>
            prev.map((b) => (b.id === bookingId ? original : b)),
          );
        }
        this.error.set(res.error);
        return false;
      }

      this.bookings.set(
        this.reconciler.reconcileMutation(
          this.bookings(),
          res.value.booking,
          res.value.seq,
        ),
      );

      if (this.selectedBooking()?.id === bookingId) {
        this.selectedBooking.set(res.value.booking);
      }
      return true;
    } finally {
      this.cancellingBookingIds.update((prev) => {
        const next = new Set(prev);
        next.delete(bookingId);
        return next;
      });
    }
  }

  handleBookingEvent(event: BookingEvent): void {
    const outcome = this.reconciler.apply(this.bookings(), event);
    if (outcome.applied) {
      this.bookings.set(outcome.bookings);
    }
    if (outcome.needsResync) {
      void this.refreshBookings();
    }
  }

  async refreshBookings(): Promise<void> {
    await this.loadBookings(this.selectedDate());
  }

  clearError(): void {
    this.error.set(null);
  }

  clearConflict(): void {
    this.conflictDetails.set(null);
    this.suggestedSlots.set([]);
  }

  validateDraft(draft: BookingDraft): DomainError[] {
    const room = this.rooms().find((r) => r.id === draft.roomId);
    const userBookings = this.bookings().filter((b) => b.userId === draft.userId);
    return validateBooking(
      draft,
      room,
      this.bookings(),
      userBookings,
      new Date(this.clock.nowMs()),
      DEFAULT_OFFICE_POLICY,
    ).errors;
  }

  validateRecurringDraft(draft: BookingDraft, weeks: number) {
    const room = this.rooms().find((r) => r.id === draft.roomId);
    const userBookings = this.bookings().filter((b) => b.userId === draft.userId);
    return validateRecurringBooking(
      draft,
      weeks,
      room,
      this.bookings(),
      userBookings,
      new Date(this.clock.nowMs()),
      DEFAULT_OFFICE_POLICY,
    );
  }

  suggestForDraft(draft: BookingDraft, limit: number = 3): SlotSuggestion[] {
    return suggestSlots(
      draft,
      this.rooms(),
      this.bookings(),
      new Date(this.clock.nowMs()),
      limit,
      DEFAULT_OFFICE_POLICY,
    );
  }
}

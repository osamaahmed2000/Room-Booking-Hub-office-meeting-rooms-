import { Booking, BookingEvent } from '../domain';

export interface ReconcileOutcome {
  bookings: Booking[];
  applied: boolean;
  needsResync: boolean;
}

/**
 * Reconciles global-sequence `BookingEvent` snapshots into a booking list:
 * - Events carry full `Booking` snapshots and a global monotonic `seq`.
 * - Deduplicates idempotently by `eventId`.
 * - Buffers future `seq > lastSeq + 1` events and drains contiguous runs.
 * - Never blindly discards an unseen lower-`seq` event if no newer event for
 *   that `booking.id` has been applied; signals `needsResync` on sequence gaps
 *   so the Store can refresh authoritative state when needed.
 */
export class BookingEventReconciler {
  private readonly seenEventIds = new Set<string>();
  private readonly lastEntitySeq = new Map<string, number>();
  private readonly pending = new Map<number, BookingEvent>();
  private lastSeq = 0;

  reset(snapshotSeq: number, bookings: readonly Booking[]): void {
    this.lastSeq = snapshotSeq;
    this.pending.clear();
    for (const b of bookings) {
      const prev = this.lastEntitySeq.get(b.id) ?? 0;
      if (snapshotSeq > prev) {
        this.lastEntitySeq.set(b.id, snapshotSeq);
      }
    }
  }

  get currentSeq(): number {
    return this.lastSeq;
  }

  /**
   * Reconciles a synchronous HTTP mutation response (201/200) without triggering
   * a spurious resync if the corresponding real-time event already arrived.
   */
  reconcileMutation(
    currentBookings: readonly Booking[],
    booking: Booking,
    seq: number,
  ): Booking[] {
    if (seq > this.lastSeq) {
      this.lastSeq = seq;
    }
    return this.upsertBooking([...currentBookings], booking, seq);
  }

  apply(currentBookings: readonly Booking[], event: BookingEvent): ReconcileOutcome {
    if (this.seenEventIds.has(event.eventId)) {
      return { bookings: [...currentBookings], applied: false, needsResync: false };
    }
    this.seenEventIds.add(event.eventId);

    let next = [...currentBookings];
    let applied = false;
    let needsResync = false;

    if (event.seq === this.lastSeq + 1) {
      next = this.upsertBooking(next, event.booking, event.seq);
      this.lastSeq = event.seq;
      applied = true;

      while (this.pending.has(this.lastSeq + 1)) {
        const queued = this.pending.get(this.lastSeq + 1)!;
        this.pending.delete(this.lastSeq + 1);
        next = this.upsertBooking(next, queued.booking, queued.seq);
        this.lastSeq = queued.seq;
      }
    } else if (event.seq > this.lastSeq + 1) {
      this.pending.set(event.seq, event);
      needsResync = true;
    } else {
      // Lower seq than global watermark, but unseen eventId:
      // Apply only if we haven't already applied a newer seq for this booking ID.
      const entitySeq = this.lastEntitySeq.get(event.booking.id) ?? 0;
      if (event.seq > entitySeq) {
        next = this.upsertBooking(next, event.booking, event.seq);
        applied = true;
      } else {
        needsResync = true;
      }
    }

    return { bookings: next, applied, needsResync };
  }

  private upsertBooking(
    list: Booking[],
    incoming: Booking,
    seq: number,
  ): Booking[] {
    const prevEntitySeq = this.lastEntitySeq.get(incoming.id) ?? 0;
    if (seq < prevEntitySeq) {
      return list;
    }
    this.lastEntitySeq.set(incoming.id, seq);

    const idx = list.findIndex((b) => b.id === incoming.id);
    if (idx === -1) {
      return [...list, incoming];
    }
    return list.map((b, i) => (i === idx ? incoming : b));
  }
}


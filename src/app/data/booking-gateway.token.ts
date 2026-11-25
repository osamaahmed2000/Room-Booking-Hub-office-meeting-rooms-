import { InjectionToken } from '@angular/core';
import { BookingGateway } from './booking.gateway';

export const BOOKING_GATEWAY = new InjectionToken<BookingGateway>('BOOKING_GATEWAY');


import { InjectionToken } from '@angular/core';

export interface AppClock {
  nowMs(): number;
}

export const APP_CLOCK = new InjectionToken<AppClock>('APP_CLOCK', {
  providedIn: 'root',
  factory: () => ({
    nowMs: () => Date.now(),
  }),
});


import { canPlayForRating } from '../ratingEligibility';

describe('canPlayForRating', () => {
  it('rejects null user', () => {
    expect(canPlayForRating(null, true)).toBe(false);
    expect(canPlayForRating(null, false)).toBe(false);
  });

  it('rejects guest flag', () => {
    expect(canPlayForRating({ email_confirmed_at: '2026-01-01T00:00:00Z' } as any, true))
      .toBe(false);
  });

  it('rejects user without confirmed email', () => {
    expect(canPlayForRating({ email_confirmed_at: null } as any, false)).toBe(false);
  });

  it('accepts confirmed-email user', () => {
    expect(canPlayForRating({ email_confirmed_at: '2026-01-01T00:00:00Z' } as any, false))
      .toBe(true);
  });
});

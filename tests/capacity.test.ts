/**
 * RG-05 — the capacity states.
 *
 * Small, but the boundaries are where a registrar makes a mistake: full is
 * exactly at capacity, and over-committed must never be read as full.
 */
import { describe, expect, it } from 'vitest';
import { capacityState } from '@/modules/admissions/capacity';

describe('capacity states', () => {
  it('is healthy with room to spare', () => {
    expect(capacityState(60, 30)).toBe('healthy');
  });

  it('is near capacity at nine in ten', () => {
    expect(capacityState(60, 54)).toBe('near_capacity');
    expect(capacityState(60, 53)).toBe('healthy');
  });

  it('is full at exactly capacity', () => {
    expect(capacityState(60, 60)).toBe('full');
  });

  it('is over-committed past capacity, and never mistaken for full', () => {
    // Should be impossible. If it happens, somebody who accepted a place
    // does not have one.
    expect(capacityState(60, 61)).toBe('over_committed');
  });

  it('treats a zero-capacity intake as full rather than healthy', () => {
    expect(capacityState(0, 0)).toBe('full');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import {
  FONT_SIZE_PERCENT_DEFAULT,
  FONT_SIZE_PERCENT_MAX,
  FONT_SIZE_PERCENT_MIN,
} from '@apicircle/shared';
import { applyFontSize, clampFontSizePercent } from './applyFontSize';

beforeEach(() => {
  document.documentElement.removeAttribute('data-font-size-percent');
  document.documentElement.style.removeProperty('font-size');
});

describe('clampFontSizePercent', () => {
  it('returns the default for non-finite inputs', () => {
    expect(clampFontSizePercent(NaN)).toBe(FONT_SIZE_PERCENT_DEFAULT);
    expect(clampFontSizePercent(Infinity)).toBe(FONT_SIZE_PERCENT_DEFAULT);
  });

  it('clamps below the minimum up to the minimum', () => {
    expect(clampFontSizePercent(20)).toBe(FONT_SIZE_PERCENT_MIN);
    expect(clampFontSizePercent(0)).toBe(FONT_SIZE_PERCENT_MIN);
  });

  it('clamps above the maximum down to the maximum', () => {
    expect(clampFontSizePercent(999)).toBe(FONT_SIZE_PERCENT_MAX);
    expect(clampFontSizePercent(200)).toBe(FONT_SIZE_PERCENT_MAX);
  });

  it('snaps values to the nearest 10% step', () => {
    expect(clampFontSizePercent(103)).toBe(100);
    expect(clampFontSizePercent(106)).toBe(110);
    expect(clampFontSizePercent(115)).toBe(120);
  });

  it('is identity for an in-range, on-step value', () => {
    expect(clampFontSizePercent(100)).toBe(100);
    expect(clampFontSizePercent(120)).toBe(120);
  });
});

describe('applyFontSize', () => {
  it('writes the clamped percent + render offset to html.style.fontSize', () => {
    applyFontSize(120);
    expect(document.documentElement.style.fontSize).toBe('130%');
  });

  it('sets the data-font-size-percent attribute to the stored (un-offset) value', () => {
    applyFontSize(110);
    expect(document.documentElement.getAttribute('data-font-size-percent')).toBe('110');
  });

  it('clamps before applying — out-of-range values never reach the DOM', () => {
    applyFontSize(9999);
    expect(document.documentElement.style.fontSize).toBe(`${FONT_SIZE_PERCENT_MAX + 10}%`);
  });

  it('does not touch localStorage — the workspace owns the persistence', () => {
    const before = localStorage.length;
    applyFontSize(110);
    expect(localStorage.length).toBe(before);
  });
});

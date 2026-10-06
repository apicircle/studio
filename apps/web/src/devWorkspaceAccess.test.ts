import { describe, expect, it } from 'vitest';
import { parseDevWorkspaceAccess } from './devWorkspaceAccess';

describe('parseDevWorkspaceAccess', () => {
  it('passes a whole-number cap through', () => {
    expect(parseDevWorkspaceAccess({ maxWorkspaces: 1 })).toEqual({ maxWorkspaces: 1 });
    expect(parseDevWorkspaceAccess({ maxWorkspaces: 3 })).toEqual({ maxWorkspaces: 3 });
  });

  it('passes an unlimited cap through', () => {
    expect(parseDevWorkspaceAccess({ maxWorkspaces: Infinity })).toEqual({
      maxWorkspaces: Infinity,
    });
  });

  it('reads nothing set as no policy, so the free-tier default applies', () => {
    expect(parseDevWorkspaceAccess(undefined)).toBeUndefined();
    expect(parseDevWorkspaceAccess(null)).toBeUndefined();
  });

  it('refuses a value that is not an object with a cap', () => {
    expect(parseDevWorkspaceAccess(3)).toBeUndefined();
    expect(parseDevWorkspaceAccess('Infinity')).toBeUndefined();
    expect(parseDevWorkspaceAccess({})).toBeUndefined();
    expect(parseDevWorkspaceAccess({ maxWorkspaces: '3' })).toBeUndefined();
  });

  it('refuses a cap below one, a fraction, NaN and negative infinity', () => {
    expect(parseDevWorkspaceAccess({ maxWorkspaces: 0 })).toBeUndefined();
    expect(parseDevWorkspaceAccess({ maxWorkspaces: -2 })).toBeUndefined();
    expect(parseDevWorkspaceAccess({ maxWorkspaces: 2.5 })).toBeUndefined();
    expect(parseDevWorkspaceAccess({ maxWorkspaces: NaN })).toBeUndefined();
    expect(parseDevWorkspaceAccess({ maxWorkspaces: -Infinity })).toBeUndefined();
  });

  it('keeps only the cap, never a notice smuggled in beside it', () => {
    expect(parseDevWorkspaceAccess({ maxWorkspaces: 2, lockedNotice: 'x' })).toEqual({
      maxWorkspaces: 2,
    });
  });
});

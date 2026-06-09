import { describe, it, expect } from 'vitest';
import { parseMessage } from './mockEndpointEditor';

describe('parseMessage — webview → host validation', () => {
  it('parses a valid save message', () => {
    const result = parseMessage({
      type: 'save',
      state: {
        endpointId: 'ep-1',
        method: 'POST',
        pathPattern: '/users/{id}',
        status: 200,
        bodyType: 'json',
        bodyContent: '{"ok":true}',
      },
    });
    expect(result).toEqual({
      type: 'save',
      state: {
        endpointId: 'ep-1',
        method: 'POST',
        pathPattern: '/users/{id}',
        status: 200,
        bodyType: 'json',
        bodyContent: '{"ok":true}',
      },
    });
  });

  it('parses a cancel message', () => {
    expect(parseMessage({ type: 'cancel' })).toEqual({ type: 'cancel' });
  });

  it('returns null when type is unknown', () => {
    expect(parseMessage({ type: 'inject', payload: '<script>' })).toBeNull();
  });

  it('returns null when state is missing for save', () => {
    expect(parseMessage({ type: 'save' })).toBeNull();
  });

  it('returns null when method is not in the allowlist', () => {
    expect(
      parseMessage({
        type: 'save',
        state: {
          endpointId: 'ep-1',
          method: 'TRACE',
          pathPattern: '/x',
          status: 200,
          bodyType: 'json',
          bodyContent: '',
        },
      }),
    ).toBeNull();
  });

  it('returns null when status is outside 100-599', () => {
    expect(
      parseMessage({
        type: 'save',
        state: {
          endpointId: 'ep-1',
          method: 'GET',
          pathPattern: '/x',
          status: 999,
          bodyType: 'json',
          bodyContent: '',
        },
      }),
    ).toBeNull();
    expect(
      parseMessage({
        type: 'save',
        state: {
          endpointId: 'ep-1',
          method: 'GET',
          pathPattern: '/x',
          status: 0,
          bodyType: 'json',
          bodyContent: '',
        },
      }),
    ).toBeNull();
  });

  it('returns null when status is a non-integer', () => {
    expect(
      parseMessage({
        type: 'save',
        state: {
          endpointId: 'ep-1',
          method: 'GET',
          pathPattern: '/x',
          status: 200.5,
          bodyType: 'json',
          bodyContent: '',
        },
      }),
    ).toBeNull();
  });

  it('returns null when bodyType is not in the allowlist', () => {
    expect(
      parseMessage({
        type: 'save',
        state: {
          endpointId: 'ep-1',
          method: 'GET',
          pathPattern: '/x',
          status: 200,
          bodyType: 'binary',
          bodyContent: '',
        },
      }),
    ).toBeNull();
  });

  it('returns null when endpointId is empty', () => {
    expect(
      parseMessage({
        type: 'save',
        state: {
          endpointId: '',
          method: 'GET',
          pathPattern: '/x',
          status: 200,
          bodyType: 'json',
          bodyContent: '',
        },
      }),
    ).toBeNull();
  });

  it('returns null for null + non-object input', () => {
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage(undefined)).toBeNull();
    expect(parseMessage('save')).toBeNull();
    expect(parseMessage(42)).toBeNull();
  });
});

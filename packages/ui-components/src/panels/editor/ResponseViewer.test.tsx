import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ExecutionResult } from '@apicircle/core';
import { ResponseViewer } from './ResponseViewer';

const failed = (error: string): ExecutionResult => ({
  startedAt: '2026-10-19T00:00:00.000Z',
  durationMs: 0,
  status: null,
  ok: false,
  statusText: '',
  headers: {},
  body: '',
  bodyKind: 'empty',
  error,
  url: '',
  method: 'GET',
  authWarnings: [],
});

describe('ResponseViewer — error panel', () => {
  it('labels a refused request "Not sent" and shows the reason as the hint', () => {
    const reason =
      '{{ADMIN_TOKEN_ENCRYPTION_KEY}} is the encryption key of ADMIN_TOKEN, not a variable, ' +
      'so its value is never sent. Write {{ADMIN_TOKEN}} to send the variable.';
    render(
      <ResponseViewer result={failed(`Not sent. ${reason}`)} assertions={[]} isExecuting={false} />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Not sent');
    expect(alert).toHaveTextContent(reason);
    expect(alert).not.toHaveTextContent('the executor surfaced this verbatim');
  });

  it('keeps the generic label for any other error', () => {
    render(<ResponseViewer result={failed('boom')} assertions={[]} isExecuting={false} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'ErrorSee the message below — the executor surfaced this verbatim.',
    );
  });
});

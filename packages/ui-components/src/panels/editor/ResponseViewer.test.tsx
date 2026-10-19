import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionResult } from '@apicircle/core';
import { ResponseViewer } from './ResponseViewer';
import * as download from '../../primitives/download';

const failed = (error: string, extra: Partial<ExecutionResult> = {}): ExecutionResult => ({
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
  ...extra,
});

const ok = (body = '{"id":1}'): ExecutionResult => ({
  startedAt: '2026-10-19T00:00:00.000Z',
  durationMs: 42,
  status: 200,
  ok: true,
  statusText: 'OK',
  headers: { 'content-type': 'application/json' },
  body,
  bodyKind: 'text',
  url: 'https://api.example.test/users/1',
  method: 'GET',
  authWarnings: [],
});

afterEach(() => {
  vi.useRealTimers();
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
    // The reason once, as the hint — not again as a raw message with its prefix.
    expect(within(alert).queryByText(`Not sent. ${reason}`)).toBeNull();
  });

  it('shows the message itself first, verbatim, for an error it cannot explain', () => {
    render(<ResponseViewer result={failed('boom')} assertions={[]} isExecuting={false} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/^Errorboom/);
    expect(within(alert).getByText('boom')).toHaveClass('font-mono');
    expect(alert).not.toHaveTextContent('the executor surfaced this verbatim');
  });

  it('puts the message before the guess at its cause', () => {
    render(
      <ResponseViewer
        result={failed('TypeError: Failed to fetch')}
        assertions={[]}
        isExecuting={false}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(
      /^Network errorTypeError: Failed to fetchThe browser could not reach the host/,
    );
  });

  it('keeps the request’s method, URL and duration under Request details', () => {
    render(
      <ResponseViewer
        result={failed('socket hang up', {
          method: 'POST',
          url: 'https://api.example.test/x',
          durationMs: 12,
        })}
        assertions={[]}
        isExecuting={false}
      />,
    );
    const details = screen.getByText('Request details').closest('details')!;
    expect(details).toHaveTextContent('POST');
    expect(details).toHaveTextContent('https://api.example.test/x');
    expect(details).toHaveTextContent('12 ms');
    // The message is shown above, not repeated in the details.
    expect(details).not.toHaveTextContent('socket hang up');
  });
});

describe('ResponseViewer — status line', () => {
  it('says "No response" rather than a bare ERR, and leads with the message', () => {
    render(
      <ResponseViewer
        result={failed('connect ECONNREFUSED 127.0.0.1:9', { durationMs: 7 })}
        assertions={[]}
        isExecuting={false}
      />,
    );
    expect(screen.queryByText('ERR')).toBeNull();
    const badge = screen.getByText('No response');
    const message = screen.getAllByText('connect ECONNREFUSED 127.0.0.1:9')[0];
    expect(message).toHaveAttribute('title', 'connect ECONNREFUSED 127.0.0.1:9');
    // Badge, then the message, then how long it took.
    expect(badge.nextElementSibling).toBe(message);
    expect(message.nextElementSibling).toHaveTextContent('7 ms');
  });

  it('shows a refused request as "Not sent", without its prefix and without a duration', () => {
    render(
      <ResponseViewer
        result={failed('Not sent. The key is not a variable.')}
        assertions={[]}
        isExecuting={false}
      />,
    );
    const badge = screen.getAllByText('Not sent')[0];
    expect(badge.nextElementSibling).toHaveTextContent(/^The key is not a variable\.$/);
    expect(badge.nextElementSibling!.nextElementSibling).not.toHaveTextContent('ms');
  });

  it('shows status, duration and size for a response', () => {
    render(<ResponseViewer result={ok()} assertions={[]} isExecuting={false} />);
    expect(screen.getByText('200 OK')).toBeInTheDocument();
    expect(screen.getByText('42 ms')).toBeInTheDocument();
    expect(screen.queryByText('No response')).toBeNull();
  });

  it('shows a dash for a result that carries no status code and no error', () => {
    render(
      <ResponseViewer
        result={{ ...ok(), status: null, statusText: '' }}
        assertions={[]}
        isExecuting={false}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('ResponseViewer — while sending', () => {
  it('waits on the brand mark with a running time on the first send', () => {
    vi.useFakeTimers();
    const { container } = render(
      <ResponseViewer result={null} assertions={[]} isExecuting={true} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Sending request…');
    expect(container.querySelector('svg[data-brand-loader="full"]')).not.toBeNull();
    const elapsed = screen.getByTestId('response-elapsed');
    // The ticking time is not announced; only the status is.
    expect(elapsed).toHaveAttribute('aria-hidden', 'true');
    expect(elapsed).toHaveTextContent('0.0 s');
    act(() => {
      vi.advanceTimersByTime(1250);
    });
    expect(elapsed).toHaveTextContent('1.2 s');
  });

  it('counts minutes once a send passes one', () => {
    vi.useFakeTimers();
    render(<ResponseViewer result={null} assertions={[]} isExecuting={true} />);
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByTestId('response-elapsed')).toHaveTextContent('1 min 05 s');
  });

  it('keeps the last response up, dimmed and marked busy, until the new one arrives', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <ResponseViewer result={ok('{"id":1}')} assertions={[]} isExecuting={true} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Sending request…');
    expect(
      screen.getByText('The last response stays here until the new one arrives.'),
    ).toBeInTheDocument();
    expect(container.querySelector('svg[data-brand-loader="compact"]')).not.toBeNull();
    const content = screen.getByTestId('response-content');
    expect(content).toHaveAttribute('aria-busy', 'true');
    expect(content).toHaveClass('opacity-50');
    // The previous response is still readable underneath.
    expect(screen.getByText('200 OK')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId('response-elapsed')).toHaveTextContent('0.3 s');

    // The new response lands: no strip, no dimming, no busy mark.
    rerender(<ResponseViewer result={ok('{"id":2}')} assertions={[]} isExecuting={false} />);
    expect(screen.queryByText('Sending request…')).toBeNull();
    expect(screen.getByTestId('response-content')).not.toHaveAttribute('aria-busy');
    expect(screen.getByTestId('response-content')).not.toHaveClass('opacity-50');

    // A further send starts its clock from zero again.
    rerender(<ResponseViewer result={ok('{"id":2}')} assertions={[]} isExecuting={true} />);
    expect(screen.getByTestId('response-elapsed')).toHaveTextContent('0.0 s');
  });

  it('asks for a first Send when there is nothing yet', () => {
    render(<ResponseViewer result={null} assertions={[]} isExecuting={false} />);
    expect(screen.getByText(/to run this request\./)).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('ResponseViewer — Copy, Save and Raw', () => {
  // The editor mounts a tick after the panel does.
  const shownBody = async (): Promise<string> =>
    ((await screen.findByTestId('monaco-editor-mock')) as HTMLTextAreaElement).value;
  const json = (text: string, extra: Partial<ExecutionResult> = {}): ExecutionResult => ({
    ...ok(text),
    bodyKind: 'json',
    ...extra,
  });
  const PRETTY = JSON.stringify({ id: 1, tags: ['a'] }, null, 2);

  it('shows a JSON body formatted, and Raw shows it exactly as it came', async () => {
    render(
      <ResponseViewer result={json('{"id":1,"tags":["a"]}')} assertions={[]} isExecuting={false} />,
    );
    expect(await shownBody()).toBe(PRETTY);
    const rawToggle = screen.getByRole('button', { name: 'Raw' });
    expect(rawToggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(rawToggle);
    expect(rawToggle).toHaveAttribute('aria-pressed', 'true');
    expect(await shownBody()).toBe('{"id":1,"tags":["a"]}');
    await userEvent.click(rawToggle);
    expect(await shownBody()).toBe(PRETTY);
  });

  it('offers no Raw where the body is shown as it came anyway', () => {
    const { rerender } = render(
      <ResponseViewer
        result={json('plain words', {
          headers: { 'content-type': 'text/plain' },
          bodyKind: 'text',
        })}
        assertions={[]}
        isExecuting={false}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Raw' })).toBeNull();
    // JSON that already arrived formatted has nothing else to show either.
    rerender(<ResponseViewer result={json(PRETTY)} assertions={[]} isExecuting={false} />);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Raw' })).toBeNull();
  });

  it('copies the body as shown, and says "Copied" for two seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // user-event puts a clipboard of its own on the page; read what it holds.
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    render(<ResponseViewer result={json('{"id":1}')} assertions={[]} isExecuting={false} />);
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe(JSON.stringify({ id: 1 }, null, 2));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Response body copied');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();

    // With Raw on, the copy is the body as received.
    await user.click(screen.getByRole('button', { name: 'Raw' }));
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe('{"id":1}');
  });

  it('says so when the copy fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    render(<ResponseViewer result={json('{"id":1}')} assertions={[]} isExecuting={false} />);
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Couldn’t copy' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Could not copy the response body');
  });

  it('saves the body as received, named after the URL', async () => {
    const save = vi.spyOn(download, 'downloadTextFile').mockReturnValue(true);
    render(<ResponseViewer result={json('{"id":1}')} assertions={[]} isExecuting={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith('1.json', '{"id":1}', 'application/json');
  });

  it('saves as plain text when the response names no type', async () => {
    const save = vi.spyOn(download, 'downloadTextFile').mockReturnValue(true);
    render(
      <ResponseViewer
        result={json('hello', { headers: {}, bodyKind: 'text', url: 'https://api.example.test/' })}
        assertions={[]}
        isExecuting={false}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith('api.example.test.txt', 'hello', 'text/plain');
  });

  it('keeps Save off for a binary body, and says why', () => {
    render(
      <ResponseViewer
        result={json('PK', {
          headers: { 'content-type': 'application/octet-stream' },
          bodyKind: 'binary',
        })}
        assertions={[]}
        isExecuting={false}
      />,
    );
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription(/This response is binary/);
    // Copy still works on what is shown.
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
  });

  it('shows the body tools only on the Body tab, and only for a body', async () => {
    const { rerender } = render(
      <ResponseViewer result={json('{"id":1}')} assertions={[]} isExecuting={false} />,
    );
    const tools = () => screen.queryByRole('group', { name: 'Response body actions' });
    await userEvent.click(screen.getByRole('tab', { name: 'Headers' }));
    expect(tools()).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Body' }));
    expect(tools()).toBeInTheDocument();
    rerender(<ResponseViewer result={json('')} assertions={[]} isExecuting={false} />);
    expect(tools()).toBeNull();
    rerender(<ResponseViewer result={failed('boom')} assertions={[]} isExecuting={false} />);
    expect(tools()).toBeNull();
  });
});

describe('ResponseViewer — fullscreen', () => {
  it('opens the panel fullscreen, tools and all', async () => {
    render(<ResponseViewer result={ok('{"id":1}')} assertions={[]} isExecuting={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fullscreen response panel' }));
    const overlay = screen.getByRole('dialog', { name: 'Response' });
    expect(
      within(overlay).getByRole('group', { name: 'Response body actions' }),
    ).toBeInTheDocument();
    // The control that opened it is not drawn inside it.
    expect(screen.queryByRole('button', { name: 'Fullscreen response panel' })).toBeNull();
  });
});

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshToken, type ExecutionResult } from '@apicircle/core';
import type * as Core from '@apicircle/core';
import type { Request as ApiRequest, RequestAuth } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { renderWithStore } from '../../../test/renderWithStore';
import { BinaryEditor } from './BinaryEditor';
import { ContextTab } from './ContextTab';
import { EditorPanel } from './EditorPanel';
import { OAuth2FlowActions } from './OAuth2FlowActions';

// A disabled control in the request editor says why (STU-UX-16), and the
// large-file warning says it without storage jargon (STU-UX-15).

vi.mock('@apicircle/core', async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  refreshToken: vi.fn(),
}));

const result = (overrides: Partial<ExecutionResult>): ExecutionResult => ({
  startedAt: '2026-10-19T00:00:00.000Z',
  durationMs: 1,
  status: 200,
  ok: true,
  statusText: 'OK',
  headers: {},
  body: '',
  bodyKind: 'empty',
  url: 'https://api.example.test/x',
  method: 'GET',
  authWarnings: [],
  ...overrides,
});

describe('ContextTab — Pick JSON path for an extraction', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  function LiveContextTab({ requestId }: { requestId: string }) {
    const request = useWorkspaceStore(
      (s) => s.synced?.collections.requests[requestId],
    ) as ApiRequest;
    return <ContextTab request={request} />;
  }

  function seed(): string {
    const id = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore
      .getState()
      .setRequestExtractions(id, [
        { id: 'e1', variable: 'V', source: 'body', path: '', enabled: true },
      ]);
    return id;
  }

  it('says to send first, then that the response is not JSON, and opens on a JSON one', async () => {
    const id = seed();
    render(<LiveContextTab requestId={id} />);
    const pick = screen.getByRole('button', { name: 'Pick JSON path for extraction 1' });
    expect(pick).toBeDisabled();
    expect(pick).toHaveAccessibleDescription('Send the request first to capture a response.');
    expect(pick).not.toHaveAttribute('title');

    act(() => {
      useWorkspaceStore.setState({ lastRun: { [id]: result({ body: 'hi', bodyKind: 'text' }) } });
    });
    expect(pick).toHaveAccessibleDescription('The last response is not JSON.');

    act(() => {
      useWorkspaceStore.setState({
        lastRun: { [id]: result({ body: '{"id":1}', bodyKind: 'json' }) },
      });
    });
    expect(pick).toBeEnabled();
    expect(pick).toHaveAttribute('title', 'Pick a JSON path from the last response');
    await userEvent.click(pick);
    expect(screen.getByRole('dialog', { name: 'Pick a JSON path' })).toBeInTheDocument();
  });
});

describe('OAuth2FlowActions — Refresh and Clear say why they wait', () => {
  type AuthCode = Extract<RequestAuth, { type: 'oauth2-auth-code' }>;
  const authCode = (overrides: Partial<AuthCode> = {}): AuthCode => ({
    type: 'oauth2-auth-code',
    authUrl: 'https://idp/authorize',
    tokenUrl: 'https://idp/token',
    clientId: 'c',
    clientSecret: 's',
    redirectUri: '',
    scope: 'read',
    state: '',
    accessToken: '',
    tokenType: 'Bearer',
    refreshToken: '',
    expiresAt: null,
    obtainedScope: '',
    ...overrides,
  });
  const refresh = () => screen.getByRole('button', { name: 'Refresh' });
  const clear = () => screen.getByRole('button', { name: 'Clear' });

  it('with no token yet', () => {
    render(<OAuth2FlowActions auth={authCode()} onChange={vi.fn()} />);
    expect(refresh()).toHaveAccessibleDescription('Get a token first.');
    expect(clear()).toBeDisabled();
    expect(clear()).toHaveAccessibleDescription('There is no token to clear.');
  });

  it('for the implicit grant, which issues no refresh token', () => {
    const implicit: RequestAuth = {
      type: 'oauth2-implicit',
      authUrl: 'https://idp/authorize',
      clientId: 'c',
      redirectUri: '',
      scope: 'read',
      accessToken: 'tok',
      tokenType: 'Bearer',
      expiresAt: null,
      obtainedScope: '',
    };
    render(<OAuth2FlowActions auth={implicit} onChange={vi.fn()} />);
    expect(refresh()).toHaveAccessibleDescription(/The implicit grant issues no refresh token/);
    expect(clear()).toBeEnabled();
  });

  it('when the server sent no refresh token', () => {
    render(<OAuth2FlowActions auth={authCode({ accessToken: 'tok' })} onChange={vi.fn()} />);
    expect(refresh()).toBeDisabled();
    expect(refresh()).toHaveAccessibleDescription(/The server sent no refresh token/);
  });

  it('refreshes, and asks before it clears, once there is a token to work with', async () => {
    // Set here: the setup's restoreAllMocks clears a mock's implementation after each test.
    vi.mocked(refreshToken).mockResolvedValue({
      accessToken: 'fresh',
      tokenType: 'Bearer',
      raw: {},
    });
    const onChange = vi.fn();
    render(
      <OAuth2FlowActions
        auth={authCode({ accessToken: 'tok', refreshToken: 'r' })}
        onChange={onChange}
      />,
    );
    expect(refresh()).toBeEnabled();
    expect(refresh()).not.toHaveAttribute('aria-describedby');
    await userEvent.click(refresh());
    expect(await screen.findByText('Token refreshed.')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'fresh' }));
    await userEvent.click(clear());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('BinaryEditor — a file over 100 MB', () => {
  it('warns in plain words, and still attaches it', async () => {
    const attachBinaryFile = vi.fn().mockResolvedValue(undefined);
    await renderWithStore(<div />);
    let request: ApiRequest | null = null;
    act(() => {
      const id = useWorkspaceStore.getState().addRequest(null);
      useWorkspaceStore.getState().setRequestBody(id, { type: 'binary', content: '' });
      useWorkspaceStore.setState({ attachBinaryFile });
      request = useWorkspaceStore.getState().synced!.collections.requests[id];
    });
    render(<BinaryEditor request={request!} />);
    const big = new File(['x'], 'huge.bin', { type: 'application/octet-stream' });
    Object.defineProperty(big, 'size', { value: 101 * 1024 * 1024 });
    await userEvent.upload(screen.getByLabelText('Binary body file'), big);
    const toast = useWorkspaceStore.getState().toasts.at(-1)!;
    expect(toast.title).toBe('File is over 100 MB');
    expect(toast.detail).toMatch(/may not fit in this device's storage/);
    expect(toast.detail).not.toMatch(/IDB|blob/);
    expect(attachBinaryFile).toHaveBeenCalledWith(request!.id, big);
  });
});

describe('EditorPanel — Send', () => {
  it('is the solid main action, and says why while the checks below block it', async () => {
    await renderWithStore(<EditorPanel />);
    let id = '';
    act(() => {
      id = useWorkspaceStore.getState().addRequest(null, 'List users');
    });
    const send = await screen.findByRole('button', { name: 'Send' });
    expect(send).toHaveClass('bg-accent', 'text-on-accent');
    expect(send).toHaveAttribute(
      'title',
      expect.stringMatching(/^Sends with the active environment/),
    );

    act(() => useWorkspaceStore.getState().setRequestUrl(id, ''));
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription(
      'Fix the problems listed below the address before sending.',
    );
    expect(send).not.toHaveAttribute('title');
  });
});

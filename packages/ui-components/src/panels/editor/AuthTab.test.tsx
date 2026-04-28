import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { AuthTab } from './AuthTab';

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

function LiveAuthTab({ requestId }: { requestId: string }) {
  const request = useWorkspaceStore((s) => s.synced?.collections.requests[requestId]) as ApiRequest;
  return <AuthTab request={request} />;
}

function makeRequestId(): string {
  return useWorkspaceStore.getState().addRequest(null);
}

describe('AuthTab', () => {
  beforeEach(hydrate);

  it('renders the type select pre-selected to None', async () => {
    const id = makeRequestId();
    render(<LiveAuthTab requestId={id} />);
    expect(screen.getByLabelText('Auth type')).toHaveValue('none');
    expect(
      screen.getByText(/No authentication will be added to this request./),
    ).toBeInTheDocument();
  });

  it('switching to Bearer reveals a Token field and persists the type', async () => {
    const id = makeRequestId();
    render(<LiveAuthTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Auth type'), 'bearer');
    expect(screen.getByLabelText('Bearer token')).toBeInTheDocument();
    const persisted = useWorkspaceStore.getState().synced!.collections.requests[id].auth;
    expect(persisted.type).toBe('bearer');
  });

  it('typing the bearer token persists into the store', async () => {
    const id = makeRequestId();
    useWorkspaceStore.getState().setRequestAuth(id, { type: 'bearer', token: '' });
    const user = userEvent.setup();
    render(<LiveAuthTab requestId={id} />);
    const input = screen.getByLabelText('Bearer token');
    await user.type(input, 'abc');
    const auth = useWorkspaceStore.getState().synced!.collections.requests[id].auth;
    expect(auth.type === 'bearer' && auth.token).toBe('abc');
  });

  it('Basic auth shows username + password fields', async () => {
    const id = makeRequestId();
    render(<LiveAuthTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Auth type'), 'basic');
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('API key shows Add-to selector', async () => {
    const id = makeRequestId();
    render(<LiveAuthTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Auth type'), 'api-key');
    const addTo = screen.getByLabelText('API key add-to');
    await userEvent.selectOptions(addTo, 'query');
    const auth = useWorkspaceStore.getState().synced!.collections.requests[id].auth;
    expect(auth.type === 'api-key' && auth.addTo).toBe('query');
  });

  it('OAuth2 client credentials renders all standard fields + token panel', async () => {
    const id = makeRequestId();
    render(<LiveAuthTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Auth type'), 'oauth2-client-credentials');
    expect(screen.getByLabelText('Token URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Client ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Client secret')).toBeInTheDocument();
    expect(screen.getByLabelText('Scope')).toBeInTheDocument();
    expect(screen.getByLabelText('Client auth method')).toBeInTheDocument();
    expect(screen.getByLabelText('Access token')).toBeInTheDocument();
  });

  it('AWS SigV4 renders region + service + add-to', async () => {
    const id = makeRequestId();
    render(<LiveAuthTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Auth type'), 'aws-sigv4');
    expect(screen.getByLabelText('AWS access key ID')).toBeInTheDocument();
    expect(screen.getByLabelText('AWS region')).toBeInTheDocument();
    expect(screen.getByLabelText('AWS service')).toBeInTheDocument();
    expect(screen.getByLabelText('SigV4 add-to')).toBeInTheDocument();
  });

  it('JWT Bearer renders algorithm + payload + signing key + token override', async () => {
    const id = makeRequestId();
    render(<LiveAuthTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Auth type'), 'jwt-bearer');
    expect(screen.getByLabelText('JWT algorithm')).toBeInTheDocument();
    expect(screen.getByLabelText('JWT payload')).toBeInTheDocument();
    expect(screen.getByLabelText('JWT signing key')).toBeInTheDocument();
    expect(screen.getByLabelText('JWT token')).toBeInTheDocument();
  });

  it('Digest shows the deferred-handling note', async () => {
    const id = makeRequestId();
    render(<LiveAuthTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Auth type'), 'digest');
    expect(screen.getByText(/Digest is challenge-based/i)).toBeInTheDocument();
  });

  it('NTLM shows domain + workstation fields', async () => {
    const id = makeRequestId();
    render(<LiveAuthTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Auth type'), 'ntlm');
    expect(screen.getByLabelText('NTLM domain')).toBeInTheDocument();
    expect(screen.getByLabelText('NTLM workstation')).toBeInTheDocument();
  });

  it('Hawk renders id + key + algorithm', async () => {
    const id = makeRequestId();
    render(<LiveAuthTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Auth type'), 'hawk');
    expect(screen.getByLabelText('Hawk ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Hawk key')).toBeInTheDocument();
    expect(screen.getByLabelText('Hawk algorithm')).toBeInTheDocument();
  });

  it('Inherit shows an explanatory note', async () => {
    const id = makeRequestId();
    render(<LiveAuthTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Auth type'), 'inherit');
    expect(screen.getByText(/Auth will be inherited from the parent folder/i)).toBeInTheDocument();
  });
});

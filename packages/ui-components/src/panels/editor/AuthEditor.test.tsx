import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { RequestAuth } from '@apicircle/shared';
import { AuthEditor, type AuthEditorProps } from './AuthEditor';

// AuthEditor is purely controlled; drive it through a tiny stateful harness so
// selecting a scheme flows the defaultAuthFor(...) back in as the parent would.
function Harness({
  initial = { type: 'none' },
  ...props
}: { initial?: RequestAuth } & Omit<AuthEditorProps, 'auth' | 'onChange'>) {
  const [auth, setAuth] = useState<RequestAuth>(initial);
  return <AuthEditor auth={auth} onChange={setAuth} {...props} />;
}

const pickType = (value: string) =>
  userEvent.selectOptions(screen.getByLabelText('Auth type'), value);

// Fields use getByLabelText throughout: secret fields render as
// <input type="password">, which carries no `textbox` role in jsdom.
describe('AuthEditor', () => {
  it('names the scheme picker and offers the grouped options', () => {
    render(<Harness />);
    const select = screen.getByLabelText('Auth type');
    expect(select.tagName).toBe('SELECT');
    // A representative option from each group is present.
    expect(screen.getByRole('option', { name: 'Bearer Token' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'OAuth2 — Client Credentials' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'AWS Signature v4' })).toBeInTheDocument();
  });

  it('shows a one-line description of the chosen scheme (information scent)', async () => {
    render(<Harness />);
    await pickType('bearer');
    expect(screen.getByText(/Sends an Authorization: Bearer/i)).toBeInTheDocument();

    await pickType('oauth2-client-credentials');
    expect(screen.getByText(/Machine-to-machine/i)).toBeInTheDocument();

    await pickType('aws-sigv4');
    expect(screen.getByText(/Signs the request with AWS Signature v4/i)).toBeInTheDocument();
  });

  it('groups the credential fields under a legend named for the scheme', async () => {
    render(<Harness />);
    await pickType('bearer');
    const group = screen.getByRole('group', { name: 'Bearer Token' });
    // The scheme's fields live inside that group, not floating in the panel.
    expect(within(group).getByLabelText('Bearer token')).toBeInTheDocument();
  });

  it('None and Inherit render a note and no credential fieldset', async () => {
    render(<Harness />);
    // Default (none): a note, and no credential fieldset (optgroups are groups,
    // so assert on the fieldset element rather than the generic group role).
    expect(screen.getByText(/No authentication will be added/i)).toBeInTheDocument();
    expect(document.querySelector('fieldset')).toBeNull();

    await pickType('inherit');
    expect(screen.getByText(/walks up the folder chain/i)).toBeInTheDocument();
    expect(document.querySelector('fieldset')).toBeNull();
  });

  it('preserves the field accessible names the flows depend on', async () => {
    render(<Harness />);

    await pickType('basic');
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();

    await pickType('api-key');
    expect(screen.getByLabelText('API key name')).toBeInTheDocument();
    expect(screen.getByLabelText('API key location')).toBeInTheDocument();

    await pickType('custom-header');
    expect(screen.getByLabelText('Header name')).toBeInTheDocument();
    expect(screen.getByLabelText('Header value')).toBeInTheDocument();

    await pickType('jwt-bearer');
    expect(screen.getByLabelText('JWT algorithm')).toBeInTheDocument();
    expect(screen.getByLabelText('JWT payload')).toBeInTheDocument();
    expect(screen.getByLabelText('JWT signing key')).toBeInTheDocument();
  });

  it('renders every OAuth2 grant with its standard fields', async () => {
    render(<Harness />);

    await pickType('oauth2-auth-code');
    expect(screen.getByLabelText('Authorization URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Redirect URI')).toBeInTheDocument();

    await pickType('oauth2-pkce');
    expect(screen.getByLabelText('PKCE code challenge method')).toBeInTheDocument();

    await pickType('oauth2-password');
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();

    await pickType('oauth2-implicit');
    expect(screen.getByLabelText('Authorization URL')).toBeInTheDocument();

    await pickType('oauth2-device');
    expect(screen.getByLabelText('Device authorization URL')).toBeInTheDocument();
  });

  it('typing a value flows back through onChange', async () => {
    render(<Harness initial={{ type: 'bearer', token: '' }} />);
    const token = screen.getByLabelText('Bearer token');
    await userEvent.type(token, 'abc');
    expect(token).toHaveValue('abc');
  });

  it('disableInherit removes the Inherit option and can override the None note', () => {
    render(<Harness disableInherit noneNote="No folder-level auth set." />);
    expect(screen.queryByRole('option', { name: /Inherit/ })).toBeNull();
    expect(screen.getByText('No folder-level auth set.')).toBeInTheDocument();
  });
});

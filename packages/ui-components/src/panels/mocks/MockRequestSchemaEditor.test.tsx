import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MockEndpoint } from '@apicircle/shared';
import { MockRequestSchemaEditor } from './MockRequestSchemaEditor';
import { renderWithStore } from '../../../test/renderWithStore';

function makeEndpoint(overrides?: Partial<MockEndpoint>): MockEndpoint {
  return {
    id: 'ep-1',
    name: 'Get pet',
    method: 'GET',
    pathPattern: '/pets/{petId}',
    requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
    requestValidation: [],
    responseRules: [],
    defaultResponse: { status: 200, headers: [], body: { type: 'json', content: '{}' } },
    ...overrides,
  };
}

describe('MockRequestSchemaEditor', () => {
  it('renders empty states for each param list', async () => {
    await renderWithStore(
      <MockRequestSchemaEditor endpoint={makeEndpoint()} setEndpoint={vi.fn()} />,
    );
    expect(screen.getByText(/no path params/i)).toBeInTheDocument();
    expect(screen.getByText(/no query params/i)).toBeInTheDocument();
    expect(screen.getByText(/no headers/i)).toBeInTheDocument();
    expect(screen.getByText(/no cookies/i)).toBeInTheDocument();
  });

  it('derives path params from the pathPattern slots', async () => {
    const setEndpoint = vi.fn();
    await renderWithStore(
      <MockRequestSchemaEditor endpoint={makeEndpoint()} setEndpoint={setEndpoint} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /derive from path/i }));
    expect(setEndpoint).toHaveBeenCalledTimes(1);
    const patch = setEndpoint.mock.calls[0][0] as Partial<MockEndpoint>;
    expect(patch.requestSchema?.pathParams.map((p) => p.name)).toEqual(['petId']);
    expect(patch.requestSchema?.pathParams[0].required).toBe(true);
  });

  it('adds a query param row on click', async () => {
    const setEndpoint = vi.fn();
    await renderWithStore(
      <MockRequestSchemaEditor endpoint={makeEndpoint()} setEndpoint={setEndpoint} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /add query param/i }));
    const patch = setEndpoint.mock.calls[0][0] as Partial<MockEndpoint>;
    expect(patch.requestSchema?.queryParams).toHaveLength(1);
    expect(patch.requestSchema?.queryParams[0].typeHint).toBe('string');
  });

  it('hides "Derive from path" once all slots are declared', async () => {
    const endpoint = makeEndpoint({
      requestSchema: {
        pathParams: [{ id: 'p1', name: 'petId', typeHint: 'string', required: true }],
        queryParams: [],
        headers: [],
        cookies: [],
      },
    });
    await renderWithStore(<MockRequestSchemaEditor endpoint={endpoint} setEndpoint={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /derive from path/i })).toBeNull();
  });

  it('clears the body doc when both description + example go blank', async () => {
    const endpoint = makeEndpoint({
      requestSchema: {
        pathParams: [],
        queryParams: [],
        headers: [],
        cookies: [],
        body: { description: 'x', example: '' },
      },
    });
    const setEndpoint = vi.fn();
    await renderWithStore(
      <MockRequestSchemaEditor endpoint={endpoint} setEndpoint={setEndpoint} />,
    );
    // Clear the single-char description → body should be dropped entirely.
    await userEvent.clear(screen.getByLabelText(/request body description/i));
    const patch = setEndpoint.mock.calls.at(-1)?.[0] as Partial<MockEndpoint>;
    expect(patch.requestSchema && 'body' in patch.requestSchema).toBe(false);
  });
});

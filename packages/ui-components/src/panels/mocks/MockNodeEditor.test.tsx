import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  makeDefaultMockResponse,
  makeDefaultRequestSchema,
  type MockEndpoint,
  type MockResponseRule,
  type MockValidationRule,
} from '@apicircle/shared';
import { MockNodeEditor, type MockNodeSelection } from './MockNodeEditor';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

// Reordering a rule says why at the ends of the list, and a rule's only
// clause has no Remove (a rule needs one).

const validation = (id: string): MockValidationRule => ({
  id,
  kind: 'header-required',
  target: `X-${id}`,
  enabled: true,
  failResponse: { ...makeDefaultMockResponse(), status: 400 },
});

const responseRule = (id: string, clauses: number): MockResponseRule => ({
  id,
  name: `Rule ${id}`,
  enabled: true,
  when: Array.from({ length: clauses }, (_, i) => ({
    id: `${id}-c${i}`,
    scope: 'query' as const,
    target: `q${i}`,
    op: 'equals' as const,
    value: String(i),
  })),
  response: makeDefaultMockResponse(),
});

const ENDPOINT: MockEndpoint = {
  id: 'ep',
  name: 'GET /pets',
  method: 'GET',
  pathPattern: '/pets',
  requestSchema: makeDefaultRequestSchema(),
  requestValidation: [validation('v1'), validation('v2')],
  responseRules: [responseRule('r1', 2), responseRule('r2', 1)],
  defaultResponse: makeDefaultMockResponse(),
};

function Harness({ initial }: { initial: MockNodeSelection }) {
  const [selection, setSelection] = useState(initial);
  const server = useWorkspaceStore((s) => Object.values(s.synced!.mockServers)[0]);
  if (!server) return null;
  return (
    <MockNodeEditor
      server={server}
      endpoint={server.endpoints[0]}
      selection={selection}
      onSelect={setSelection}
    />
  );
}

async function renderAt(selection: MockNodeSelection): Promise<void> {
  await renderWithStore(<Harness initial={selection} />);
  await act(async () => {
    await useWorkspaceStore.getState().createMockServer({
      name: 'Pets',
      source: { kind: 'manual', endpoints: [ENDPOINT] },
    });
  });
}

const endpoint = (): MockEndpoint =>
  Object.values(useWorkspaceStore.getState().synced!.mockServers)[0].endpoints[0];

describe('MockNodeEditor — reordering rules', () => {
  it('moves a validation rule, and says why the ends cannot move further', async () => {
    await renderAt({ kind: 'validation' });
    const firstUp = screen.getByRole('button', { name: 'Move rule 1 up' });
    expect(firstUp).toBeDisabled();
    expect(firstUp).toHaveAccessibleDescription('This rule is first already.');
    expect(screen.getByRole('button', { name: 'Move rule 2 down' })).toHaveAccessibleDescription(
      'This rule is last already.',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Move rule 1 down' }));
    expect(endpoint().requestValidation.map((r) => r.id)).toEqual(['v2', 'v1']);
    await userEvent.click(screen.getByRole('button', { name: 'Move rule 2 up' }));
    expect(endpoint().requestValidation.map((r) => r.id)).toEqual(['v1', 'v2']);
  });

  it('moves a response rule the same way', async () => {
    await renderAt({ kind: 'rules' });
    expect(screen.getByRole('button', { name: 'Move rule 1 up' })).toHaveAccessibleDescription(
      'This rule is first already.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Move rule 1 down' }));
    expect(endpoint().responseRules.map((r) => r.id)).toEqual(['r2', 'r1']);
    await userEvent.click(screen.getByRole('button', { name: 'Move rule 2 up' }));
    expect(endpoint().responseRules.map((r) => r.id)).toEqual(['r1', 'r2']);
  });
});

describe('MockNodeEditor — a rule needs a clause', () => {
  it('offers Remove while a rule has more than one clause, and none on its last', async () => {
    await renderAt({ kind: 'rule', ruleId: 'r1' });
    expect(screen.getByRole('button', { name: 'Remove clause 1' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove clause 2' }));
    expect(endpoint().responseRules[0].when.map((c) => c.id)).toEqual(['r1-c0']);
    // One left: nothing to press that could never work.
    expect(screen.queryByRole('button', { name: /^Remove clause/ })).toBeNull();
  });
});

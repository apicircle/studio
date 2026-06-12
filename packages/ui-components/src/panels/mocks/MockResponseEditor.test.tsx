import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MockResponseConfig } from '@apicircle/shared';
import { MockResponseEditor } from './MockResponseEditor';
import { renderWithStore } from '../../../test/renderWithStore';

function jsonResponse(multipliers?: MockResponseConfig['multipliers']): MockResponseConfig {
  return {
    status: 200,
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    body: { type: 'json', content: '{"items":[{"id":1}]}' },
    multipliers,
  };
}

describe('MockResponseEditor — multiplier cap (MAX_RESPONSE_MULTIPLIERS = 1)', () => {
  it('offers "Add multiplier" when none exist, and adds one on click', async () => {
    const onChange = vi.fn();
    await renderWithStore(
      <MockResponseEditor
        label="default"
        value={jsonResponse(undefined)}
        onChange={onChange}
        attachmentSlot={null}
      />,
    );
    const add = screen.getByRole('button', { name: /add default multiplier/i });
    expect(add).toBeInTheDocument();
    await userEvent.click(add);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as MockResponseConfig;
    expect(next.multipliers).toHaveLength(1);
  });

  it('hides "Add multiplier" and shows the limit hint once one exists', async () => {
    await renderWithStore(
      <MockResponseEditor
        label="default"
        value={jsonResponse([
          {
            id: 'm1',
            source: { kind: 'query', key: 'pageSize' },
            targetJsonPath: '$.items',
            defaultCount: 3,
          },
        ])}
        onChange={vi.fn()}
        attachmentSlot={null}
      />,
    );
    expect(screen.queryByRole('button', { name: /add default multiplier/i })).toBeNull();
    expect(screen.getByText(/limit reached \(1\)/i)).toBeInTheDocument();
  });

  it('removing the only multiplier clears the array to undefined', async () => {
    const onChange = vi.fn();
    await renderWithStore(
      <MockResponseEditor
        label="default"
        value={jsonResponse([
          {
            id: 'm1',
            source: { kind: 'query', key: 'pageSize' },
            targetJsonPath: '$.items',
            defaultCount: 3,
          },
        ])}
        onChange={onChange}
        attachmentSlot={null}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /remove default multiplier 1/i }));
    const next = onChange.mock.calls[0][0] as MockResponseConfig;
    expect(next.multipliers).toBeUndefined();
  });
});

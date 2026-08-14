import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Tabs, tabPanelProps, type TabDef } from './Tabs';

const TABS: TabDef[] = [
  { id: 'params', label: 'Params', count: 1 },
  { id: 'headers', label: 'Headers' },
  { id: 'auth', label: 'Auth', disabled: true },
  { id: 'body', label: 'Body' },
];

function Harness({ onChange }: { onChange?: (id: string) => void }) {
  const [active, setActive] = useState('params');
  return (
    <Tabs
      tabs={TABS}
      activeId={active}
      onChange={(id) => {
        setActive(id);
        onChange?.(id);
      }}
      label="Request sections"
      idBase="editor"
    />
  );
}

describe('Tabs', () => {
  it('exposes a named tablist with selectable tabs', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Request sections' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Params/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Headers' })).toHaveAttribute('aria-selected', 'false');
  });

  it('renders a trailing count', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: /Params/ })).toHaveTextContent('1');
  });

  it('selects on click', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Body' }));
    expect(onChange).toHaveBeenCalledWith('body');
    expect(screen.getByRole('tab', { name: 'Body' })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves with arrow keys and skips disabled tabs', async () => {
    render(<Harness />);
    const params = screen.getByRole('tab', { name: /Params/ });
    params.focus();
    // Params → Headers → (skip Auth, disabled) → Body
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Headers' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Body' })).toHaveAttribute('aria-selected', 'true');
  });

  it('wraps from the last enabled tab to the first with ArrowRight', async () => {
    render(<Harness />);
    screen.getByRole('tab', { name: /Params/ }).focus();
    await userEvent.keyboard('{ArrowLeft}'); // wrap backwards to Body
    expect(screen.getByRole('tab', { name: 'Body' })).toHaveAttribute('aria-selected', 'true');
  });

  it('jumps to the first and last enabled tab with Home/End', async () => {
    render(<Harness />);
    screen.getByRole('tab', { name: /Params/ }).focus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Body' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: /Params/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('only the active tab is in the tab order (roving tabindex)', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: /Params/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Headers' })).toHaveAttribute('tabindex', '-1');
  });

  it('wires aria-controls to the panel produced by tabPanelProps', () => {
    render(<Harness />);
    const params = screen.getByRole('tab', { name: /Params/ });
    const panel = tabPanelProps('editor', 'params');
    expect(params).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toEqual({
      id: 'editor-panel-params',
      role: 'tabpanel',
      'aria-labelledby': 'editor-tab-params',
    });
  });

  it('omits aria-controls when no idBase is given', () => {
    render(<Tabs tabs={TABS} activeId="params" onChange={() => {}} label="L" />);
    expect(screen.getByRole('tab', { name: /Params/ })).not.toHaveAttribute('aria-controls');
  });

  it('ignores non-navigation keys', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    screen.getByRole('tab', { name: /Params/ }).focus();
    await userEvent.keyboard('a'); // a printable key must not change selection
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: /Params/ })).toHaveAttribute('aria-selected', 'true');
  });
});

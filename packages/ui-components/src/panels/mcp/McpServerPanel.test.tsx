import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpServerPanel } from './McpServerPanel';
import { renderWithStore } from '../../../test/renderWithStore';

let bridge: {
  status: ReturnType<typeof vi.fn>;
  getConfigSnippet: ReturnType<typeof vi.fn>;
  getConfigPath: ReturnType<typeof vi.fn>;
  toolCatalog: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  bridge = {
    status: vi.fn().mockResolvedValue({ workspaceDir: '/tmp/ws', binary: 'apicircle-mcp' }),
    getConfigSnippet: vi.fn().mockResolvedValue('{"mcpServers":{"apicircle":{}}}'),
    getConfigPath: vi.fn().mockResolvedValue('/Users/me/.claude/claude_desktop_config.json'),
    toolCatalog: vi.fn().mockResolvedValue(['request.create', 'mock.start']),
  };
  (window as unknown as { apicircleDesktop?: unknown }).apicircleDesktop = { mcp: bridge };
});

afterEach(() => {
  delete (window as unknown as { apicircleDesktop?: unknown }).apicircleDesktop;
});

describe('McpServerPanel', () => {
  it('shows the desktop banner when the bridge is missing', async () => {
    delete (window as unknown as { apicircleDesktop?: unknown }).apicircleDesktop;
    await renderWithStore(<McpServerPanel />);
    expect(screen.getByText(/Desktop App/)).toBeInTheDocument();
  });

  it('loads snippet + tool catalog when the bridge is present', async () => {
    await renderWithStore(<McpServerPanel />);
    expect(await screen.findByText(/mcpServers/)).toBeInTheDocument();
    expect(await screen.findByText('request.create')).toBeInTheDocument();
    expect(await screen.findByText('mock.start')).toBeInTheDocument();
  });

  it('refetches when the user picks a different client', async () => {
    await renderWithStore(<McpServerPanel />);
    await screen.findByText(/mcpServers/); // wait for first load
    bridge.getConfigSnippet.mockResolvedValueOnce('{"cursor":{}}');
    await userEvent.selectOptions(screen.getByLabelText('AI client'), 'cursor');
    expect(bridge.getConfigSnippet).toHaveBeenCalledWith('cursor');
  });

  it('copies the snippet via the clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await renderWithStore(<McpServerPanel />);
    await screen.findByText(/mcpServers/);
    await userEvent.click(screen.getByRole('button', { name: /Copy/ }));
    expect(writeText).toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpServerPanel } from './McpServerPanel';
import { McpSidebar } from './McpSidebar';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

let bridge: {
  status: ReturnType<typeof vi.fn>;
  getConfigSnippet: ReturnType<typeof vi.fn>;
  getConfigPath: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  bridge = {
    status: vi.fn().mockResolvedValue({ workspaceDir: '/tmp/ws', binary: 'apicircle-mcp' }),
    // Snippet content varies per client so we can verify all of them render.
    getConfigSnippet: vi.fn(async (client: string) => `{"mcpServers":{"${client}":{}}}`),
    getConfigPath: vi.fn().mockResolvedValue('/Users/me/.claude/claude_desktop_config.json'),
  };
  (window as unknown as { apicircleDesktop?: unknown }).apicircleDesktop = { mcp: bridge };
  // Reset MCP focus so tests start in a known state.
  useWorkspaceStore.getState().setMcpFocusedClient(null);
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

  it('renders one snippet card per supported AI client', async () => {
    await renderWithStore(<McpServerPanel />);
    // Each client's per-card snippet contains its id; assert a few of the
    // common ones land — proves all clients are fetched and rendered.
    expect(await screen.findByText(/"claude-desktop"/)).toBeInTheDocument();
    expect(await screen.findByText(/"cursor"/)).toBeInTheDocument();
    expect(await screen.findByText(/"github-copilot"/)).toBeInTheDocument();
  });

  it('selecting a client in the sidebar focuses its snippet card', async () => {
    const user = userEvent.setup();
    await renderWithStore(
      <>
        <McpSidebar />
        <McpServerPanel />
      </>,
    );
    await screen.findByText(/"cursor"/); // wait for snippets to load
    await user.click(screen.getByRole('button', { name: 'Cursor' }));
    expect(useWorkspaceStore.getState().mcpFocusedClient).toBe('cursor');
  });

  it('copies a client snippet via the clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // navigator.clipboard is a getter-only property in jsdom 25; assign via
    // defineProperty so the test can install a spy.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await renderWithStore(<McpServerPanel />);
    await screen.findByText(/"claude-desktop"/);
    // Each card has its own Copy button; click the first.
    const copyButtons = screen.getAllByRole('button', { name: /Copy/ });
    await userEvent.click(copyButtons[0]);
    expect(writeText).toHaveBeenCalledWith('{"mcpServers":{"claude-desktop":{}}}');
  });
});

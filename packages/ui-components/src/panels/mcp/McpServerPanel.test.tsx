import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpServerPanel } from './McpServerPanel';
import { McpSidebar } from './McpSidebar';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

let mcpBridge: {
  status: ReturnType<typeof vi.fn>;
  getConfigSnippet: ReturnType<typeof vi.fn>;
  getConfigPath: ReturnType<typeof vi.fn>;
};
let workspaceFileBridge: {
  status: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  mcpBridge = {
    status: vi.fn().mockResolvedValue({ workspaceDir: '/tmp/ws', binary: 'apicircle-mcp' }),
    getConfigSnippet: vi.fn(async (client: string) => `{"mcpServers":{"${client}":{}}}`),
    getConfigPath: vi.fn().mockResolvedValue('/Users/me/.claude/claude_desktop_config.json'),
  };
  workspaceFileBridge = {
    status: vi.fn().mockResolvedValue({ workspaceDir: '/tmp/ws' }),
  };
  (window as unknown as { apicircleDesktop?: unknown }).apicircleDesktop = {
    mcp: mcpBridge,
    workspaceFile: workspaceFileBridge,
  };
  // Reset MCP panel section so tests start in a known state.
  useWorkspaceStore.getState().setMcpActiveSection('how-to-connect');
  useWorkspaceStore.getState().setMcpHowToConnectClient(null);
});

afterEach(() => {
  delete (window as unknown as { apicircleDesktop?: unknown }).apicircleDesktop;
});

describe('McpServerPanel router', () => {
  it('renders "How to Connect" by default', async () => {
    await renderWithStore(<McpServerPanel />);
    expect(await screen.findByRole('heading', { name: /How to Connect/ })).toBeInTheDocument();
    // Default-pick client is claude-desktop → its snippet should load.
    expect(await screen.findByText(/"claude-desktop"/)).toBeInTheDocument();
  });

  it('switches to Connection when the sidebar selects it', async () => {
    const user = userEvent.setup();
    await renderWithStore(
      <>
        <McpSidebar />
        <McpServerPanel />
      </>,
    );
    await user.click(screen.getByRole('button', { name: /Connection/ }));
    expect(await screen.findByRole('heading', { name: /^Connection$/ })).toBeInTheDocument();
    // Workspace dir from the bridge surface should render.
    expect(await screen.findByText('/tmp/ws')).toBeInTheDocument();
  });

  it('switches to Prompts and renders the curated catalog', async () => {
    const user = userEvent.setup();
    await renderWithStore(
      <>
        <McpSidebar />
        <McpServerPanel />
      </>,
    );
    await user.click(screen.getByRole('button', { name: /Prompts/ }));
    expect(await screen.findByRole('heading', { name: /^Prompts$/ })).toBeInTheDocument();
    // A sample of the curated text should be visible.
    expect(screen.getByText(/List every request in my API Circle workspace/i)).toBeInTheDocument();
  });
});

describe('HowToConnectSection', () => {
  it('lets the user pick a different AI client and updates the snippet', async () => {
    const user = userEvent.setup();
    await renderWithStore(<McpServerPanel />);
    await screen.findByText(/"claude-desktop"/);
    await user.click(screen.getByRole('radio', { name: 'Cursor' }));
    expect(await screen.findByText(/"cursor"/)).toBeInTheDocument();
    expect(useWorkspaceStore.getState().mcpHowToConnectClient).toBe('cursor');
  });

  it('copies the JSON snippet onto the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await renderWithStore(<McpServerPanel />);
    await screen.findByText(/"claude-desktop"/);
    const copyButtons = screen.getAllByRole('button', { name: /Copy/ });
    // First copy button is for the install command; the snippet's Copy
    // is the one inside the JSON snippet block — find it by counting.
    const snippetCopy = copyButtons.find((b) => b.closest('pre')?.parentElement);
    // Fall back: just click the second Copy button which is the snippet one.
    await userEvent.click(snippetCopy ?? copyButtons[1]);
    expect(writeText).toHaveBeenCalled();
  });
});

describe('ConnectionSection', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().setMcpActiveSection('connection');
  });

  it('renders the workspace mirror path + binary name', async () => {
    await renderWithStore(<McpServerPanel />);
    expect(await screen.findByText('/tmp/ws')).toBeInTheDocument();
    expect(await screen.findByText('apicircle-mcp')).toBeInTheDocument();
  });

  it('refresh button calls the refreshFromDisk store action', async () => {
    const user = userEvent.setup();
    const refresh = vi.fn().mockResolvedValue({ kind: 'up-to-date' });
    useWorkspaceStore.setState({ refreshFromDisk: refresh });
    await renderWithStore(<McpServerPanel />);
    const refreshBtn = await screen.findByRole('button', { name: /Refresh from disk/ });
    await user.click(refreshBtn);
    expect(refresh).toHaveBeenCalled();
  });

  it('refresh button is disabled when the workspaceFile bridge is missing', async () => {
    (
      window as unknown as { apicircleDesktop?: { mcp?: unknown; workspaceFile?: unknown } }
    ).apicircleDesktop = { mcp: mcpBridge };
    await renderWithStore(<McpServerPanel />);
    const refreshBtn = await screen.findByRole('button', { name: /Refresh from disk/ });
    expect(refreshBtn).toBeDisabled();
  });
});

describe('PromptsSection', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().setMcpActiveSection('prompts');
  });

  it('filters prompts by the search box', async () => {
    const user = userEvent.setup();
    await renderWithStore(<McpServerPanel />);
    const search = await screen.findByRole('searchbox', { name: /Search prompts/ });
    await user.type(search, 'staging');
    // The staging-env prompt should remain visible.
    expect(screen.getByText(/Create a "staging" environment/)).toBeInTheDocument();
    // A workspace-listing prompt should drop out.
    expect(
      screen.queryByText(/List every request in my API Circle workspace/i),
    ).not.toBeInTheDocument();
  });

  it('filters prompts by category chip', async () => {
    const user = userEvent.setup();
    await renderWithStore(<McpServerPanel />);
    await user.click(screen.getByRole('tab', { name: /Mocks/ }));
    expect(screen.getByText(/Start the "Petstore" mock/)).toBeInTheDocument();
    expect(
      screen.queryByText(/List every request in my API Circle workspace/i),
    ).not.toBeInTheDocument();
  });

  it('copies a prompt onto the clipboard when clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await renderWithStore(<McpServerPanel />);
    const card = await screen.findByRole('button', {
      name: /Copy prompt: List every request/i,
    });
    await userEvent.click(card);
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('List every request in my API Circle workspace'),
    );
  });

  it('shows an empty-state when no prompt matches the filter', async () => {
    const user = userEvent.setup();
    await renderWithStore(<McpServerPanel />);
    const search = await screen.findByRole('searchbox', { name: /Search prompts/ });
    await user.type(search, 'this-string-matches-nothing');
    expect(screen.getByText(/No prompts match your filter/)).toBeInTheDocument();
  });
});

describe('McpSidebar', () => {
  it('renders the three top-level sections', async () => {
    await renderWithStore(<McpSidebar />);
    expect(screen.getByRole('button', { name: /How to Connect/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connection/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Prompts/ })).toBeInTheDocument();
  });

  it('marks the active section with aria-current', async () => {
    useWorkspaceStore.getState().setMcpActiveSection('connection');
    await renderWithStore(<McpSidebar />);
    const connectionBtn = screen.getByRole('button', { name: /Connection/ });
    expect(connectionBtn).toHaveAttribute('aria-current', 'page');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
    getConfigSnippet: vi.fn(async (client: string) => {
      const text = `{"mcpServers":{"${client}":{}}}`;
      return { forwardSlash: text, escaped: text, identical: true };
    }),
    getConfigPath: vi.fn().mockResolvedValue('/Users/me/.claude/claude_desktop_config.json'),
  };
  // Bridge contract: this surface returns `workspacesRoot` (the multi-workspace
  // registry root), NOT `workspaceDir`. An earlier version of this mock lied
  // about the field name and masked a real bug where the renderer's
  // destructure resolved to `undefined` and the panel hung on "Loading…".
  workspaceFileBridge = {
    status: vi.fn().mockResolvedValue({ workspacesRoot: '/tmp/ws' }),
  };
  (window as unknown as { apicircleDesktop?: unknown }).apicircleDesktop = {
    mcp: mcpBridge,
    workspaceFile: workspaceFileBridge,
  };
  // Reset MCP panel section so tests start in a known state. 'connection' is
  // also the default — calling it explicitly keeps the contract obvious.
  useWorkspaceStore.getState().setMcpActiveSection('connection');
  useWorkspaceStore.getState().setMcpHowToConnectClient(null);
});

afterEach(() => {
  delete (window as unknown as { apicircleDesktop?: unknown }).apicircleDesktop;
});

async function findSnippetText() {
  // The snippet renders in a read-only Monaco editor, mocked in test setup as
  // a textarea exposing its value via `value=`. `findByDisplayValue` won't
  // match a regex on a long substring cleanly, so we grab the textarea by
  // its test-id and assert on `.value`.
  const editor = (await screen.findByTestId('monaco-editor-mock')) as HTMLTextAreaElement;
  return editor.value;
}

describe('McpServerPanel router', () => {
  it('renders Connection by default with both Setup + Workspace mirror blocks visible', async () => {
    await renderWithStore(<McpServerPanel />);
    // Two block H2 headings under the single Connection tab. The mirror
    // InfoRow also renders an H3 with "Workspace mirror" — scope to level 2
    // so we don't accidentally match both.
    expect(
      await screen.findByRole('heading', { level: 2, name: /Set up your AI client/ }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 2, name: /Workspace mirror/ }),
    ).toBeInTheDocument();
    // Default-pick client is claude-desktop → its snippet should load.
    expect(await findSnippetText()).toContain('"claude-desktop"');
    // Mirror path resolves from the workspaceFile bridge.
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

describe('HowToConnect (setup block in Connection)', () => {
  it('lets the user pick a different AI client and updates the snippet', async () => {
    const user = userEvent.setup();
    await renderWithStore(<McpServerPanel />);
    await waitFor(async () => {
      expect(await findSnippetText()).toContain('"claude-desktop"');
    });
    await user.click(screen.getByRole('radio', { name: 'Cursor' }));
    await waitFor(async () => {
      expect(await findSnippetText()).toContain('"cursor"');
    });
    expect(useWorkspaceStore.getState().mcpHowToConnectClient).toBe('cursor');
  });

  it('copies the JSON snippet onto the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await renderWithStore(<McpServerPanel />);
    await waitFor(async () => {
      expect(await findSnippetText()).toContain('"claude-desktop"');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Copy snippet' }));
    expect(writeText).toHaveBeenCalled();
  });

  it('hides the escaped-reference panel when the two snippets are identical (POSIX paths)', async () => {
    await renderWithStore(<McpServerPanel />);
    await waitFor(async () => {
      expect(await findSnippetText()).toContain('"claude-desktop"');
    });
    // On POSIX there's no `\\` to escape, so the reference block is suppressed.
    expect(
      screen.queryByText(/Windows: snippet above uses forward slashes/),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy escaped snippet' })).not.toBeInTheDocument();
  });

  it('shows the escaped-form reference on Windows (variants differ)', async () => {
    mcpBridge.getConfigSnippet.mockResolvedValue({
      forwardSlash: '{"path":"C:/Users/me"}',
      escaped: '{"path":"C:\\\\Users\\\\me"}',
      identical: false,
    });
    await renderWithStore(<McpServerPanel />);
    // The single editor renders the forward-slash form by default — no picker,
    // no Option 1/Option 2 tabs.
    await waitFor(async () => {
      expect(await findSnippetText()).toContain('"C:/Users/me"');
    });
    expect(screen.queryByRole('tab', { name: /Option/ })).not.toBeInTheDocument();
    // The collapsible reference is present and contains the escaped form.
    expect(screen.getByText(/Windows: snippet above uses forward slashes/)).toBeInTheDocument();
    // Expand the details and verify the escaped snippet renders + can be copied.
    const summary = screen
      .getByText(/Windows: snippet above uses forward slashes/)
      .closest('summary');
    expect(summary).not.toBeNull();
    await userEvent.click(summary as HTMLElement);
    expect(screen.getByText('{"path":"C:\\\\Users\\\\me"}')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy escaped snippet' })).toBeInTheDocument();
  });

  it('tolerates a legacy bridge that returns a bare string snippet', async () => {
    // Older preload returning a string (pre-variant refactor). The renderer
    // must normalize it into the variants shape so the editor still renders
    // — instead of silently hanging on "(loading…)" because
    // `variants.forwardSlash` came back `undefined`.
    mcpBridge.getConfigSnippet.mockResolvedValue('{"legacy":true}');
    await renderWithStore(<McpServerPanel />);
    await waitFor(async () => {
      expect(await findSnippetText()).toBe('{"legacy":true}');
    });
    // The escaped-form reference is hidden because the string was normalized
    // to `identical: true`.
    expect(
      screen.queryByText(/Windows: snippet above uses forward slashes/),
    ).not.toBeInTheDocument();
  });
});

describe('ConnectionSection — Workspace mirror block', () => {
  it('renders the workspace mirror path + binary name', async () => {
    await renderWithStore(<McpServerPanel />);
    expect(await screen.findByText('/tmp/ws')).toBeInTheDocument();
    // "apicircle-mcp" appears in the install-instructions step card too,
    // so scope to the MCP binary InfoRow (its H3 label is unique).
    // Anchored regex — StepCard 1's heading "Install the apicircle-mcp binary"
    // also matches an unanchored /MCP binary/i, which would throw a multi-match.
    const binaryRow = (
      await screen.findByRole('heading', { level: 3, name: /^MCP binary$/i })
    ).closest('section') as HTMLElement;
    expect(await within(binaryRow).findByText('apicircle-mcp')).toBeInTheDocument();
  });

  it('refresh button calls the refreshFromDisk store action', async () => {
    const user = userEvent.setup();
    // Result must include `counts` — the Connection section's toast
    // detail interpolates them. Stubbing only `kind` lets the click
    // through but throws an unhandled error in the toast formatter.
    const refresh = vi.fn().mockResolvedValue({
      kind: 'up-to-date',
      counts: { requests: 0, folders: 0, environments: 0 },
    });
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

  it('hides the Copy button on Workspace Mirror while the path is loading', async () => {
    // Hold the workspaceFile.status() promise open so the renderer stays in
    // its "Loading…" state — Copy should NOT render alongside the
    // placeholder text. This is the regression we previously fixed: it used
    // to render a permanently-disabled button next to "Loading…" forever.
    let resolveStatus: (v: { workspacesRoot: string }) => void = () => {};
    workspaceFileBridge.status.mockReturnValue(
      new Promise((r) => {
        resolveStatus = r;
      }),
    );
    await renderWithStore(<McpServerPanel />);
    // Two headings in the DOM both contain "Workspace mirror" — the block
    // heading (h2) and the InfoRow label (h3). Scope to the InfoRow.
    const mirrorRow = (
      await screen.findByRole('heading', { level: 3, name: /Workspace mirror/i })
    ).closest('section') as HTMLElement;
    expect(within(mirrorRow).getByText(/Loading/)).toBeInTheDocument();
    expect(
      within(mirrorRow).queryByRole('button', { name: /Copy Workspace mirror/i }),
    ).not.toBeInTheDocument();
    // Once the path resolves, Copy appears.
    resolveStatus({ workspacesRoot: '/tmp/ws' });
    expect(
      await within(mirrorRow).findByRole('button', { name: /Copy Workspace mirror/i }),
    ).toBeInTheDocument();
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
    // The card's badge swaps to "Copied" and an inline status tooltip appears.
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Copied!');
  });

  it('surfaces an error toast when the clipboard write fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await renderWithStore(<McpServerPanel />);
    const card = await screen.findByRole('button', {
      name: /Copy prompt: List every request/i,
    });
    await userEvent.click(card);
    // The ToastViewport isn't mounted in this harness — assert the toast
    // record was queued on the store instead.
    await waitFor(() => {
      const toasts = useWorkspaceStore.getState().toasts;
      expect(toasts.some((t) => t.tone === 'error' && /Copy failed/.test(t.title))).toBe(true);
    });
    expect(
      useWorkspaceStore.getState().toasts.find((t) => /Copy failed/.test(t.title))?.detail,
    ).toBe('Clipboard API unavailable');
  });

  it('renames the singular workspace category to Collections', async () => {
    await renderWithStore(<McpServerPanel />);
    expect(screen.getByRole('tab', { name: /Collections/ })).toBeInTheDocument();
    // The plural multi-workspace category survives.
    expect(screen.getByRole('tab', { name: /Workspaces/ })).toBeInTheDocument();
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
  it('renders the two top-level sections', async () => {
    await renderWithStore(<McpSidebar />);
    expect(screen.getByRole('button', { name: /Connection/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Prompts/ })).toBeInTheDocument();
    // "How to Connect" no longer exists as a sidebar entry.
    expect(screen.queryByRole('button', { name: /How to Connect/ })).not.toBeInTheDocument();
  });

  it('marks the active section with aria-current', async () => {
    useWorkspaceStore.getState().setMcpActiveSection('connection');
    await renderWithStore(<McpSidebar />);
    const connectionBtn = screen.getByRole('button', { name: /Connection/ });
    expect(connectionBtn).toHaveAttribute('aria-current', 'page');
  });
});

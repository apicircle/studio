export { App } from './App';
export { applyTheme, getStoredThemeId, ALL_THEMES } from './theme/applyTheme';
// For an editor built outside this package: a Monaco instance reads its theme
// from these names, not from `data-theme`, so anything mounting its own Monaco
// needs them to follow the workspace theme.
export { getMonacoThemeId, registerMonacoThemes } from './theme/monacoThemes';
export { applyFont, ALL_FONTS } from './theme/applyFont';
export type { FontFamilyId, FontFamilyDef } from './theme/applyFont';
export { applyFontSize, clampFontSizePercent } from './theme/applyFontSize';
export { useWorkspaceStore } from './store/workspaceStore';
export { readAttachmentBytes } from './persistence/attachments';
export {
  Button,
  Input,
  Label,
  Field,
  Checkbox,
  Radio,
  Tabs,
  tabPanelProps,
  SchemaView,
  Tooltip,
  Badge,
  Skeleton,
  Modal,
  cn,
} from './primitives';
export type { FieldControlProps, TabDef } from './primitives';
export { PANELS, VISIBLE_PANELS, getPanel } from './layout/panels';
export type { PanelDef } from './layout/panels';
export type { ExtraPanelDef } from './layout/extraPanels';
export type { SectionDef } from './layout/sections';
export type { BrandDef } from './layout/TopBar';
export { getDesktopMockBridge, getDesktopWorkspaceFileBridge } from './desktop/bridge';
export type {
  DesktopBridgeContract,
  DesktopMockBridge,
  DesktopWorkspaceFileBridge,
  ParseSpecResult,
  WorkspaceFileExternalChange,
} from './desktop/bridge';
export {
  DEFAULT_WORKSPACE_ACCESS,
  WorkspaceAccessProvider,
  canCreateWorkspace,
  unlockedWorkspaceIds,
  useWorkspaceAccess,
  type WorkspaceAccess,
} from './layout/workspaceAccess';
export { WorkspaceLockedNotice } from './layout/WorkspaceLockedNotice';
export {
  DEFAULT_GIT_HOST_ACCESS,
  GitHostAccessProvider,
  useGitHostAccess,
  type GitHostAccess,
} from './layout/gitHostAccess';

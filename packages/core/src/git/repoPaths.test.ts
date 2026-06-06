import { describe, expect, it } from 'vitest';

import { ATTACHMENTS_DIR, WORKSPACE_DIR, WORKSPACE_JSON_PATH, attachmentPath } from './repoPaths';

describe('repoPaths', () => {
  it('uses the .apicircle dotfolder as the workspace dir', () => {
    expect(WORKSPACE_DIR).toBe('.apicircle');
  });

  it('writes the synced workspace document under the dotfolder', () => {
    expect(WORKSPACE_JSON_PATH).toBe('.apicircle/workspace.json');
  });

  it('attachments dir is under the same dotfolder', () => {
    expect(ATTACHMENTS_DIR).toBe('.apicircle/attachments');
  });

  it('attachmentPath embeds the slot id verbatim', () => {
    expect(attachmentPath('slot-1')).toBe('.apicircle/attachments/slot-1');
    expect(attachmentPath('with spaces')).toBe('.apicircle/attachments/with spaces');
  });
});

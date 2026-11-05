import { describe, it, expect } from 'vitest';
import type { RecentEntry } from '../state/autosaveController.js';
import { recentMenuItems, removeMessage } from './recentMenu.js';

const entry = (fileName: string, owner: RecentEntry['owner'], savedAt: string): RecentEntry => ({
  key: `k.${fileName}`,
  fileName,
  savedAt,
  owner,
  session: {} as RecentEntry['session'],
});

describe('recentMenuItems', () => {
  it('opens anything but this tab\'s own diagram, and removes only a closed tab\'s', () => {
    const items = recentMenuItems(
      [
        entry('mine.dgm', 'this-tab', '2026-11-04T10:00:00Z'),
        entry('closed.dgm', 'closed', '2026-11-04T09:00:00Z'),
        entry('other.dgm', 'unknown', '2026-11-04T08:00:00Z'),
      ],
      (iso) => `at ${iso}`,
    );
    expect(items.map(({ fileName, when, ownerLabel, canOpen, canRemove }) => [fileName, when, ownerLabel, canOpen, canRemove])).toEqual([
      ['mine.dgm', 'at 2026-11-04T10:00:00Z', 'this tab', false, false],
      ['closed.dgm', 'at 2026-11-04T09:00:00Z', 'a closed tab', true, true],
      ['other.dgm', 'at 2026-11-04T08:00:00Z', 'another tab', true, false],
    ]);
  });
});

describe('removeMessage', () => {
  it('says why a remove did nothing, and nothing when it worked', () => {
    expect(removeMessage('removed', 'a.dgm')).toBeNull();
    expect(removeMessage('refused', 'a.dgm')).toMatch(/a\.dgm was not removed/);
    expect(removeMessage('missing', 'a.dgm')).toMatch(/a\.dgm is no longer kept/);
  });
});

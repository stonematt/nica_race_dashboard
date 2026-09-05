/**
 * The catalog reads shape, not rows, so it belongs in the default lane and the
 * fixtures here are hand-written miniatures of the two API shapes. They carry
 * the structural facts that matter — a `lists` array in 2025, `Tab.Config.Lists`
 * in 2026, and event 357242's duplicate `Name` — and no rider data at all.
 */

import { describe, expect, it } from 'vitest';
import { configUrl, listIdForName, listUrl, readCatalog, SourceCatalogError } from './catalog.ts';

/** Event 357242's shape: two entries, one hidden, sharing an ID and a name. */
const config2025 = {
  key: 'dc364c6c45dec11a1e1dd1b477c621bb',
  eventname: 'Race 1 - ORLeague - Old Oak Prologue',
  lists: [
    {
      ID: '2A48B4',
      Name: '03 - Season Overall Results|Individual Results - Overall',
      Mode: 'hidden',
      ShowAs: 'Individual Results',
    },
    {
      ID: '2A48B4',
      Name: '03 - Season Overall Results|Individual Results - Overall',
      Mode: '',
      ShowAs: 'Individual Results',
    },
    {
      ID: '4F491D',
      Name: '10 - Prologue Results Lists|Prologue/TT Results ALL',
      Mode: '',
      ShowAs: 'Individual Results',
    },
  ],
};

/** Event 418436's shape: the catalog moved, and names gained an `Online|` prefix. */
const config2026 = {
  key: '8b0e7d15edef8ba5a9afadaa3b327f4f',
  eventname: 'NICA Oregon - Race 1 - Old Oak Prologue',
  Tab: {
    Config: {
      Lists: [
        { ID: 'F1A053', Name: 'Online|Individual Results', Mode: '', ShowAs: '' },
        { ID: 'C6D0BA', Name: 'Online|Individuals Results - By Team', Mode: '', ShowAs: '' },
      ],
    },
  },
};

describe('readCatalog', () => {
  it('reads the 2025 shape from the top-level lists array', () => {
    const catalog = readCatalog('357242', config2025);

    expect(catalog.shape).toBe('2025');
    expect(catalog.eventId).toBe('357242');
    expect(catalog.key).toBe('dc364c6c45dec11a1e1dd1b477c621bb');
    expect(catalog.eventName).toBe('Race 1 - ORLeague - Old Oak Prologue');
  });

  it('reads the 2026 shape from Tab.Config.Lists', () => {
    const catalog = readCatalog('418436', config2026);

    expect(catalog.shape).toBe('2026');
    expect(catalog.lists.map((list) => list.id)).toEqual(['F1A053', 'C6D0BA']);
    expect(catalog.lists[0]!.name).toBe('Online|Individual Results');
  });

  it('refuses a config with neither catalog key rather than reading it as empty', () => {
    // The 2026 trap in its pure form: read with 2025 assumptions this yields
    // `[]`, archives nothing, and nobody finds out until a season is missing.
    expect(() => readCatalog('418436', { key: 'k', eventname: 'e' })).toThrow(SourceCatalogError);
    expect(() => readCatalog('418436', { key: 'k', eventname: 'e' })).toThrow(/shape trap/);
  });

  it('refuses an empty catalog', () => {
    expect(() => readCatalog('357242', { ...config2025, lists: [] })).toThrow(
      /list catalog is empty/,
    );
  });

  it('collapses a list published twice under one ID, keeping the visible copy', () => {
    const catalog = readCatalog('357242', config2025);

    expect(catalog.lists).toHaveLength(2);
    const overall = catalog.lists.find((list) => list.id === '2A48B4');
    expect(overall?.mode).toBe('');
  });

  it('refuses one ID published under two names', () => {
    const conflicting = {
      ...config2025,
      lists: [
        { ID: '2A48B4', Name: 'A|One', Mode: '', ShowAs: '' },
        { ID: '2A48B4', Name: 'A|Two', Mode: '', ShowAs: '' },
      ],
    };

    expect(() => readCatalog('357242', conflicting)).toThrow(/published under two names/);
  });

  it('refuses a list entry with no ID', () => {
    const noId = { ...config2025, lists: [{ Name: 'A|One', Mode: '' }] };

    expect(() => readCatalog('357242', noId)).toThrow(/expected a string `ID`/);
  });
});

describe('listIdForName', () => {
  const catalog = readCatalog('357242', config2025);

  it('resolves a published name to its hex ID', () => {
    expect(listIdForName(catalog, '10 - Prologue Results Lists|Prologue/TT Results ALL')).toBe(
      '4F491D',
    );
  });

  it('is fatal on zero matches, and names what was published', () => {
    expect(() => listIdForName(catalog, 'Individual Results')).toThrow(
      /no published list is named/,
    );
    expect(() => listIdForName(catalog, 'Individual Results')).toThrow(/Prologue\/TT Results ALL/);
  });

  it('is fatal on two matches rather than picking one', () => {
    const ambiguous = readCatalog('357242', {
      ...config2025,
      lists: [
        { ID: 'AAAAAA', Name: 'A|Same', Mode: '', ShowAs: '' },
        { ID: 'BBBBBB', Name: 'A|Same', Mode: '', ShowAs: '' },
      ],
    });

    expect(() => listIdForName(ambiguous, 'A|Same')).toThrow(/cannot identify one/);
  });
});

describe('urls', () => {
  it('keeps the 2025 config on RRPublish, which does not redirect', () => {
    expect(configUrl('357242', '2025')).toBe(
      'https://my.raceresult.com/357242/RRPublish/data/config?page=results&noVisitor=1',
    );
  });

  it('sends the 2026 config to the moved endpoint', () => {
    expect(configUrl('418436', '2026')).toBe(
      'https://my.raceresult.com/418436/results/config?page=results&noVisitor=1',
    );
  });

  it('encodes the list name, pipe and all, on the non-redirecting list path', () => {
    const url = listUrl('357242', 'abc123', '10 - Prologue Results Lists|Prologue/TT Results ALL');

    expect(url.startsWith('https://my.raceresult.com/357242/results/list?')).toBe(true);
    expect(new URL(url).searchParams.get('listname')).toBe(
      '10 - Prologue Results Lists|Prologue/TT Results ALL',
    );
    expect(new URL(url).searchParams.get('key')).toBe('abc123');
    expect(url).not.toContain('RRPublish');
  });
});

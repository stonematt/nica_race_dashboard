/**
 * The stripper, shown a payload with people in it.
 *
 * Every payload here is synthetic and every person invented — reading the real
 * corpus into a test the default lane runs would defeat the thing being built.
 * The shape copies what RaceResult actually publishes: a `DataFields` column
 * list beside a `data` bag of positional rows, grouped one to three deep.
 *
 * Default lane.
 */

import { describe, expect, it } from 'vitest';
import { groupTreeOf, stripConfigPayload, stripListPayload } from './strip.ts';

const IDENTITY = { season: 2025, eventId: '359478', listId: '4C8C1F', hidden: false };

const A_ROW = ['214', '9', '1', 'JORDAN RIVERS', 'Some Composite', '00:41:12.3'];
const ANOTHER_ROW = ['215', '10', '2', 'Anne-Marie Dubois', 'Some Composite', '00:42:01.9'];

/** A flat list, grouped by category the way the individual lists are. */
const flatPayload = {
  list: {
    ListName: '02 - Result Lists|Individual Results - ALL',
    ListFooterText: 'Number of records: 3',
    Fields: [
      { Expression: 'BIB', Label: 'PLATE', FontBold: true },
      { Expression: 'ucase([DisplayName])', Label: 'RIDER', FontBold: false },
    ],
    Orders: [{ Expression: 'CONTEST.NAME', Grouping: 1, Descending: false, FontSize: 12 }],
    PageFormat: 'A4',
    HeadLine1: 'Race 2',
  },
  DataFields: ['BIB', 'ID', 'CategoryRank', 'ucase([DisplayName])', 'CLUB', 'TotalTime'],
  data: {
    '#1_HS1 Boys - North': [A_ROW, ANOTHER_ROW],
    '#2_HS1 Girls - North': [A_ROW],
  },
  users: ['someone@example.com'],
};

describe('stripping a list payload', () => {
  const stripped = stripListPayload(IDENTITY, flatPayload);
  const asText = JSON.stringify(stripped);

  it('drops every row', () => {
    expect(stripped.data).toEqual({});
  });

  it('carries nothing from any row anywhere in the file', () => {
    // Every cell that could identify anybody: the plate, the name in both
    // published spellings, the scoring team, the finish time. A one-character
    // cell — a grade, a category rank — is not asserted here because it cannot
    // be told apart from a row count by substring; `data` being empty is what
    // covers those.
    for (const cell of [...A_ROW, ...ANOTHER_ROW].filter((value) => value.length > 2)) {
      expect(asText).not.toContain(cell);
    }
  });

  it('records the row counts where the rows were', () => {
    expect(Object.values(stripped.shape.groups)).toEqual([2, 1]);
  });

  it('replaces the group labels rather than publishing them', () => {
    expect(asText).not.toContain('HS1 Boys - North');
    expect(Object.keys(stripped.shape.groups)).toEqual(['#1_group-1-1', '#2_group-1-2']);
  });

  it('keeps the columns verbatim, in payload order', () => {
    expect(stripped.DataFields).toEqual(flatPayload.DataFields);
  });

  it('keeps every displayed expression and drops its styling', () => {
    expect(stripped.list.Fields).toEqual([
      { Expression: 'BIB' },
      { Expression: 'ucase([DisplayName])' },
    ]);
  });

  it('keeps the grouping orders, which are what makes a level of `data`', () => {
    expect(stripped.list.Orders).toEqual([{ Expression: 'CONTEST.NAME', Grouping: 1 }]);
  });

  it('keeps the list name and the published row count', () => {
    expect(stripped.list.ListName).toBe(flatPayload.list.ListName);
    expect(stripped.list.ListFooterText).toBe('Number of records: 3');
  });

  it('drops everything nobody named', () => {
    // Subtractive by construction: a field the stripper does not name is gone,
    // which is the safe default for a script whose input is minors' results.
    expect(asText).not.toContain('someone@example.com');
    expect(asText).not.toContain('PageFormat');
    expect(asText).not.toContain('HeadLine1');
  });

  it('records the identity the payload does not carry', () => {
    expect(stripped.shape).toMatchObject({
      season: 2025,
      eventId: '359478',
      listId: '4C8C1F',
      hidden: false,
    });
  });
});

describe('stripping a nested list payload', () => {
  it('records counts at every level, with per-level ordinals', () => {
    const tree = groupTreeOf({
      '#1_High School': {
        '#1_Division 1': { '#1_Camas Composite Panthers - D1': [A_ROW, ANOTHER_ROW] },
        '#2_Division 2': { '#2_Corbett High School - D2': [A_ROW] },
      },
      '#2_Middle School': {
        '#3_Division 1': { '#3_Gorge Composite - D1': [] },
      },
    });

    expect(tree).toEqual({
      '#1_group-1-1': {
        '#1_group-2-1': { '#1_group-3-1': 2 },
        '#2_group-2-2': { '#2_group-3-2': 1 },
      },
      '#2_group-1-2': { '#3_group-2-3': { '#3_group-3-3': 0 } },
    });
  });

  it('refuses a payload whose rows are not grouped at all', () => {
    expect(() => groupTreeOf([A_ROW])).toThrow(/expected a group object/);
  });
});

describe('a payload whose shape the stripper cannot read', () => {
  it('refuses a `Fields` that stopped being a list', () => {
    // Stripping it to `[]` would commit a file claiming the list displayed no
    // columns — drift published as fact.
    const payload = { ...flatPayload, list: { ...flatPayload.list, Fields: 'gone' } };

    expect(() => stripListPayload(IDENTITY, payload)).toThrow(/`list.Fields` is string/);
  });

  it('refuses an `Orders` that stopped being a list', () => {
    const payload = { ...flatPayload, list: { ...flatPayload.list, Orders: 7 } };

    expect(() => stripListPayload(IDENTITY, payload)).toThrow(/`list.Orders` is number/);
  });

  it('accepts a list that publishes neither, which the reader already allows', () => {
    const payload = { ...flatPayload, list: { ListName: 'x', ListFooterText: '' } };

    expect(stripListPayload(IDENTITY, payload).list.Fields).toEqual([]);
  });
});

describe('stripping a config', () => {
  const config2025 = {
    key: 'a-short-lived-request-token',
    eventname: 'Race 2 - ORLeague Sherwood - South',
    lists: [
      { ID: '4C8C1F', Name: '02 - Result Lists|Individual Results - ALL', Mode: '' },
      { ID: '2A48B4', Name: '03 - Season Overall|Individual Results - Overall', Mode: 'hidden' },
    ],
    contests: [{ Name: 'HS1 Boys' }],
  };

  const config2026 = {
    key: 'another-token',
    eventname: 'NICA Oregon - Race 1 - Old Oak Prologue',
    Tab: {
      Config: { Lists: [{ ID: 'F1A053', Name: 'Online|Individual Results', Mode: '' }] },
    },
  };

  it('redacts the request token', () => {
    // Short-lived, says nothing about shape, and there is no reason for a
    // public repository to carry one.
    const stripped = stripConfigPayload(2025, '359478', config2025);

    expect(stripped.key).toBe('«KEY»');
    expect(JSON.stringify(stripped)).not.toContain('a-short-lived-request-token');
  });

  it('leaves the 2025 catalog where 2025 published it', () => {
    const stripped = stripConfigPayload(2025, '359478', config2025);

    expect(stripped.shape.sourceShape).toBe('2025');
    expect(stripped.lists).toEqual(config2025.lists);
    expect(stripped.Tab).toBeUndefined();
  });

  it('leaves the 2026 catalog where 2026 published it', () => {
    // Normalizing the two into one shape would destroy the only thing the
    // empty-catalog trap can be tested against.
    const stripped = stripConfigPayload(2026, '418436', config2026);

    expect(stripped.shape.sourceShape).toBe('2026');
    expect(stripped.Tab!.Config.Lists).toEqual(config2026.Tab.Config.Lists);
    expect(stripped.lists).toBeUndefined();
  });

  it('drops everything but the catalog and the event name', () => {
    expect(JSON.stringify(stripConfigPayload(2025, '359478', config2025))).not.toContain(
      'contests',
    );
  });

  it('refuses a config the ingest layer would refuse', () => {
    expect(() => stripConfigPayload(2025, '359478', { key: 'k', eventname: 'e' })).toThrow();
  });
});

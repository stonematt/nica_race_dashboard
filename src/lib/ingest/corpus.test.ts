/**
 * Corpus grouping and record building, both pure.
 *
 * Default lane: these tests hand the functions filenames and hand-written
 * miniature payloads, so they read nothing off disk. The corpus actually
 * landing is `corpus.local.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { buildEventRecords, CorpusError, groupCorpusFiles, type LoadedPayload } from './corpus.ts';
import { SourceCatalogError } from './catalog.ts';

const config = {
  key: 'abc123',
  eventname: 'Race 4 - ORLeague Newport Gnarnia - North',
  lists: [
    { ID: 'AAA111', Name: '02 - Result Lists|Individual Results - North', Mode: '', ShowAs: '' },
    { ID: 'BBB222', Name: '02 - Result Lists|Team Results', Mode: 'hidden', ShowAs: '' },
  ],
};

const listPayload = (name: string): LoadedPayload => ({
  path: `/corpus/2025/raw-363499-${name}.json`,
  payload: { list: { ListName: name }, DataFields: ['BIB'], data: {} },
});

describe('groupCorpusFiles', () => {
  const names = [
    'config-357242.json',
    'config-359477.json',
    'raw-357242-individual-results-overall.json',
    'raw-357242-team-results.json',
    'raw-359477-individual-results-south.json',
    'byteam-summary.json',
    'configs-summary.json',
    'lists-summary.json',
    'lists10-summary.json',
    'README.txt',
  ];

  it('groups payloads under their event, in event order', () => {
    const events = groupCorpusFiles(2025, '/corpus/2025', names);

    expect(events.map((event) => event.eventId)).toEqual(['357242', '359477']);
    expect(events[0]!.season).toBe(2025);
    expect(events[0]!.configPath).toBe('/corpus/2025/config-357242.json');
    expect(events[0]!.listPaths).toEqual([
      '/corpus/2025/raw-357242-individual-results-overall.json',
      '/corpus/2025/raw-357242-team-results.json',
    ]);
  });

  it('ignores the decode summaries, which are analysis rather than responses', () => {
    const events = groupCorpusFiles(2025, '/corpus/2025', names);
    const paths = events.flatMap((event) => [event.configPath, ...event.listPaths]);

    expect(paths.some((path) => path.includes('summary'))).toBe(false);
    expect(paths).toHaveLength(5);
  });

  it('keeps an event whose lists were never fetched', () => {
    const events = groupCorpusFiles(2025, '/corpus/2025', ['config-366186.json']);

    expect(events).toHaveLength(1);
    expect(events[0]!.listPaths).toEqual([]);
  });

  it('refuses a list payload with no config beside it', () => {
    // Without the config there is no list_id, and raw_fetch is keyed on it.
    expect(() => groupCorpusFiles(2025, '/corpus/2025', ['raw-999999-team-results.json'])).toThrow(
      CorpusError,
    );
  });
});

describe('buildEventRecords', () => {
  const event = { season: 2025, eventId: '363499' };

  it('puts the config first, with a null list_id and its own URL', () => {
    const records = buildEventRecords(event, config, []);

    expect(records).toHaveLength(1);
    expect(records[0]!.listId).toBeNull();
    expect(records[0]!.listName).toBe('config');
    expect(records[0]!.url).toBe(
      'https://my.raceresult.com/363499/RRPublish/data/config?page=results&noVisitor=1',
    );
    expect(records[0]!.payload).toBe(config);
  });

  it('keys each list on the config hex ID, taken from the payload own name', () => {
    const records = buildEventRecords(event, config, [
      listPayload('02 - Result Lists|Individual Results - North'),
      listPayload('02 - Result Lists|Team Results'),
    ]);

    expect(records.map((record) => record.listId)).toEqual([null, 'AAA111', 'BBB222']);
    expect(records[1]!.url).toContain('key=abc123');
    expect(records.every((record) => record.season === 2025)).toBe(true);
  });

  it('archives a hidden list the same as a visible one', () => {
    const records = buildEventRecords(event, config, [
      listPayload('02 - Result Lists|Team Results'),
    ]);

    expect(records[1]!.listId).toBe('BBB222');
  });

  it('refuses a payload whose list name the config does not publish', () => {
    expect(() =>
      buildEventRecords(event, config, [listPayload('Online|Individual Results')]),
    ).toThrow(SourceCatalogError);
  });

  it('refuses a payload that does not say which list it is', () => {
    expect(() =>
      buildEventRecords(event, config, [{ path: '/corpus/2025/raw-363499-x.json', payload: {} }]),
    ).toThrow(/no `list.ListName`/);
  });

  it('does not read a filename for meaning', () => {
    // The filename slug is whatever the crawl called it. Identity comes from
    // the payload's own ListName, resolved through the config.
    const records = buildEventRecords(event, config, [
      {
        path: '/corpus/2025/raw-363499-nonsense-slug.json',
        payload: { list: { ListName: '02 - Result Lists|Team Results' } },
      },
    ]);

    expect(records[1]!.listId).toBe('BBB222');
  });
});

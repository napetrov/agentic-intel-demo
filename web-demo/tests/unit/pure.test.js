// Unit tests for the pure helpers in lib/pure.js. These run under
// Vitest in a Node environment — no DOM, no fetch. UI-coupled rendering
// is covered by Playwright smoke (tests/smoke.spec.js).

import { describe, it, expect } from 'vitest';

const lib = require('../../lib/pure.js');

describe('profileToVcpu', () => {
  it.each([
    ['small', 1],
    ['medium', 4],
    ['large', 16]
  ])('maps %s → %i', (profile, expected) => {
    expect(lib.profileToVcpu(profile)).toBe(expected);
  });

  it.each([undefined, null, '', 'xl', 'tiny'])(
    'unknown profile %p → 0',
    (profile) => {
      expect(lib.profileToVcpu(profile)).toBe(0);
    }
  );
});

describe('escapeHtml', () => {
  it('escapes the HTML metacharacters', () => {
    expect(lib.escapeHtml(`<a href="x">&y'z</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;y&#39;z&lt;/a&gt;'
    );
  });

  it('coerces non-strings via String()', () => {
    expect(lib.escapeHtml(42)).toBe('42');
    expect(lib.escapeHtml(null)).toBe('null');
    expect(lib.escapeHtml(undefined)).toBe('undefined');
  });

  it('escapes ampersand first to avoid double-encoding', () => {
    // If `&` ran after `<`, the `&` in `&lt;` would be re-encoded.
    expect(lib.escapeHtml('<')).toBe('&lt;');
    expect(lib.escapeHtml('&<')).toBe('&amp;&lt;');
  });
});

describe('truncateValue', () => {
  it('returns input unchanged when under the limit', () => {
    expect(lib.truncateValue('hello', 10)).toBe('hello');
    expect(lib.truncateValue('exactly10!', 10)).toBe('exactly10!');
  });

  it('truncates and appends an ellipsis at length max', () => {
    // The truncation includes max-1 chars + '…' = max display chars.
    const out = lib.truncateValue('abcdefghijklmnop', 10);
    expect(out).toBe('abcdefghi…');
    expect(out).toHaveLength(10);
  });

  it('coerces non-strings via String()', () => {
    expect(lib.truncateValue(123456, 4)).toBe('123…');
  });
});

describe('formatAge', () => {
  it('returns em-dash for non-finite or negative', () => {
    expect(lib.formatAge(NaN)).toBe('—');
    expect(lib.formatAge(Infinity)).toBe('—');
    expect(lib.formatAge(-1)).toBe('—');
  });

  it('formats sub-minute values as Ns', () => {
    expect(lib.formatAge(0)).toBe('0s');
    expect(lib.formatAge(1.4)).toBe('1s');
    expect(lib.formatAge(59.6)).toBe('60s'); // rounds; not yet a minute
  });

  it('formats minute+ values as MmSSs with zero-pad', () => {
    expect(lib.formatAge(60)).toBe('1m00s');
    expect(lib.formatAge(61)).toBe('1m01s');
    expect(lib.formatAge(125)).toBe('2m05s');
    expect(lib.formatAge(3661)).toBe('61m01s');
  });
});

describe('buildScenarioToolActivity', () => {
  it('returns [] for missing or malformed input', () => {
    expect(lib.buildScenarioToolActivity(null, 'planned')).toEqual([]);
    expect(lib.buildScenarioToolActivity({}, 'planned')).toEqual([]);
    expect(lib.buildScenarioToolActivity({ toolActivity: null }, 'planned')).toEqual([]);
  });

  it('fills name from tool when name is absent', () => {
    const out = lib.buildScenarioToolActivity(
      { toolActivity: [{ tool: 'terminal', value: 'ls' }] },
      'planned'
    );
    expect(out).toEqual([
      { tool: 'terminal', name: 'terminal', value: 'ls', status: 'planned' }
    ]);
  });

  it('preserves explicit name and explicit status', () => {
    const out = lib.buildScenarioToolActivity(
      {
        toolActivity: [
          { tool: 'api_call', name: 'POST /chat', status: 'done' }
        ]
      },
      'planned'
    );
    expect(out[0].name).toBe('POST /chat');
    expect(out[0].status).toBe('done');
  });

  it('does not mutate the input rows', () => {
    const row = { tool: 'terminal' };
    const scenario = { toolActivity: [row] };
    lib.buildScenarioToolActivity(scenario, 'planned');
    expect(row).toEqual({ tool: 'terminal' });
  });
});

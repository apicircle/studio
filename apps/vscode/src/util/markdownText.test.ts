import { describe, it, expect } from 'vitest';
import { markdownCode, markdownCodeBlock, markdownParagraphs, markdownText } from './markdownText';

const HOSTILE =
  'Get users [docs](command:workbench.action.terminal.sendSequence?%7B%22text%22%3A%22x%22%7D) `tick` **bold** $(zap)';

describe('markdownText', () => {
  it('leaves ordinary text untouched', () => {
    for (const value of ['Login', 'Pet Store', 'list pets', 'Prod token 2', 'Café 🧪 — ok']) {
      expect(markdownText(value)).toBe(value);
    }
  });

  it('backslash-escapes every ASCII punctuation character', () => {
    const punctuation = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
    const expected = [...punctuation].map((c) => `\\${c}`).join('');
    expect(markdownText(punctuation)).toBe(expected);
  });

  it('neutralises a command link, a markdown link, code, emphasis and a theme icon', () => {
    expect(markdownText(HOSTILE)).toBe(
      'Get users \\[docs\\]\\(command\\:workbench\\.action\\.terminal\\.sendSequence\\?\\%7B\\%22text\\%22\\%3A\\%22x\\%22\\%7D\\) \\`tick\\` \\*\\*bold\\*\\* \\$\\(zap\\)',
    );
  });

  it('breaks bare URL and e-mail autolinks', () => {
    expect(markdownText('see https://evil.example or www.evil.example or a@evil.example')).toBe(
      'see https\\:\\/\\/evil\\.example or www\\.evil\\.example or a\\@evil\\.example',
    );
  });

  it('collapses line breaks so a value cannot open a new block', () => {
    expect(markdownText('a\n\n# b\r\n- c\rd')).toBe('a \\# b \\- c d');
  });
});

describe('markdownParagraphs', () => {
  it('keeps blank-line paragraph breaks and escapes each paragraph', () => {
    expect(markdownParagraphs('Try **this**\n\n    second [x](command:foo)\r\n\r\nthird')).toBe(
      'Try \\*\\*this\\*\\*\n\nsecond \\[x\\]\\(command\\:foo\\)\n\nthird',
    );
  });

  it('folds a single line break into a space, as markdown already renders it', () => {
    expect(markdownParagraphs('one\ntwo\r\nthree')).toBe('one two three');
  });
});

describe('markdownCode', () => {
  it('wraps an ordinary value in a single-backtick span', () => {
    expect(markdownCode('https://api.prod')).toBe('`https://api.prod`');
    expect(markdownCode('API_BASE')).toBe('`API_BASE`');
  });

  it('uses a fence longer than the longest backtick run inside', () => {
    expect(markdownCode('a``b`c')).toBe('```a``b`c```');
  });

  it('pads a value that starts or ends with a backtick so the fence stays separate', () => {
    expect(markdownCode('`x')).toBe('`` `x ``');
    expect(markdownCode('x`')).toBe('`` x` ``');
    expect(markdownCode('`[x](command:foo)` **b** $(zap)')).toBe(
      '`` `[x](command:foo)` **b** $(zap) ``',
    );
  });

  it('keeps the span on one line so a blank line cannot end it', () => {
    expect(markdownCode('a\n\nb\r\nc')).toBe('`a b c`');
  });
});

describe('markdownCodeBlock', () => {
  it('fences ordinary text with three backticks', () => {
    expect(markdownCodeBlock('boom')).toBe('```\nboom\n```');
  });

  it('outgrows any backtick run inside so no line can close the fence', () => {
    expect(markdownCodeBlock('a\n````\n[x](command:foo)')).toBe(
      '`````\na\n````\n[x](command:foo)\n`````',
    );
  });
});

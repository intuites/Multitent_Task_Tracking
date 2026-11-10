import { describe, expect, it } from 'vitest';
import { mentionedIds, mentionQuery } from './mentions';

describe('mentionQuery', () => {
  it('finds the @word right before the caret', () => {
    expect(mentionQuery('@', 1)).toEqual({ at: 0, q: '' });
    expect(mentionQuery('hi @ab', 6)).toEqual({ at: 3, q: 'ab' });
  });
  it('ignores emails, finished words and text after the caret', () => {
    expect(mentionQuery('mail a@b', 8)).toBeNull();
    expect(mentionQuery('@ab done', 8)).toBeNull();
    expect(mentionQuery('hi @ab', 2)).toBeNull();
  });
});

describe('mentionedIds', () => {
  const asha = { id: 'a', name: 'Asha Rao' }, ravi = { id: 'r', name: 'Ravi' };
  it('keeps only people still named in the text, once each', () => {
    expect(mentionedIds('@Asha Rao and @Asha Rao', [asha, asha, ravi])).toEqual(['a']);
    expect(mentionedIds('no one', [asha])).toEqual([]);
  });
});

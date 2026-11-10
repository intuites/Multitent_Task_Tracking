import { describe, expect, it } from 'vitest';
import { lookToKeep, prefsFor } from './theme';

const org = { brand_color: '#D97706', font_family: 'lora', font_style: 'expressive', text_size: 'large' };

describe('lookToKeep', () => {
  it('saves what someone sees now when they have no look of their own', () => {
    expect(lookToKeep({ theme: 'dark' }, org)).toEqual({ theme: 'dark', color: '#d97706', font: 'lora', style: 'expressive', size: 'large' });
  });
  it('fills only the missing parts and keeps their own choices', () => {
    expect(lookToKeep({ color: '#123456' }, null)).toEqual({ color: '#123456', font: 'fabric', style: 'classic', size: 'compact' });
  });
  it('leaves a complete look alone, so an organization change never reaches it', () => {
    expect(lookToKeep({ color: '#123456', font: 'fabric', style: 'classic', size: 'normal' }, org)).toBeNull();
  });
});

describe('prefsFor', () => {
  const kpmg = { color: '#e8590c', font: 'lora', style: 'classic', size: 'large' } as const;
  const p = { theme: 'dark', color: '#2563eb', font: 'fabric', style: 'classic', size: 'compact', orgs: { kpmg } } as const;
  it('uses the look saved for that organization, keeping everything else', () => {
    expect(prefsFor(p, 'kpmg')).toMatchObject({ ...kpmg, theme: 'dark' });
  });
  it('uses the usual look in other organizations, or with none open', () => {
    expect(prefsFor(p, 'abc').color).toBe('#2563eb');
    expect(prefsFor(p, null).color).toBe('#2563eb');
  });
});

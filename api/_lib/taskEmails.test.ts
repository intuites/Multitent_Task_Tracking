import { describe, it, expect } from 'vitest';
import { digestDue, localClock } from './taskEmails';
import { digest, taskCompleted, taskReminder, type TaskMail } from './emailTemplates';
import { mime } from './email';

const ctx = { org: 'KPMG', tz: 'America/New_York', appUrl: 'https://app.test' };
const task: TaskMail = {
  id: '11111111-1111-1111-1111-111111111111', title: 'Fix <login>', description: null, status: 'started', priority: 'medium',
  due_date: '2026-10-01T16:00:00Z', created_at: '2026-09-30T21:48:47Z', completed_at: null, department: 'Software Developers',
  assignees: ['Akhil'], createdBy: 'Abdul', completedBy: null, lead: null, manager: null,
  history: [{ at: '2026-10-06T21:42:08Z', status: 'started', comment: 'Working', user: 'Akhil' }],
};

describe('digest timing', () => {
  it('fires at 13:30 and 17:50 New York time, summer and winter', () => {
    // winter (EST): 18:30 UTC = 13:30 NY = 00:00 IST; summer (EDT): 17:30 UTC = 13:30 NY = 23:00 IST
    expect(localClock(new Date('2026-12-01T18:30:00Z'), 'America/New_York').hm).toBe('13:30');
    expect(localClock(new Date('2026-07-01T17:30:00Z'), 'America/New_York').hm).toBe('13:30');
    expect(digestDue('13:29')).toBeNull();
    expect(digestDue('13:30')).toBe('midday');
    expect(digestDue('17:49')).toBe('midday');
    expect(digestDue('17:50')).toBe('eod');
  });
});

describe('task emails', () => {
  it('reminder: subject in the house style, history newest first, title escaped', () => {
    const m = taskReminder(task, ctx, new Date('2026-11-05T12:00:00Z'));
    expect(m.subject).toBe('Fix <login> -> Sep 30, 2026 -> Started since 35 days');
    expect(m.html).toContain('Fix &#60;login&#62;');
    expect(m.html).not.toContain('<login>');
    expect(m.html.indexOf('Working')).toBeLessThan(m.html.indexOf('Created</td>'));
  });
  it('completed: says it is closed for good', () => {
    const m = taskCompleted({ ...task, status: 'completed', completed_at: '2026-10-08T12:00:00Z', completedBy: 'Akhil' }, ctx);
    expect(m.subject).toBe('Fix <login> -> Completed Permanently [Due Oct 1, 2026]');
    expect(m.html).toContain('closed for good');
  });
  it('digest: counts in the subject, overdue first', () => {
    const rows = [
      { id: 'a', title: 'Later', department: 'Ops', assignees: [], status: 'pending', priority: 'low', due_date: '2026-12-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z' },
      { id: 'b', title: 'Late one', department: 'Ops', assignees: [], status: 'started', priority: 'high', due_date: '2026-10-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z' },
    ];
    const m = digest('midday', rows, { open: 2, overdue: 1, dueToday: 0, doneToday: 0 }, ctx, 'All departments', new Date('2026-11-05T18:30:00Z'));
    expect(m.subject).toBe('[Task Digest] Midday - Nov 5, 2026 - 2 open, 1 overdue');
    expect(m.html.indexOf('Late one')).toBeLessThan(m.html.indexOf('Later'));
  });
});

describe('gmail message', () => {
  it('encodes a UTF-8 subject and both parts', () => {
    const raw = Buffer.from(mime('Ops <ops@x.co>', 'a@b.co', 'Task ✅ done', 'plain', '<b>html</b>'), 'base64url').toString();
    expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from('Task ✅ done').toString('base64')}?=`);
    expect(raw).toContain('text/plain');
    expect(raw).toContain('text/html');
  });
});

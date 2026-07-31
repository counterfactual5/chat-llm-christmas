import { describe, expect, it } from 'vitest';
import { createGoogleTools } from '@/lib/mcp/google/tools';

describe('Google MCP tool registration', () => {
  it('registers only the requested service tool family', async () => {
    const tools = await createGoogleTools('authorized', ['calendar']);

    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((tool) => tool.name.startsWith('calendar_'))).toBe(true);
    expect(tools.map((tool) => tool.name)).toContain('calendar_list_events');
  });

  it('expands the legacy google integration toggle to all service tool families', async () => {
    const tools = await createGoogleTools('authorized', ['google']);
    const names = tools.map((tool) => tool.name);

    expect(names.some((name) => name.startsWith('gmail_'))).toBe(true);
    expect(names.some((name) => name.startsWith('calendar_'))).toBe(true);
    expect(names.some((name) => name.startsWith('drive_'))).toBe(true);
  });

  it('keeps the registration order grouped by Gmail, Calendar, then Drive', async () => {
    const names = (await createGoogleTools('authorized')).map((tool) => tool.name);
    const firstCalendar = names.findIndex((name) => name.startsWith('calendar_'));
    const firstDrive = names.findIndex((name) => name.startsWith('drive_'));
    const lastGmail = names.reduce(
      (last, name, index) => (name.startsWith('gmail_') ? index : last),
      -1,
    );
    const lastCalendar = names.reduce(
      (last, name, index) => (name.startsWith('calendar_') ? index : last),
      -1,
    );

    expect(lastGmail).toBeLessThan(firstCalendar);
    expect(lastCalendar).toBeLessThan(firstDrive);
  });
});

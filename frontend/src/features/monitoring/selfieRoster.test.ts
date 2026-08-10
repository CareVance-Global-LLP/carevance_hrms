import { describe, expect, it } from 'vitest';
import { buildSelfieRoster, groupSelfiesByLocation, type SelfieItem } from './selfieRoster';

const selfie = (over: Partial<SelfieItem> = {}): SelfieItem => ({
  id: 1,
  user: { id: 7, name: 'Zara Khan' },
  image_url: 'https://example.test/selfie-1.jpg',
  latitude: 18.5204,
  longitude: 73.8567,
  accuracy_meters: 12,
  attendance_date: '2026-08-06',
  created_at: '2026-08-06T09:02:00.000Z',
  ...over,
});

const employees = [
  { id: 7, name: 'Zara Khan' },
  { id: 9, name: 'Rohan Ghosh' },
  { id: 11, name: 'Neha Joshi' },
];

describe('buildSelfieRoster', () => {
  it('single day: verified, no-GPS, and missing people all appear', () => {
    const days = buildSelfieRoster(
      [
        selfie(),
        selfie({ id: 2, user: { id: 9, name: 'Rohan Ghosh' }, latitude: null, longitude: null, accuracy_meters: null }),
      ],
      employees,
      { singleDay: true, dayISO: '2026-08-06', selectedUserId: '' }
    );

    expect(days).toHaveLength(1);
    const [day] = days;
    expect(day.totalCount).toBe(3);
    expect(day.verifiedCount).toBe(1);

    const kinds = Object.fromEntries(day.rows.map((row) => [row.userName, row.kind]));
    expect(kinds['Zara Khan']).toBe('verified');
    expect(kinds['Rohan Ghosh']).toBe('no-gps');
    expect(kinds['Neha Joshi']).toBe('missing');
  });

  it('range: groups by date, newest first, and never lists missing rows', () => {
    const days = buildSelfieRoster(
      [
        selfie(),
        selfie({ id: 3, attendance_date: '2026-08-04', created_at: '2026-08-04T09:10:00.000Z' }),
      ],
      employees,
      { singleDay: false, selectedUserId: '' }
    );

    expect(days.map((day) => day.dateISO)).toEqual(['2026-08-06', '2026-08-04']);
    expect(days.every((day) => day.rows.every((row) => row.kind !== 'missing'))).toBe(true);
  });

  it('person filter scopes both the roster and the missing check', () => {
    const days = buildSelfieRoster([selfie()], employees, {
      singleDay: true,
      dayISO: '2026-08-06',
      selectedUserId: 9,
    });

    expect(days[0].rows).toHaveLength(1);
    expect(days[0].rows[0].kind).toBe('missing');
    expect(days[0].rows[0].userName).toBe('Rohan Ghosh');
  });
});

describe('groupSelfiesByLocation', () => {
  it('stacks same-spot punches into one group and skips GPS-less selfies', () => {
    const groups = groupSelfiesByLocation([
      selfie(),
      selfie({ id: 2, user: { id: 9, name: 'Rohan Ghosh' }, latitude: 18.52041, longitude: 73.85669 }),
      selfie({ id: 3, user: { id: 11, name: 'Neha Joshi' }, latitude: 19.076, longitude: 72.8777 }),
      selfie({ id: 4, latitude: null, longitude: null }),
    ]);

    expect(groups).toHaveLength(2);
    const office = groups.find((group) => group.items.length === 2);
    expect(office).toBeTruthy();
  });
});

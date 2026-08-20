import { useState } from 'react';
import SegmentedControl from '../components/SegmentedControl';
import WeeklyOffSection from './workingTime/WeeklyOffSection';
import PenalisationSection from './workingTime/PenalisationSection';
import OvertimeSection from './workingTime/OvertimeSection';
import ShiftAllowanceSection from './workingTime/ShiftAllowanceSection';
import PolicyAssignmentsSection from './workingTime/PolicyAssignmentsSection';

type WorkingTimeSection =
  | 'weekly-off'
  | 'penalisation'
  | 'overtime'
  | 'shift-allowance'
  | 'assignments';

const SECTIONS: Array<{ value: WorkingTimeSection; label: string }> = [
  { value: 'weekly-off', label: 'Weekly off' },
  { value: 'penalisation', label: 'Penalisation' },
  { value: 'overtime', label: 'Overtime' },
  { value: 'shift-allowance', label: 'Shift allowance' },
  { value: 'assignments', label: "Who's on what" },
];

/**
 * Working time: the four policies a shift row used to be overloaded with.
 *
 * ONE PANE, FIVE SECTIONS — not four rail entries, and the reason is the thing
 * this whole split makes harder rather than easier. Grace period used to live
 * on the shift. Someone looking for it now has to know it moved to
 * Penalisation, and four separate rail entries would make them guess between
 * four names before they found it. One entry called Working time, with the
 * four objects visible as tabs the moment it opens, turns that guess into a
 * glance. The rail search keywords carry every field name for the same reason.
 *
 * The fifth section is assignment, deliberately shared rather than repeated
 * inside each policy tab: "who is on what" is the question people actually
 * arrive with, and answering it four times in four places is how the four
 * copies drift.
 *
 * Shifts stay in their own pane next door. Timings and breaks are one object;
 * these four are the ones that were wrongly welded to it.
 */
export default function WorkingTimePane() {
  const [section, setSection] = useState<WorkingTimeSection>('weekly-off');

  return (
    <div className="space-y-4">
      <SegmentedControl
        ariaLabel="Working time section"
        value={section}
        onChange={(value) => setSection(value as WorkingTimeSection)}
        options={SECTIONS.map((item) => ({ value: item.value, label: item.label }))}
      />

      {section === 'weekly-off' ? <WeeklyOffSection /> : null}
      {section === 'penalisation' ? <PenalisationSection /> : null}
      {section === 'overtime' ? <OvertimeSection /> : null}
      {section === 'shift-allowance' ? <ShiftAllowanceSection /> : null}
      {section === 'assignments' ? <PolicyAssignmentsSection /> : null}
    </div>
  );
}

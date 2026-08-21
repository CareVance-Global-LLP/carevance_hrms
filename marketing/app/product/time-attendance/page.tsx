import type { Metadata } from 'next';
import { breadcrumbSchema, JsonLd } from '@/lib/schema';
import { Container, Eyebrow, Lead, Section, SectionTitle } from '@/components/ui/primitives';
import {
  ProductHero,
  FeatureBlock,
  NotBuiltNote,
  ProductCta,
} from '@/components/product/PageParts';
import {
  TrackerCapture,
  AttendanceMonth,
  MobileApprovals,
  ConsentNotice,
  PayrollRun,
} from '@/components/product/screens';
import { Panel } from '@/components/product/Frame';
import { inr } from '@/lib/demo';

export const metadata: Metadata = {
  title: 'Time & attendance',
  description:
    'A desktop tracker with screenshots and idle detection, a browser extension, geofenced mobile punch and attendance selfies — and the handoff that turns all of it into the attendance basis for the payroll run, with no export.',
  alternates: { canonical: '/product/time-attendance' },
};

const NOT_CLAIMED = [
  'Biometric or RFID hardware integration',
  'Automatic shift rostering or scheduling optimisation',
  'Screen recording — captures are periodic screenshots, not video',
  'Keystroke logging of any kind',
];

export default function TimeAttendancePage() {
  return (
    <>
      <JsonLd
        schema={breadcrumbSchema([
          { label: 'Home', href: '/' },
          { label: 'Product', href: '/product' },
          { label: 'Time & attendance', href: '/product/time-attendance' },
        ])}
      />

      <ProductHero
        eyebrow="Time & attendance"
        title="The evidence of the work and the hour it produced are the same record."
        lede="Every competitor can track time. Every competitor can run payroll. The gap between the two is where a CSV export lives, and where the monthly argument about whose numbers are right happens. There is no gap here, because there is no second system."
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-start">
          <TrackerCapture />
          <AttendanceMonth />
          <MobileApprovals className="mx-auto lg:mx-0" />
        </div>
      </ProductHero>

      {/* ── Capture ─────────────────────────────────────────────────── */}
      <Section tone="sunken">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>Capture</Eyebrow>
            <SectionTitle className="mt-3">Four ways in, one record out.</SectionTitle>
            <Lead className="mt-4">
              A desktop tracker for people at a machine, a mobile punch for people who are not, and
              a browser extension that supplies the context the tracker cannot see on its own.
            </Lead>
          </div>

          <div className="mt-12 grid gap-16">
            <FeatureBlock
              claim="TIM-01"
              eyebrow="Desktop tracker"
              title="Screenshots, OS-level idle, and a queue that survives the network."
              body="An Electron app that captures periodic screenshots, reads idle from the operating system rather than guessing from mouse movement, and — the part that matters on a bad connection — persists captures to disk when it cannot reach the server, then drains the queue when it can."
              points={[
                { text: 'Screenshots and activity queued to disk while offline', claim: 'TIM-01' },
                { text: 'An idle prompt the person can answer, rather than a silent deduction', claim: 'TIM-04' },
                { text: 'Browser extension supplies URL context for classification', claim: 'TIM-02' },
                { text: 'Activity classified productive or unproductive by configurable rules', claim: 'TIM-03' },
              ]}
              screen={<TrackerCapture />}
            />

            <FeatureBlock
              claim="TIM-04"
              flip
              eyebrow="Idle"
              title="Idle time is recorded, and never billed."
              body="When a timer is auto-stopped, the end time is rewound to the last real activity and the idle tail is stored separately. A timer that ran all night because someone closed their laptop still produces a correct number — the money is right even when the timer was wrong."
              points={[
                { text: 'end_time rewinds to the last real activity; the tail is kept, not discarded', claim: 'TIM-04' },
                { text: 'A server-side sweep runs every minute as the backstop', claim: 'TIM-05' },
                { text: 'The desktop app cannot close a timer once it is asleep or crashed — so the server does', claim: 'TIM-05' },
              ]}
              screen={
                <Panel label="Idle resolution">
                  <div className="p-4">
                    <div className="flex items-baseline justify-between text-[12.5px]">
                      <p className="text-n-600">Timer stopped at</p>
                      <p className="font-semibold text-n-900 tnum">23:59</p>
                    </div>
                    <div className="mt-2 flex items-baseline justify-between text-[12.5px]">
                      <p className="text-n-600">Last real activity</p>
                      <p className="font-semibold text-n-900 tnum">18:12</p>
                    </div>
                    <div className="mt-3 rounded-lg border border-accent-200 bg-accent-50 p-3">
                      <p className="text-[11px] font-semibold tracking-[0.06em] text-accent-700 uppercase">
                        Rewound
                      </p>
                      <p className="mt-1.5 text-[12px] leading-5 text-n-700">
                        End time set to 18:12. The 5h 47m tail is recorded as{' '}
                        <span className="font-mono text-[11px]">trailing_idle_seconds</span> and
                        excluded from billable hours.
                      </p>
                    </div>
                    <p className="mt-3 border-t border-n-200 pt-2.5 text-[11.5px] leading-4 text-n-600">
                      What breaks without the scheduler is the timer appearing to run all night.
                      What never breaks is the amount paid.
                    </p>
                  </div>
                </Panel>
              }
              stat={{ value: '60s', label: 'how often the server-side sweep closes abandoned timers' }}
            />

            <FeatureBlock
              claim="TIM-06"
              eyebrow="Away from a desk"
              title="Geofenced punch, attendance selfies, shifts and comp-off."
              body="For field and site staff, a punch tied to a geofence zone with a selfie attached and a map view of where the day actually happened. Shifts resolve across timezones, overtime and shift-allowance rules apply automatically, and comp-off accrues as a real balance."
              points={[
                { text: 'Geofence zones with a logged punch and a map view', claim: 'TIM-06' },
                { text: 'Shift resolution handles the employee’s own timezone', claim: 'TIM-07' },
                { text: 'Overtime rules, shift allowances and comp-off balances', claim: 'TIM-07' },
                { text: 'Regularisation requests can be forwarded to the right approver', claim: 'TIM-08' },
              ]}
              screen={<MobileApprovals className="mx-auto" />}
              flip
            />
          </div>
        </Container>
      </Section>

      {/* ── The handoff — the whole point of the page ───────────────── */}
      <Section>
        <Container>
          <div className="max-w-2xl">
            <Eyebrow tone="accent">The handoff</Eyebrow>
            <SectionTitle className="mt-3">
              This is the line no competitor can write.
            </SectionTitle>
            <Lead className="mt-4">
              Everything above becomes the attendance basis for the payroll run through a single
              endpoint. Not an integration, not a nightly sync, not a CSV someone downloads on the
              25th — an API call, with a status you can inspect before you trust it.
            </Lead>
          </div>

          <div className="mt-12">
            <FeatureBlock
              claim="TIM-09"
              title="One endpoint, per run or per employee, with a status you can read."
              body="Sync the whole run or a single person. Check paid days, loss of pay and the gross the run will compute from — before you process anything. When something disagrees, you find out here rather than in the differences report next month."
              points={[
                { text: 'POST /payroll/runs/{runId}/sync-attendance', claim: 'TIM-09' },
                { text: 'Per-employee sync for the one person whose month was unusual', claim: 'TIM-09' },
                { text: 'A status endpoint reports what was synced and what was not', claim: 'TIM-09' },
                { text: 'Productivity data feeds the run through the same path', claim: 'TIM-09' },
              ]}
              screen={
                <div className="grid gap-3">
                  <Panel label="Attendance sync · status">
                    <div className="p-4">
                      <p className="text-[12.5px] font-semibold text-n-900">42 of 42 synced</p>
                      <dl className="mt-3 grid gap-1.5 border-t border-n-100 pt-3 text-[12px]">
                        <div className="flex justify-between">
                          <dt className="text-n-600">Paid days</dt>
                          <dd className="font-semibold text-n-800 tnum">22</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-n-600">Loss of pay</dt>
                          <dd className="font-semibold text-n-800 tnum">0 days</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-n-600">Basis for gross</dt>
                          <dd className="font-semibold text-n-900 tnum">{inr(115891.2, true)}</dd>
                        </div>
                      </dl>
                      <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 font-mono text-[10.5px] leading-4 text-brand-800">
                        POST /payroll/runs/&#123;runId&#125;/sync-attendance
                      </p>
                    </div>
                  </Panel>
                  <PayrollRun />
                </div>
              }
            />
          </div>
        </Container>
      </Section>

      {/* ── Consent — the objection, answered ───────────────────────── */}
      <Section tone="sunken">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>Consent</Eyebrow>
            <SectionTitle className="mt-3">
              A tracker without consent machinery is a liability you are buying.
            </SectionTitle>
            <Lead className="mt-4">
              Under the DPDP Act, the penalty for collecting without notice falls on the employer
              running the software, not on the vendor that wrote it. So the controls ship with the
              tracker rather than being left as your problem.
            </Lead>
          </div>

          <div className="mt-12">
            <FeatureBlock
              claim="CON-01"
              title="One gate, and every capture path goes through it."
              body="Screenshots, activity, geofenced punches and attendance selfies all arrive through different controllers — and all ask the same question before recording anything: may this person's data of this kind be collected right now? Four scattered permission checks would be four places to drift."
              points={[
                { text: 'Notices are versioned and never edited in place', claim: 'CON-02' },
                { text: 'Consent is per capture type, with request context recorded', claim: 'CON-03' },
                { text: 'Consent can be withdrawn, and capture stops', claim: 'CON-03' },
                { text: 'Capture is refused once the collection window closes without consent', claim: 'CON-04' },
                { text: 'Screenshots have a scheduled retention purge', claim: 'CON-05' },
              ]}
              screen={<ConsentNotice />}
              flip
            />
          </div>

          <div className="mt-16">
            <NotBuiltNote items={NOT_CLAIMED}>
              What the tracker does is periodic screenshots, foreground application and URL
              context, and OS idle. It is worth being precise about the boundary, because
              “monitoring” covers a wide range and people reasonably assume the worst end of it.
            </NotBuiltNote>
          </div>
        </Container>
      </Section>

      <ProductCta
        title="See the chain run end to end."
        body="A tracked minute, an attendance record, a payroll run and a payslip — the same employee, in one sitting, with no export step in the middle."
      />
    </>
  );
}

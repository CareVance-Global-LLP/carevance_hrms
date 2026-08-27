import { motion, useScroll, useTransform, useMotionValue, useSpring } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, CalendarCheck, Clock4, Download, TrendingUp, Shield, Zap } from 'lucide-react';
import { desktopDownloadUrl } from '@/lib/runtimeConfig';
import { analytics } from '@/lib/analytics';
import { staggerContainer, fadeSlideUp, easeOut } from './animations';
import MagneticButton from './MagneticButton';
import AnimatedCounter from './AnimatedCounter';
import WordRise from './WordRise';
import GradientOrb from './GradientOrb';
import Marquee from './Marquee';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * COUNTED FROM THE CODEBASE, NOT INVENTED.
 *
 * These three replaced "10,000+ active users", "500+ workspaces" and a "32%
 * productivity lift" — none of which existed. There are no users to count yet,
 * and a productivity figure with no study behind it is not a rounding error, it
 * is a fabricated statistic on a page selling payroll software.
 *
 * Each number below is audited in PRODUCT_TRUTH.md at the repo root under the
 * claim ID beside it, which names the file it was counted from. If you change
 * one, change it there first. What a company with no customers honestly has is
 * scope, and scope is checkable.
 */
const stats = [
  { value: 37, suffix: '', label: 'States & UTs with PT resolved', icon: BarChart3 }, // STA-04
  { value: 23, suffix: '', label: 'Statutory documents generated', icon: CalendarCheck }, // FIL-01
  { value: 4, suffix: '', label: 'Apps in the suite', icon: TrendingUp }, // NUM-05
];

/**
 * DO NOT PUT A CERTIFICATION HERE THAT WE DO NOT HOLD.
 *
 * This carried "SOC 2 Compliant", "99.9% Uptime" and "GDPR Ready". We hold no
 * SOC 2 report and no ISO 27001 certificate — /security says so in as many
 * words — and there is no measured uptime figure to publish. A buyer's
 * procurement team asks for the report, and the answer being "there isn't one"
 * after the badge said otherwise ends the evaluation.
 *
 * What replaced them is enforced in code and stated identically on the
 * marketing site's security page, so the two properties cannot drift apart.
 */
const trustBadges = [
  { icon: Shield, text: 'Tenant isolation, test-enforced' }, // SEC-01, SEC-02
  { icon: Zap, text: 'Two-factor auth, enforceable per org' }, // SEC-03
  { icon: Shield, text: 'Consent-gated monitoring' }, // CON-01
];

export default function Hero() {
  const { scrollYProgress } = useScroll();
  const dashboardY = useTransform(scrollYProgress, [0, 0.3], [0, -40]);
  const dashboardRotate = useTransform(scrollYProgress, [0, 0.3], [-2, 0]);

  /*
   * Mouse-tilt parallax on the dashboard mock (±4°).
   *
   * Springs rather than raw pointer values: a mock that tracks the cursor
   * exactly reads as a bug, because real objects have inertia. Inert on touch —
   * `pointermove` only fires mid-gesture there, and there is no touch
   * equivalent worth inventing.
   */
  const reducedMotion = usePrefersReducedMotion();
  const tiltX = useMotionValue(0);
  const tiltY = useMotionValue(0);
  const tiltSpring = { stiffness: 150, damping: 20, mass: 0.6 };
  const tiltRotateX = useSpring(useTransform(tiltY, [-0.5, 0.5], [4, -4]), tiltSpring);
  const tiltRotateY = useSpring(useTransform(tiltX, [-0.5, 0.5], [-4, 4]), tiltSpring);
  const combinedRotateY = useTransform(
    [dashboardRotate, tiltRotateY] as const,
    ([scroll, tilt]: number[]) => (reducedMotion ? 0 : scroll + tilt)
  );
  const blurY1 = useTransform(scrollYProgress, [0, 0.3], [0, -60]);
  const blurY2 = useTransform(scrollYProgress, [0, 0.3], [0, -25]);
  const textY = useTransform(scrollYProgress, [0, 0.3], [0, 20]);

  return (
    <section className="relative overflow-hidden bg-white px-4 pb-10 pt-8 sm:px-6 sm:pb-14 sm:pt-10 lg:px-8 lg:pb-20 lg:pt-12">
      {/* Floating gradient orbs */}
      <GradientOrb color="rgba(93, 150, 157, 0.08)" size={600} className="-top-40 -left-40" speed={0.08} blur={100} />
      <GradientOrb color="rgba(227, 168, 66, 0.05)" size={500} className="-bottom-20 -right-20" speed={0.06} blur={80} />
      <GradientOrb color="rgba(93, 150, 157, 0.06)" size={350} className="top-1/2 left-1/3" speed={0.12} blur={90} />

      <div className="relative mx-auto max-w-7xl">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          {/* Left: Text content */}
          <motion.div variants={staggerContainer} initial="hidden" animate="visible" style={{ y: textY }}>
            <motion.div variants={fadeSlideUp} className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              All-in-one workforce platform
            </motion.div>

            <motion.h1 variants={fadeSlideUp} className="mt-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl lg:text-[3.5rem] lg:leading-[1.1]">
              Know exactly what your{' '}
              <WordRise text="team is working on" className="text-blue-600" delay={0.25} />
            </motion.h1>

            <motion.p variants={fadeSlideUp} className="mt-5 max-w-xl text-base leading-7 text-slate-500">
              Time tracking, employee monitoring, attendance, payroll, and HR operations — all in one platform that works on web and desktop.
            </motion.p>

            <motion.div variants={fadeSlideUp} className="mt-8 flex flex-col gap-3 sm:flex-row">
              <MagneticButton>
                <Link
                  to="/start-trial"
                  onClick={() => { analytics.trackEvent('landing_cta_clicked', { location: 'hero', action: 'start-trial' }); analytics.trackEvent('start_trial_clicked', { location: 'hero' }); }}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-blue-700 hover:shadow-lg sm:w-auto"
                >
                  Start Free Trial
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </MagneticButton>
              <MagneticButton>
                <Link
                  to="/contact-sales"
                  onClick={() => { analytics.trackEvent('landing_cta_clicked', { location: 'hero', action: 'book-demo' }); analytics.trackEvent('book_demo_clicked', { location: 'hero' }); }}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 hover:shadow-md sm:w-auto"
                >
                  Book Demo
                </Link>
              </MagneticButton>
              <MagneticButton>
                <a
                  href={desktopDownloadUrl}
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 hover:shadow-md sm:w-auto"
                >
                  <Download className="h-4 w-4" />
                  Desktop App
                </a>
              </MagneticButton>
            </motion.div>

            {/* Stats row */}
            <motion.div variants={fadeSlideUp} className="mt-10 grid gap-3 sm:grid-cols-3">
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                      <stat.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-lg font-bold text-slate-900">
                        <AnimatedCounter target={stat.value} suffix={stat.suffix} />
                      </p>
                      <p className="text-xs text-slate-500">{stat.label}</p>
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>

            {/* Trust badges */}
            <motion.div variants={fadeSlideUp} className="mt-6 flex flex-wrap items-center gap-4 text-xs text-slate-500">
              {trustBadges.map((badge) => (
                <span key={badge.text} className="inline-flex items-center gap-1.5">
                  <badge.icon className="h-3.5 w-3.5" />
                  {badge.text}
                </span>
              ))}
            </motion.div>
          </motion.div>

          {/* Right: Dashboard card with 3D perspective */}
          <motion.div
            initial={{ opacity: 0, x: 50, rotateY: -12, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, rotateY: 0, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2, ease: easeOut }}
            className="relative"
            style={{ perspective: '1200px' }}
            onPointerMove={(e) => {
              // Coarse pointers report movement only mid-gesture; tilting the
              // hero because somebody started a scroll is not an interaction.
              if (e.pointerType !== 'mouse') return;
              const r = e.currentTarget.getBoundingClientRect();
              tiltX.set((e.clientX - r.left) / r.width - 0.5);
              tiltY.set((e.clientY - r.top) / r.height - 0.5);
            }}
            onPointerLeave={() => {
              tiltX.set(0);
              tiltY.set(0);
            }}
          >
            {/*
              Two rotations are combined here on purpose. `dashboardRotate` is
              the scroll-linked settle that was already present; `tiltRotateY`
              is the pointer parallax. They are summed into one motion value
              rather than applied to nested elements, because two transforms
              fighting over the same property is how a tilt starts to jitter.
            */}
            <motion.div
              style={{
                y: dashboardY,
                rotateX: tiltRotateX,
                rotateY: combinedRotateY,
                transformStyle: 'preserve-3d',
              }}
              className="rounded-xl border border-slate-200 bg-white shadow-xl"
            >
              <div className="border-b border-slate-100 px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    </div>
                    <span className="ml-3 text-xs font-medium text-slate-500">Live Dashboard</span>
                  </div>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Synced</span>
                </div>
              </div>
              <div className="p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-slate-500">Working ratio</p>
                        <p className="mt-1 text-2xl font-bold text-slate-900">87%</p>
                      </div>
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                        <BarChart3 className="h-5 w-5" />
                      </div>
                    </div>
                    <div className="mt-4 flex h-20 items-end gap-2">
                      {[48, 62, 55, 84, 76, 92, 88].map((h) => (
                        <div
                          key={h}
                          className="animate-bar-grow flex-1 rounded-t bg-blue-500"
                          style={{ '--bar-height': `${h}%`, animationDelay: `${0.3 + h * 0.005}s` } as React.CSSProperties}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {[
                      { icon: Clock4, label: 'Tracked today', value: '8h 24m' },
                      { icon: CalendarCheck, label: 'Attendance', value: '12 / 14' },
                    ].map((item) => (
                      <div key={item.label} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-medium text-slate-500">{item.label}</p>
                            <p className="mt-0.5 text-lg font-bold text-slate-900">{item.value}</p>
                          </div>
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                            <item.icon className="h-4 w-4" />
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                      <p className="text-xs font-medium text-slate-500">Recent activity</p>
                      <div className="mt-3 space-y-2">
                        {[
                          ['09:10', 'Punch in'],
                          ['11:00', 'Activity log'],
                          ['14:30', 'Manager review'],
                        ].map(([time, title]) => (
                          <div key={time} className="flex items-center gap-3">
                            <span className="w-10 text-[11px] font-medium text-slate-500">{time}</span>
                            <div className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                            <span className="text-xs text-slate-600">{title}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
            {/* Decorative blurs */}
            <motion.div style={{ y: blurY1 }} className="absolute -bottom-3 -right-3 -z-10 h-48 w-48 rounded-full bg-blue-100/50 blur-2xl" />
            <motion.div style={{ y: blurY2 }} className="absolute -left-4 -top-4 -z-10 h-32 w-32 rounded-full bg-blue-50 blur-xl" />
          </motion.div>
        </div>
      </div>

      {/* Trust logos marquee */}
      <div className="mx-auto mt-10 max-w-7xl">
        {/*
          THIS WAS A LOGO WALL OF COMPANIES THAT DO NOT EXIST — Acme Corp,
          TechFlow, GlobalSync and five more, under the words "Trusted by
          forward-thinking teams". Placeholder logos left in a template are one
          thing; shipped to production on a payroll product they are a claim to
          customers we do not have, and the kind a prospect checks.

          There is no logo wall to put here yet, and the honest substitute is
          scope rather than borrowed credibility: the modules that actually
          ship. When there are customers willing to be named, they replace this
          — with a date.
        */}
        <p className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          One system, ten modules
        </p>
        <Marquee speed={40} className="opacity-60">
          {[
            'Evidence of work',
            'Attendance, shifts & rostering',
            'Leave',
            'Payroll',
            'Statutory & filings',
            'Money movement & finance',
            'Hiring',
            'Core HR',
            'Reports & controls',
            'Platform & security',
          ].map((name) => (
            <div key={name} className="flex items-center gap-2 px-8">
              <div className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              <span className="text-sm font-semibold whitespace-nowrap text-slate-500">{name}</span>
            </div>
          ))}
        </Marquee>
      </div>
    </section>
  );
}

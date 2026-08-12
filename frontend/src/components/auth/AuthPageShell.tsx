import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import BrandLogo from '@/components/branding/BrandLogo';
import AuthPageFooter from '@/components/auth/AuthPageFooter';
import {
  buttonPrimaryClass,
  fieldIconClass,
  fieldInputClass,
  fieldInputWithIconClass,
  fieldLabelClass,
} from '@/components/ui/controlClasses';

/**
 * The layout every signed-out page shares: sign in, accept invite, verify
 * email, forgot/reset password, owner signup, Google completion.
 *
 * These pages used to each own their chrome. Sign in was a flat white canvas
 * with a two-column split; the rest were glass panels on a tinted canvas with
 * blur orbs. An invited joiner therefore met two different-looking products in
 * the space of one click — and the glass variants hardcoded a light overlay
 * under theme-aware text, so their body copy was unreadable in dark mode.
 *
 * Anything visual belongs here rather than in a page, so the set cannot drift
 * apart again.
 */

export interface AuthShowcaseFeature {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}

interface AuthPageShellProps {
  /** Where the back arrow goes. Omit to hide it entirely. */
  backTo?: string | null;
  backLabel?: string;
  heading: string;
  intro?: ReactNode;
  /** Small line under the intro, e.g. "New here? Start your workspace". */
  introAside?: ReactNode;
  /** The form, plus any alerts above it. */
  children: ReactNode;
  /** Sits between the form and the legal footer, e.g. the tracker download. */
  belowForm?: ReactNode;
  showcaseHeading: string;
  showcaseIntro?: ReactNode;
  features?: AuthShowcaseFeature[];
  /** Extra block under the feature grid. */
  showcaseBelow?: ReactNode;
}

/*
 * Re-exported under auth-flavoured names because every signed-out page already
 * imports them from here. The definitions live in ui/controlClasses so public
 * surfaces that are not auth pages — the cookie banner, for one — can use the
 * same set without importing from this component.
 */
export const authLabelClass = fieldLabelClass;
export const authInputClass = fieldInputClass;
export const authInputWithIconClass = fieldInputWithIconClass;
export const authIconClass = fieldIconClass;

/** The auth forms all run their primary action full width. */
export const authPrimaryButtonClass = `${buttonPrimaryClass} w-full`;

export default function AuthPageShell({
  backTo = '/',
  backLabel = 'Back to home',
  heading,
  intro,
  introAside,
  children,
  belowForm,
  showcaseHeading,
  showcaseIntro,
  features = [],
  showcaseBelow,
}: AuthPageShellProps) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-white text-slate-900">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(148,163,184,0.15) 1px, transparent 0)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1400px] flex-col lg:flex-row">
        <section className="order-1 flex w-full items-center justify-center px-4 py-12 sm:px-6 lg:w-[45%] lg:px-12">
          <div className="w-full max-w-md">
            {backTo ? (
              <Link
                to={backTo}
                className="mb-8 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition duration-200 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                aria-label={backLabel}
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
            ) : null}

            <div className="mb-8">
              <BrandLogo variant="full" size="sm" className="mb-6 block max-w-[14rem]" />
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                {heading}
              </h1>
              {intro ? <p className="mt-3 text-[15px] leading-7 text-slate-500">{intro}</p> : null}
              {introAside ? <p className="mt-2 text-sm text-slate-500">{introAside}</p> : null}
            </div>

            {children}

            {belowForm}

            <AuthPageFooter />
          </div>
        </section>

        <section className="order-2 hidden w-full lg:flex lg:w-[55%] lg:items-center lg:justify-center lg:px-12 lg:py-12">
          <div className="w-full max-w-xl">
            <h2 className="text-4xl font-semibold leading-tight tracking-tight text-slate-900 lg:text-5xl">
              {showcaseHeading}
            </h2>
            {showcaseIntro ? (
              <p className="mt-4 text-base leading-7 text-slate-500">{showcaseIntro}</p>
            ) : null}

            {features.length > 0 ? (
              <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                {features.map((feature) => {
                  const Icon = feature.icon;

                  return (
                    <li
                      key={feature.title}
                      className="rounded-lg border border-slate-200 bg-white p-5 transition-all duration-200 hover:border-slate-300 hover:shadow-md"
                    >
                      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                        <Icon className="h-4 w-4" />
                      </div>
                      <p className="text-sm font-semibold text-slate-900">{feature.title}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{feature.description}</p>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {showcaseBelow}
          </div>
        </section>
      </div>
    </main>
  );
}

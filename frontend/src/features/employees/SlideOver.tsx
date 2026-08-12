/**
 * Moved to components/ui/dialog/SlideOver so it shares one behaviour hook with
 * Modal. Re-exported here because 12 call sites import this path; new code
 * should import from '@/components/ui/dialog'.
 */
export { default } from '@/components/ui/dialog/SlideOver';
export type { SlideOverProps } from '@/components/ui/dialog/SlideOver';

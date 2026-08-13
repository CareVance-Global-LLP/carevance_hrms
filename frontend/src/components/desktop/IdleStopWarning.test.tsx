import { render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import IdleStopWarning from './IdleStopWarning';
import {
  DESKTOP_TIMER_IDLE_WARNING_EVENT,
  type DesktopTimerIdleWarningDetail,
} from '@/lib/desktopTimerSession';

const emit = (detail: DesktopTimerIdleWarningDetail) => {
  act(() => {
    window.dispatchEvent(
      new CustomEvent<DesktopTimerIdleWarningDetail>(DESKTOP_TIMER_IDLE_WARNING_EVENT, { detail })
    );
  });
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('IdleStopWarning', () => {
  it('shows nothing until a warning arrives', () => {
    render(<IdleStopWarning />);

    expect(document.querySelector('[data-idle-stop-warning]')).toBeNull();
  });

  it('counts down as the tracker reports each second', () => {
    render(<IdleStopWarning />);

    emit({ secondsRemaining: 60, idleSeconds: 840 });
    expect(screen.getByText('Your timer stops in 60 seconds')).toBeInTheDocument();

    // The countdown has to move. A notice frozen on the value it opened with
    // reads as a bug precisely when someone is watching it.
    emit({ secondsRemaining: 42, idleSeconds: 858 });
    expect(screen.getByText('Your timer stops in 42 seconds')).toBeInTheDocument();
    expect(screen.queryByText('Your timer stops in 60 seconds')).toBeNull();
  });

  it('says second, not seconds, at one', () => {
    render(<IdleStopWarning />);

    emit({ secondsRemaining: 1, idleSeconds: 899 });

    expect(screen.getByText('Your timer stops in 1 second')).toBeInTheDocument();
  });

  it('stops promising a countdown once the stop is happening', () => {
    render(<IdleStopWarning />);

    emit({ secondsRemaining: 0, idleSeconds: 900 });

    expect(screen.getByText('Stopping your timer…')).toBeInTheDocument();
  });

  it('clears itself when the person comes back', () => {
    render(<IdleStopWarning />);
    emit({ secondsRemaining: 30, idleSeconds: 870 });
    expect(document.querySelector('[data-idle-stop-warning]')).not.toBeNull();

    // The tracker emits null once input resumes.
    emit({ secondsRemaining: null, idleSeconds: 0 });

    expect(document.querySelector('[data-idle-stop-warning]')).toBeNull();
  });

  it('does not trap the screen the way the return prompt does', () => {
    render(<IdleStopWarning />);
    emit({ secondsRemaining: 30, idleSeconds: 870 });

    /*
     * This is information, not a question. Someone may be mid-call with the
     * right response being to ignore it, so it must not be modal and must not
     * interrupt a screen reader.
     */
    const panel = document.querySelector('[data-idle-stop-warning]');
    expect(panel?.getAttribute('role')).toBe('status');
    expect(panel?.getAttribute('aria-live')).toBe('polite');
    expect(panel?.getAttribute('aria-modal')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('offers a button that works by being clicked, not by handling the click', () => {
    render(<IdleStopWarning />);
    emit({ secondsRemaining: 30, idleSeconds: 870 });

    /*
     * The OS idle timer is the source of truth and the click itself is the
     * input that resets it, so the button deliberately has no onClick. If one
     * is ever added, it becomes a second mechanism that can disagree with the
     * tracker about whether someone is idle.
     */
    const button = screen.getByRole('button', { name: /still working/i });
    expect(button).toBeInTheDocument();
    expect(button.onclick).toBeNull();
  });
});

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Navbar from '@/components/landing/Navbar';
import { ThemeProvider, THEME_STORAGE_KEY } from '@/contexts/ThemeContext';

const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
} as const;

const renderNavbar = () =>
  render(
    <ThemeProvider>
      <MemoryRouter future={routerFuture}>
        <Navbar />
      </MemoryRouter>
    </ThemeProvider>
  );

describe('landing Navbar theming', () => {
  beforeEach(() => {
    localStorage.removeItem(THEME_STORAGE_KEY);
    document.documentElement.removeAttribute('data-theme');
  });

  /*
   * The glass pill used to carry `backgroundColor: rgba(255,255,255,…)` as an
   * inline style. theme.css remaps the *class* `bg-white` in dark mode and can
   * never reach an inline style, so the bar stayed white while the token layer
   * flipped its `text-slate-600` labels to a light colour — light text on a
   * light pill.
   */
  it('paints the glass pill from surface tokens, not a hardcoded white', () => {
    renderNavbar();

    const panel = screen.getByTestId('landing-nav-panel');

    expect(panel.getAttribute('style') ?? '').not.toMatch(/255,\s*255,\s*255/);
    expect(panel.className).toContain('bg-surface-card');
  });

  it('lifts the pill on scroll without leaving the token layer', () => {
    renderNavbar();

    const panel = screen.getByTestId('landing-nav-panel');

    // Both the resting and lifted shadows must resolve through a variable so
    // dark mode can pick its own alphas.
    expect(panel.className).toMatch(/shadow-\[var\(--glass-shadow/);
  });

  it('offers a theme control that switches the page to dark', async () => {
    const user = userEvent.setup();
    renderNavbar();

    const [toggle] = screen.getAllByRole('button', { name: /change theme/i });
    await user.click(toggle);
    await user.click(screen.getByRole('menuitemradio', { name: /Dark/ }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('offers the same theme control inside the mobile menu', async () => {
    const user = userEvent.setup();
    renderNavbar();

    expect(screen.getAllByRole('button', { name: /change theme/i })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /toggle navigation/i }));

    expect(screen.getAllByRole('button', { name: /change theme/i })).toHaveLength(2);
  });

  it('switches back to light from the control', async () => {
    const user = userEvent.setup();
    renderNavbar();

    const [toggle] = screen.getAllByRole('button', { name: /change theme/i });
    await user.click(toggle);
    await user.click(screen.getByRole('menuitemradio', { name: /Dark/ }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    await user.click(screen.getAllByRole('button', { name: /change theme/i })[0]);
    await user.click(screen.getByRole('menuitemradio', { name: /Light/ }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

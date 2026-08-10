/**
 * Lets a command-bar action open a form on the page it navigates to.
 *
 * "Apply for leave" navigates to `/leave?compose=leave-request`; the leave page
 * calls `useComposeAction(COMPOSE_KEYS.leaveRequest, openDrawer)` and the form
 * is open by the time the page paints. The parameter is stripped straight
 * afterwards so a refresh, a back-navigation or a copied URL doesn't reopen it.
 *
 * One line per page, and a page that never opts in simply lands normally
 * instead of erroring — which is why the action is still useful before every
 * page supports it.
 */

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { COMPOSE_PARAM } from '@/lib/commandRegistry';

export function useComposeAction(key: string, open: () => void): void {
  const location = useLocation();
  const navigate = useNavigate();
  // `open` is nearly always an inline arrow function; keeping it in a ref stops
  // the effect re-running (and re-opening the form) on every render.
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get(COMPOSE_PARAM) !== key) return;

    params.delete(COMPOSE_PARAM);
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ''}${location.hash}`, { replace: true });

    openRef.current();
  }, [key, location.hash, location.pathname, location.search, navigate]);
}

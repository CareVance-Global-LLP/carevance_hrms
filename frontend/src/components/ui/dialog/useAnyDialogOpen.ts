import { useSyncExternalStore } from 'react';
import { openDialogCount, subscribeDialogStack } from './dialogStack';

const getSnapshot = (): boolean => openDialogCount() > 0;

/*
 * There is no stack on the server, so the snapshot is a constant false rather
 * than a call into module state that a hydration pass would then disagree with.
 */
const getServerSnapshot = (): boolean => false;

/**
 * True while any Modal or SlideOver is open.
 *
 * For ambient, always-on-top UI that must get out of the way of a modal
 * surface — see the note on subscribeDialogStack in dialogStack.ts.
 */
export function useAnyDialogOpen(): boolean {
  return useSyncExternalStore(subscribeDialogStack, getSnapshot, getServerSnapshot);
}

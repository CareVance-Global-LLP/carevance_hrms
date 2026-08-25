export enum ImpactFeedbackStyle { Light = 'light', Medium = 'medium', Heavy = 'heavy' }
export enum NotificationFeedbackType { Success = 'success', Warning = 'warning', Error = 'error' }

export const calls: string[] = [];
/** Rejects on purpose: the wrapper must swallow it, never propagate. */
export const impactAsync = async (style: ImpactFeedbackStyle) => {
  calls.push(`impact:${style}`);
  throw new Error('no taptic engine');
};
export const notificationAsync = async (type: NotificationFeedbackType) => {
  calls.push(`notify:${type}`);
  throw new Error('no taptic engine');
};

import { haptics } from '../src/lib/haptics';
import { calls } from '../tests/mocks/expo-haptics';

/**
 * Haptics are a courtesy, never a dependency.
 *
 * The mock rejects on every call — standing in for a device with no taptic
 * engine, a user who disabled them, or the web build. If any of that could
 * surface, a successful check-in would report as a failure because the phone
 * declined to buzz.
 */
describe('haptics never break the action they accompany', () => {
  beforeEach(() => { calls.length = 0; });

  it('swallows a failing driver on every channel', () => {
    expect(() => {
      haptics.tap();
      haptics.press();
      haptics.success();
      haptics.warning();
      haptics.error();
    }).not.toThrow();
  });

  it('still asks for the right feedback for each intent', () => {
    haptics.press();
    haptics.success();
    haptics.error();
    expect(calls).toEqual(['impact:medium', 'notify:success', 'notify:error']);
  });
});

import {
  deleteTrackerForActiveSwipe,
  getTrackerForActiveSwipe,
  setTrackerForActiveSwipe,
  shouldAutoGenerateForRenderType,
} from './tracker-state.js';

describe('shouldAutoGenerateForRenderType', () => {
  test('rejects first_message so opening a chat does not auto-generate a tracker', () => {
    expect(shouldAutoGenerateForRenderType('first_message')).toBe(false);
  });

  test('allows post-generation render types', () => {
    expect(shouldAutoGenerateForRenderType('normal')).toBe(true);
    expect(shouldAutoGenerateForRenderType('continue')).toBe(true);
    expect(shouldAutoGenerateForRenderType('swipe')).toBe(true);
  });
});

describe('active swipe tracker storage', () => {
  test('stores tracker per swipe and restores previous swipe tracker when swiping back', () => {
    const message: any = {
      swipe_id: 0,
      swipes: ['a', 'b'],
      swipe_info: [{ extra: {} }, { extra: {} }],
      extra: {},
    };

    setTrackerForActiveSwipe(message, { value: { scene: 'first' }, html: '<div>first</div>' });
    expect(getTrackerForActiveSwipe(message)?.value).toEqual({ scene: 'first' });

    message.swipe_id = 1;
    expect(getTrackerForActiveSwipe(message)).toBeNull();

    setTrackerForActiveSwipe(message, { value: { scene: 'second' }, html: '<div>second</div>' });
    expect(getTrackerForActiveSwipe(message)?.value).toEqual({ scene: 'second' });

    message.swipe_id = 0;
    expect(getTrackerForActiveSwipe(message)?.value).toEqual({ scene: 'first' });
  });

  test('deletes only the active swipe tracker', () => {
    const message: any = {
      swipe_id: 0,
      swipes: ['a', 'b'],
      swipe_info: [{ extra: {} }, { extra: {} }],
      extra: {},
    };

    setTrackerForActiveSwipe(message, { value: { scene: 'first' }, html: '<div>first</div>' });
    message.swipe_id = 1;
    setTrackerForActiveSwipe(message, { value: { scene: 'second' }, html: '<div>second</div>' });

    deleteTrackerForActiveSwipe(message);
    expect(getTrackerForActiveSwipe(message)).toBeNull();

    message.swipe_id = 0;
    expect(getTrackerForActiveSwipe(message)?.value).toEqual({ scene: 'first' });
  });
});

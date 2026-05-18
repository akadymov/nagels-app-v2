import { useChatTooltipStore, TOOLTIP_DURATION_MS } from '../chatTooltipStore';

describe('chatTooltipStore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useChatTooltipStore.getState().dismissAll();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('show() adds a tooltip keyed by sessionId', () => {
    useChatTooltipStore.getState().show('s1', 'hi');
    expect(useChatTooltipStore.getState().tooltips.s1).toMatchObject({ body: 'hi' });
  });

  it('tooltip auto-dismisses after TOOLTIP_DURATION_MS', () => {
    useChatTooltipStore.getState().show('s1', 'hi');
    jest.advanceTimersByTime(TOOLTIP_DURATION_MS - 1);
    expect(useChatTooltipStore.getState().tooltips.s1).toBeDefined();
    jest.advanceTimersByTime(2);
    expect(useChatTooltipStore.getState().tooltips.s1).toBeUndefined();
  });

  it('repeated show() for same sessionId replaces body and resets the timer', () => {
    useChatTooltipStore.getState().show('s1', 'first');
    jest.advanceTimersByTime(4000);
    useChatTooltipStore.getState().show('s1', 'second');
    jest.advanceTimersByTime(4000);
    expect(useChatTooltipStore.getState().tooltips.s1?.body).toBe('second');
    jest.advanceTimersByTime(1500);
    expect(useChatTooltipStore.getState().tooltips.s1).toBeUndefined();
  });

  it('different sessionIds have independent timers', () => {
    useChatTooltipStore.getState().show('s1', 'a');
    jest.advanceTimersByTime(2000);
    useChatTooltipStore.getState().show('s2', 'b');
    jest.advanceTimersByTime(3500);
    expect(useChatTooltipStore.getState().tooltips.s1).toBeUndefined();
    expect(useChatTooltipStore.getState().tooltips.s2?.body).toBe('b');
  });

  it('dismiss() removes a single entry', () => {
    useChatTooltipStore.getState().show('s1', 'hi');
    useChatTooltipStore.getState().show('s2', 'yo');
    useChatTooltipStore.getState().dismiss('s1');
    expect(useChatTooltipStore.getState().tooltips.s1).toBeUndefined();
    expect(useChatTooltipStore.getState().tooltips.s2?.body).toBe('yo');
  });

  it('dismissAll() clears every entry and timers do not fire afterwards', () => {
    useChatTooltipStore.getState().show('s1', 'a');
    useChatTooltipStore.getState().show('s2', 'b');
    useChatTooltipStore.getState().dismissAll();
    expect(useChatTooltipStore.getState().tooltips).toEqual({});
    jest.advanceTimersByTime(TOOLTIP_DURATION_MS + 100);
    expect(useChatTooltipStore.getState().tooltips).toEqual({});
  });
});

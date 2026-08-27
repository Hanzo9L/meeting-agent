import { useLayoutEffect, useRef } from "react";

export interface TurnFocusMemory {
  conversationId: string | null;
  userMessageId: string | null;
}

export const TURN_FOCUS_TOP_RESERVE_PX = 96;

export function resolveTurnFocusAction(input: {
  conversationId: string | null;
  newestUserMessageId: string | null;
  lastFocused: TurnFocusMemory;
}): {
  focusUserMessageId: string | null;
  nextFocused: TurnFocusMemory;
} {
  const conversationChanged =
    input.lastFocused.conversationId !== input.conversationId;
  const lastUserMessageId = conversationChanged
    ? null
    : input.lastFocused.userMessageId;
  const newest = input.newestUserMessageId;
  if (!newest || lastUserMessageId === newest) {
    return {
      focusUserMessageId: null,
      nextFocused: {
        conversationId: input.conversationId,
        userMessageId: newest
      }
    };
  }
  return {
    focusUserMessageId: newest,
    nextFocused: {
      conversationId: input.conversationId,
      userMessageId: newest
    }
  };
}

export function isOverflowScroller(overflowY: string): boolean {
  return overflowY === "auto" || overflowY === "scroll";
}

export function lastTurnSpacerHeight(
  scrollerClientHeight: number,
  topReservePx = TURN_FOCUS_TOP_RESERVE_PX
): number {
  return Math.max(0, scrollerClientHeight - topReservePx);
}

export function scrollTopToAlignStart(input: {
  scrollerTop: number;
  elementTop: number;
  currentScrollTop: number;
  scrollMarginTop: number;
}): number {
  return Math.max(
    0,
    input.currentScrollTop +
      (input.elementTop - input.scrollerTop) -
      input.scrollMarginTop
  );
}

export function findOverflowScroller(
  element: HTMLElement | null
): HTMLElement | null {
  let current = element?.parentElement ?? null;
  while (current) {
    if (isOverflowScroller(getComputedStyle(current).overflowY)) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

export function focusTurnStart(element: HTMLElement | null): void {
  if (!element) return;
  const scroller = findOverflowScroller(element);
  if (!scroller) return;
  const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop);
  scroller.scrollTop = scrollTopToAlignStart({
    scrollerTop: scroller.getBoundingClientRect().top,
    elementTop: element.getBoundingClientRect().top,
    currentScrollTop: scroller.scrollTop,
    scrollMarginTop: Number.isFinite(margin) ? margin : 0
  });
}

export function useNewestTurnFocus(
  conversationId: string | null,
  newestUserMessageId: string | null,
  elementFor: (userMessageId: string) => HTMLElement | null
): void {
  const lastFocused = useRef<TurnFocusMemory>({
    conversationId: null,
    userMessageId: null
  });
  useLayoutEffect(() => {
    const action = resolveTurnFocusAction({
      conversationId,
      newestUserMessageId,
      lastFocused: lastFocused.current
    });
    lastFocused.current = action.nextFocused;
    if (action.focusUserMessageId) {
      focusTurnStart(elementFor(action.focusUserMessageId));
    }
  }, [conversationId, newestUserMessageId, elementFor]);
}

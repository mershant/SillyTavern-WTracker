const EXTENSION_KEY = 'WTracker';

export interface TrackerPayload {
  value: any;
  html: string;
}

function ensureSwipeExtra(message: any) {
  if (!Array.isArray(message?.swipe_info) || typeof message?.swipe_id !== 'number') {
    message.extra = message.extra || {};
    return message.extra;
  }

  message.swipe_info[message.swipe_id] = message.swipe_info[message.swipe_id] || {};
  message.swipe_info[message.swipe_id].extra = message.swipe_info[message.swipe_id].extra || {};
  return message.swipe_info[message.swipe_id].extra;
}

function migrateLegacyTrackerIfNeeded(message: any) {
  if (!message?.extra?.[EXTENSION_KEY]) {
    return;
  }

  if (!Array.isArray(message?.swipe_info) || typeof message?.swipe_id !== 'number') {
    return;
  }

  const swipeExtra = ensureSwipeExtra(message);
  if (!swipeExtra[EXTENSION_KEY]) {
    swipeExtra[EXTENSION_KEY] = message.extra[EXTENSION_KEY];
  }
  delete message.extra[EXTENSION_KEY];
}

export function getTrackerForActiveSwipe(message: any): TrackerPayload | null {
  if (!message) return null;
  migrateLegacyTrackerIfNeeded(message);

  if (Array.isArray(message?.swipe_info) && typeof message?.swipe_id === 'number') {
    return message.swipe_info?.[message.swipe_id]?.extra?.[EXTENSION_KEY] || null;
  }

  return message.extra?.[EXTENSION_KEY] || null;
}

export function setTrackerForActiveSwipe(message: any, payload: TrackerPayload) {
  const extra = ensureSwipeExtra(message);
  extra[EXTENSION_KEY] = payload;
}

export function deleteTrackerForActiveSwipe(message: any) {
  if (!message) return;
  migrateLegacyTrackerIfNeeded(message);

  if (Array.isArray(message?.swipe_info) && typeof message?.swipe_id === 'number') {
    if (message.swipe_info?.[message.swipe_id]?.extra) {
      delete message.swipe_info[message.swipe_id].extra[EXTENSION_KEY];
    }
    return;
  }

  if (message.extra) {
    delete message.extra[EXTENSION_KEY];
  }
}

export function shouldAutoGenerateForRenderType(type?: string): boolean {
  return ['normal', 'continue', 'swipe'].includes(type || 'normal');
}

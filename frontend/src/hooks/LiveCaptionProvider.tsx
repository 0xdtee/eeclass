import { createContext, useContext, type ReactNode } from 'react';
import { useLiveCaption } from './useLiveCaption';

type Live = ReturnType<typeof useLiveCaption>;

const Ctx = createContext<Live | null>(null);

/**
 * Holds the live-caption session above the router.
 *
 * The hook owns the WebSocket and the microphone, so while it lived inside the recording page, going
 * back to the dashboard unmounted it: the socket closed, the mic stopped, and the class was left to the
 * server's detach grace period -- audio spoken in the meantime was simply not captured. Mounted here it
 * survives navigation, so stepping away from the recording page no longer interrupts the recording.
 */
export function LiveCaptionProvider({ children }: { children: ReactNode }) {
  const live = useLiveCaption();
  return <Ctx.Provider value={live}>{children}</Ctx.Provider>;
}

export function useLive(): Live {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLive 必须在 LiveCaptionProvider 内使用');
  return v;
}

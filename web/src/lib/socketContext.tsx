import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { LiveSocket, type SocketSnapshot } from './socket';

const LiveSocketContext = createContext<LiveSocket | null>(null);

const OFFLINE_SNAPSHOT: SocketSnapshot = {
  status: 'closed',
  everConnected: false,
  failures: 0,
  lastCloseCode: null,
  blocked: false,
  watching: false,
};

export function LiveSocketProvider({
  socket,
  children,
}: {
  socket?: LiveSocket;
  children: ReactNode;
}) {
  const instance = useMemo(() => socket ?? new LiveSocket(), [socket]);
  useEffect(() => {
    instance.start();
    return () => {
      instance.stop();
    };
  }, [instance]);
  return <LiveSocketContext.Provider value={instance}>{children}</LiveSocketContext.Provider>;
}

/** The shared socket, or null when rendered without a provider (pages still work by polling). */
export function useLiveSocket(): LiveSocket | null {
  return useContext(LiveSocketContext);
}

export function useSocketSnapshot(): SocketSnapshot {
  const socket = useLiveSocket();
  return useSyncExternalStore(
    socket ? socket.subscribeStatus : () => () => undefined,
    socket ? socket.getSnapshot : () => OFFLINE_SNAPSHOT,
    () => OFFLINE_SNAPSHOT,
  );
}

export function useSocketOpen(): boolean {
  return useSocketSnapshot().status === 'open';
}

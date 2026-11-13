import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRefreshResource } from "../refresh/useDataRefresh";
import { checkpointMs, clockSample, StudyClock } from "./clock";
import { StudyStore, type StudySnapshot } from "./storage";
import { studyEventWhitelist } from "./policy";

const Context = createContext<StudyStore | null>(null);
const empty: StudySnapshot = { summary: null, error: "" };
const emptySnapshot = () => empty;
const noopSubscribe = () => () => {};
export function useStudyTime() {
  const store = useContext(Context);
  const state = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.snapshot ?? emptySnapshot,
    emptySnapshot,
  );
  return { ...state, retry: store?.refresh };
}

export function StudyProvider({
  allowed,
  sceneKey,
  aiEvent,
  children,
}: {
  allowed: boolean;
  sceneKey: string;
  aiEvent: string;
  children: ReactNode;
}) {
  const ref = useRef<{
    store: StudyStore;
    clock: StudyClock;
    wake?: () => void;
  } | null>(null);
  if (!ref.current)
    ref.current = {
      store: new StudyStore(),
      clock: new StudyClock(clockSample()),
    };
  const session = ref.current;
  useRefreshResource("study", session.store.refresh);
  useEffect(() => {
    const { clock, store } = session;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const schedule = () => {
      if (
        !stopped &&
        !timer &&
        (clock.active(clockSample()) || clock.hasPending())
      )
        timer = setTimeout(
          tick,
          clock.active(clockSample())
            ? clock.nextWakeMs(clockSample())
            : checkpointMs,
        );
    };
    const tick = () => {
      timer = undefined;
      const intervals = clock.drain(clockSample());
      if (intervals.length) void store.enqueue(intervals);
      schedule();
    };
    const activity = (event: Event) => {
      // 管理菜单不续时；事件代理只接受阅读、对话和笔记区域中的真实操作。
      if (
        !event.isTrusted ||
        !(event.target instanceof Element) ||
        (!event.target.closest("[data-study-area]") &&
          !(
            event.type === "keydown" &&
            event.target === document.body &&
            document.querySelector("[data-study-area]")
          )) ||
        event.target.closest("[data-study-ignore]")
      )
        return;
      clock.activity(clockSample());
      schedule();
    };
    const hide = () => {
      clock.visibility(false, clockSample());
      if (timer) clearTimeout(timer);
      timer = undefined;
      const intervals = clock.drain(clockSample());
      if (intervals.length) void store.enqueue(intervals);
    };
    const visibility = () => {
      const visible = document.visibilityState === "visible";
      clock.visibility(visible, clockSample());
      if (!visible) {
        if (timer) clearTimeout(timer);
        timer = undefined;
        const intervals = clock.drain(clockSample());
        if (intervals.length) void store.enqueue(intervals);
      } else schedule();
    };
    session.wake = () => {
      if (!clock.active(clockSample())) {
        if (timer) clearTimeout(timer);
        timer = undefined;
        const intervals = clock.drain(clockSample());
        if (intervals.length) void store.enqueue(intervals);
      }
      schedule();
    };
    void store.start();
    visibility();
    // 高频事件只改内存，不触发保存或重绘，也不监听鼠标移动。
    const events = Object.keys(studyEventWhitelist);
    for (const event of events)
      document.addEventListener(event, activity, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", visibility);
    return () => {
      stopped = true;
      session.wake = undefined;
      if (timer) clearTimeout(timer);
      for (const event of events) document.removeEventListener(event, activity);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", visibility);
      const intervals = clock.drain(clockSample());
      if (intervals.length) void store.enqueue(intervals);
    };
  }, [session]);
  useEffect(() => {
    session.clock.configure(allowed, sceneKey, aiEvent, clockSample());
    session.wake?.();
  }, [allowed, sceneKey, aiEvent, session]);
  return <Context.Provider value={session.store}>{children}</Context.Provider>;
}

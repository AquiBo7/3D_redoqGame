// ui/uiLock.ts —— 阻塞式 2D 界面的控制器锁定协调器
// 纯逻辑，不操作 DOM；同一微任务内的“关闭旧界面 + 打开新界面”只结算一次，
// 避免对话转选项时先释放鼠标再立即锁定的闪烁。

export interface ControlPort {
  lockControls(): void;
  unlockControls(): void;
}

export interface UiLockCoordinator {
  acquire(id: string): void;
  release(id: string): void;
  releaseAll(): void;
  /** 3D 世界延迟创建后调用，补上尚未应用的锁定状态 */
  sync(): void;
  isBlocked(): boolean;
  dispose(): void;
}

export function createUiLockCoordinator(getPort: () => ControlPort | null): UiLockCoordinator {
  const blockers = new Set<string>();
  let locked = false;
  let scheduled = false;
  let disposed = false;

  function apply(): void {
    scheduled = false;
    if (disposed) return;

    const shouldLock = blockers.size > 0;
    if (shouldLock === locked) return;

    const port = getPort();
    if (!port) return;

    locked = shouldLock;
    if (shouldLock) port.lockControls();
    else port.unlockControls();
  }

  function schedule(): void {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(apply);
  }

  function sync(): void {
    scheduled = false;
    apply();
  }

  return {
    acquire(id: string): void {
      if (disposed || blockers.has(id)) return;
      blockers.add(id);
      schedule();
    },

    release(id: string): void {
      if (disposed || !blockers.delete(id)) return;
      schedule();
    },

    releaseAll(): void {
      if (disposed || blockers.size === 0) return;
      blockers.clear();
      schedule();
    },

    sync,

    isBlocked(): boolean {
      return blockers.size > 0;
    },

    dispose(): void {
      disposed = true;
      blockers.clear();
    },
  };
}

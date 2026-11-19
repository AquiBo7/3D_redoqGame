import { describe, expect, it } from 'vitest';
import { createUiLockCoordinator } from './uiLock';
import type { ControlPort } from './uiLock';

function createFakePort(): ControlPort & { lockCount: number; unlockCount: number } {
  return {
    lockCount: 0,
    unlockCount: 0,
    lockControls(): void {
      this.lockCount += 1;
    },
    unlockControls(): void {
      this.unlockCount += 1;
    },
  };
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve();
}

describe('UI 锁定协调器', () => {
  it('多个阻塞界面嵌套时只在全部关闭后解锁', async () => {
    const port = createFakePort();
    const lock = createUiLockCoordinator(() => port);

    lock.acquire('dialogue:s7');
    lock.acquire('choices:s7');
    await flushMicrotasks();

    expect(port.lockCount).toBe(1);
    expect(port.unlockCount).toBe(0);
    expect(lock.isBlocked()).toBe(true);

    lock.release('dialogue:s7');
    await flushMicrotasks();
    expect(port.unlockCount).toBe(0);

    lock.release('choices:s7');
    await flushMicrotasks();
    expect(port.unlockCount).toBe(1);
    expect(lock.isBlocked()).toBe(false);
  });

  it('同一 id 重复获取与重复释放不会产生额外调用', async () => {
    const port = createFakePort();
    const lock = createUiLockCoordinator(() => port);

    lock.acquire('phone:s2');
    lock.acquire('phone:s2');
    await flushMicrotasks();
    expect(port.lockCount).toBe(1);

    lock.release('phone:s2');
    lock.release('phone:s2');
    await flushMicrotasks();
    expect(port.unlockCount).toBe(1);
  });

  it('关闭旧界面并同步打开新界面时只结算一次，不闪烁解锁', async () => {
    const port = createFakePort();
    const lock = createUiLockCoordinator(() => port);

    lock.acquire('dialogue:s7');
    await flushMicrotasks();
    expect(port.lockCount).toBe(1);

    lock.release('dialogue:s7');
    lock.acquire('choices:s7');
    await flushMicrotasks();

    expect(port.lockCount).toBe(1);
    expect(port.unlockCount).toBe(0);
  });

  it('3D 世界延迟创建时先记录阻塞状态，sync 后补上锁定', async () => {
    let port: ControlPort | null = null;
    const lock = createUiLockCoordinator(() => port);

    lock.acquire('phone:s2');
    await flushMicrotasks();
    expect(lock.isBlocked()).toBe(true);

    const readyPort = createFakePort();
    port = readyPort;
    lock.sync();
    expect(readyPort.lockCount).toBe(1);

    lock.releaseAll();
    await flushMicrotasks();
    expect(readyPort.unlockCount).toBe(1);
  });

  it('releaseAll 清空所有阻塞并恢复控制', async () => {
    const port = createFakePort();
    const lock = createUiLockCoordinator(() => port);

    lock.acquire('phone:s2');
    lock.acquire('vibration-message:v1');
    await flushMicrotasks();
    expect(port.lockCount).toBe(1);

    lock.releaseAll();
    await flushMicrotasks();
    expect(port.unlockCount).toBe(1);
    expect(lock.isBlocked()).toBe(false);
  });
});

// 全局触控与桌面防误触保护：
// 阻止双击选中文本、长按弹出编辑/图片菜单、图片拖拽以及多指/双指手势缩放。
// 保留调试面板（.debug-panel）内的文本选择，方便复制日志。

function isInsideDebugPanel(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.debug-panel') !== null;
}

/**
 * 安装全局防选中、防拖拽、防长按菜单与防缩放监听，返回清理函数。
 */
export function installTouchGuards(target: Document | HTMLElement = document): () => void {
  const preventSelectOrContext = (event: Event): void => {
    if (isInsideDebugPanel(event.target)) return;
    event.preventDefault();
  };

  const preventAlways = (event: Event): void => {
    event.preventDefault();
  };

  const preventPinch = (event: TouchEvent): void => {
    if (event.touches.length > 1 && event.cancelable) {
      event.preventDefault();
    }
  };

  target.addEventListener('dblclick', preventAlways, { passive: false });
  target.addEventListener('contextmenu', preventSelectOrContext, { passive: false });
  target.addEventListener('selectstart', preventSelectOrContext, { passive: false });
  target.addEventListener('dragstart', preventAlways, { passive: false });
  target.addEventListener('gesturestart', preventAlways, { passive: false });
  target.addEventListener('gesturechange', preventAlways, { passive: false });
  target.addEventListener('gestureend', preventAlways, { passive: false });
  target.addEventListener('touchstart', preventPinch as EventListener, { passive: false });

  return () => {
    target.removeEventListener('dblclick', preventAlways);
    target.removeEventListener('contextmenu', preventSelectOrContext);
    target.removeEventListener('selectstart', preventSelectOrContext);
    target.removeEventListener('dragstart', preventAlways);
    target.removeEventListener('gesturestart', preventAlways);
    target.removeEventListener('gesturechange', preventAlways);
    target.removeEventListener('gestureend', preventAlways);
    target.removeEventListener('touchstart', preventPinch as EventListener);
  };
}

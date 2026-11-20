// 暗角只映射状态，不显示数值，也不反向更改剧情。
import type { EventBus } from '../core/eventBus';
import { createElement } from './uiDom';
import './vignette.css';

export function vignetteOpacity(harm: number): number {
  if (harm >= 70) return 0.78;
  if (harm >= 50) return 0.52;
  if (harm >= 30) return 0.28;
  return 0;
}

export function initVignette(container: HTMLElement, bus: EventBus): () => void {
  const layer = createElement('div', 'vignette');
  layer.setAttribute('aria-hidden', 'true');
  let opacity = 0;
  layer.style.opacity = '0';
  container.append(layer);
  const unsubscribe = bus.on('state:changed', ({ state }) => {
    const nextOpacity = vignetteOpacity(state.harm);
    // 同档更新不重建节点、不重置 transition，频繁状态广播也不会闪动。
    if (nextOpacity === opacity) return;
    opacity = nextOpacity;
    layer.style.opacity = String(opacity);
  });
  return () => {
    unsubscribe();
    layer.remove();
  };
}

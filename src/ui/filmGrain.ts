// ui/filmGrain.ts —— 程序化胶片颗粒与纸纹（零下载、零第三方授权）
// 颗粒层挂在 #app 内、canvas 之上 HUD(2) 与 .scene-fade(10) 之下：全黑过场不会透出噪点；
// 2D 开始页 / 结尾页通过 CSS 变量 --yt-grain 自行叠加。只生成一次，静态不闪烁。

const GRAIN_SIZE = 160;
const PAPER_SIZE = 256;

let installed = false;

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

/** 中性灰噪点：明暗随机、透明度随机，平铺后无明显接缝 */
function createGrainUrl(): string | null {
  const surface = makeCanvas(GRAIN_SIZE);
  if (!surface) return null;
  const image = surface.ctx.createImageData(GRAIN_SIZE, GRAIN_SIZE);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const value = Math.random() < 0.5 ? 0 : 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = Math.floor(Math.random() * 70);
  }
  surface.ctx.putImageData(image, 0, 0);
  return surface.canvas.toDataURL('image/png');
}

/** 纸纹：暖白底上叠细纤维与低频斑驳（降级模式卡片使用） */
function createPaperUrl(): string | null {
  const surface = makeCanvas(PAPER_SIZE);
  if (!surface) return null;
  const { ctx } = surface;
  ctx.fillStyle = '#f4efe4';
  ctx.fillRect(0, 0, PAPER_SIZE, PAPER_SIZE);

  for (let i = 0; i < 26; i += 1) {
    const x = Math.random() * PAPER_SIZE;
    const y = Math.random() * PAPER_SIZE;
    const r = 30 + Math.random() * 70;
    // 在 9 个平铺位置重复绘制，保证无缝
    for (const ox of [-PAPER_SIZE, 0, PAPER_SIZE]) {
      for (const oy of [-PAPER_SIZE, 0, PAPER_SIZE]) {
        const gradient = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        const tone = Math.random() < 0.5 ? '120, 104, 78' : '255, 255, 255';
        gradient.addColorStop(0, `rgba(${tone}, 0.045)`);
        gradient.addColorStop(1, `rgba(${tone}, 0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, PAPER_SIZE, PAPER_SIZE);
      }
    }
  }

  ctx.lineWidth = 0.6;
  for (let i = 0; i < 220; i += 1) {
    const x = Math.random() * PAPER_SIZE;
    const y = Math.random() * PAPER_SIZE;
    const length = 3 + Math.random() * 9;
    const angle = Math.random() * Math.PI;
    ctx.strokeStyle = `rgba(110, 96, 72, ${0.05 + Math.random() * 0.07})`;
    // 纤维同样按 9 个平铺位置绘制，跨边界的线条在相邻tile中连续
    for (const ox of [-PAPER_SIZE, 0, PAPER_SIZE]) {
      for (const oy of [-PAPER_SIZE, 0, PAPER_SIZE]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + ox + Math.cos(angle) * length, y + oy + Math.sin(angle) * length);
        ctx.stroke();
      }
    }
  }
  return surface.canvas.toDataURL('image/png');
}

/** 安装颗粒层与纸纹变量；重复调用无副作用 */
export function installFilmGrain(): void {
  if (installed) return;
  installed = true;

  const root = document.documentElement;
  const grain = createGrainUrl();
  const paper = createPaperUrl();
  if (grain) root.style.setProperty('--yt-grain', `url("${grain}")`);
  if (paper) root.style.setProperty('--yt-paper', `url("${paper}")`);

  const app = document.querySelector<HTMLElement>('#app');
  if (!grain || !app) return;
  const layer = document.createElement('div');
  layer.className = 'film-grain';
  layer.setAttribute('aria-hidden', 'true');
  app.prepend(layer);
}

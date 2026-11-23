// ui/liteWorldModel.ts —— 2D 降级模式的纯数据推导（无 DOM / 无 three）
// 场景舞台描写、可交互卡片与过场文案均在此维护；liteWorld 只负责渲染与事件回发。

import { chapter1 } from '../data/story';
import type { SceneId } from '../data/storySchema';

export interface LiteAction {
  kind: 'interact' | 'hotspot' | 'zone';
  id: string;
  label: string;
  hint: string;
}

export interface LiteSceneModel {
  id: SceneId;
  title: string;
  stage: string;
  actions: LiteAction[];
  /** 前往下一区域的按钮（仅等待 enterZone 的场景有） */
  onward: LiteAction | null;
}

/** 场景舞台描写：低饱和清晨氛围，全部虚构，不含真实主体 */
const SCENE_STAGE: Partial<Record<SceneId, string>> = {
  S1: '清晨的光从窗帘缝里挤进来，房间还留着昨夜收拾行李的痕迹。',
  S2: '枕头边的手机亮了一下，锁屏上排着一串未读。',
  S3: '你抓起外套跑过走廊和楼梯，脚步声在清晨的楼道里回响。',
  S4: '清晨的街道泛着灰白的光，行李箱的滚轮声从身边经过。',
  S5: '校门前的台阶上，一个男人背着穿浅黄色外套的女生，手里还提着两个大袋子。',
  S6: '校门口人来人往，迎新横幅在风里轻轻晃动。',
  S7: '迎新点快收摊了，桌前只剩一张迟到登记的表格。',
  S8: '通往 A 栋的路不短，脚步放得很慢。',
  S9: 'A 栋门口，口袋里的手机轻轻震动了一下。',
};

const ZONE_LABELS: Record<string, { label: string; hint: string }> = {
  'stairwell-corner': { label: '走到楼梯转角', hint: '那里传来轻轻的说话声' },
  'night-phone': { label: '走近夜晚的楼梯间', hint: '橙色手机壳亮了一下' },
  'platform-ayuan': { label: '走近平台上的阿远', hint: '他低头看着手机' },
  'corridor-linxia': { label: '在走廊与林夏见面', hint: '夕阳落在教室外' },
  'canteen-whisper-1': { label: '经过靠窗的餐桌', hint: '几个人正在看手机' },
  'canteen-whisper-2': { label: '走过中间的队伍', hint: '低语声停了一下' },
  'canteen-whisper-3': { label: '走近取餐窗口', hint: '前面的人抬起头' },
  stairs: { label: '沿街道向前走', hint: '校门就在街道尽头' },
  'school-gate': { label: '穿过校门', hint: '台阶上的人群就在前面' },
  'building-entrance': { label: '走到 A 栋楼下', hint: '陪林夏走完这段路' },
};

const INTERACT_LABELS: Record<string, { label: string; hint: string }> = {
  'window-three': { label: '在三号窗口打饭', hint: '端起餐盘' },
  phone: { label: '拿起枕边手机', hint: '看看几点了' },
  'culture-shirt': { label: '带上文化衫', hint: '衣柜里的新生文化衫' },
  'document-bag': { label: '拿上证件袋', hint: '桌上的证件袋' },
  'medicine-bag': { label: '看看掉在地上的药袋', hint: '林夏掏学生证时掉出来的' },
  'help-passerby': { label: '走过去帮忙扶起自行车', hint: '路边有人摔了自行车，周围都在拍' },
};

const HOTSPOT_LABELS: Record<string, { label: string; hint: string }> = {
  window: { label: '看向窗外', hint: '窗帘缝里透进来的光' },
  'culture-shirt': { label: '看看衣柜里的文化衫', hint: '还没拆封的新生文化衫' },
  suitcase: { label: '看看门边的行李箱', hint: '昨晚回来就没再打开' },
  'convenience-scroller': { label: '看看便利店门口刷手机的路人', hint: '他手指随手一划点了转发' },
  'father-suitcase': { label: '看看路边拎箱子的父子', hint: '爸爸还是帮孩子提着行李箱' },
  'fallen-bicycle': { label: '看看路边摔倒的自行车', hint: '四五个人举着手机，没人上前' },
  'father-bags': { label: '看看爸爸手里的袋子', hint: '两个大袋子垂在身侧' },
  'handoff-moment': { label: '留意他放下她的那一刻', hint: '他把袋子换到了另一只手' },
  typer: { label: '看看台阶旁低头打字的男生', hint: '手机屏幕的光映在脸上' },
  'reason-form': { label: '看看登记表的原因栏', hint: '有一行字被划掉了' },
  'look-back-father': { label: '回头看爸爸', hint: '校门口那个提袋子的身影' },
  'phone-behind': { label: '看看路边拍风景的同学', hint: '举起的手机晃过林荫道' },
};

const CUTSCENE_TEXT: Record<string, { title: string; text: string }> = {
  'platform-approach': {
    title: '侧楼梯平台',
    text: '夕阳落在栏杆上。你慢慢走近，阿远抬起头，橙色手机壳在掌心转了一下。',
  },
  's1-wake': {
    title: '醒来',
    text: '闹钟响了三声，被按掉。窗帘缝里透进清晨的光，楼下传来行李箱滚轮的声音。',
  },
  's3-run': {
    title: '出门',
    text: '你抓起外套跑过走廊和楼梯，脚步声在清晨的楼道里回响。',
  },
  'school-gate-panorama': {
    title: '校门口',
    text: '迎新横幅在风里轻轻晃。有人拖着行李，有人合影，人群里也有人举着手机。',
  },
};

function pickLabel(
  map: Record<string, { label: string; hint: string }>,
  id: string,
  fallbackPrefix: string,
): { label: string; hint: string } {
  return map[id] ?? { label: `${fallbackPrefix}${id}`, hint: '轻点看看' };
}

/** 根据剧本数据推导当前场景的降级卡片内容（等待目标 / 交互点 / 观察点） */
export function buildLiteSceneModel(sceneId: SceneId): LiteSceneModel {
  const scene = chapter1.scenes[sceneId];
  if (!scene) throw new Error(`未配置降级场景 ${sceneId}`);
  const actions: LiteAction[] = [];
  const seen = new Set<string>();
  let onward: LiteAction | null = null;

  const pushAction = (action: LiteAction): void => {
    const key = `${action.kind}:${action.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    actions.push(action);
  };

  for (const step of scene.steps) {
    if (step.kind !== 'wait') continue;
    if ('zoneId' in step.waitFor) {
      const zoneId = step.waitFor.zoneId;
      const info = pickLabel(ZONE_LABELS, zoneId, '前往 ');
      onward = { kind: 'zone', id: zoneId, label: info.label, hint: info.hint };
      continue;
    }
    const interactId = step.waitFor.interactId;
    const info = pickLabel(INTERACT_LABELS, interactId, '操作 ');
    pushAction({ kind: 'interact', id: interactId, label: info.label, hint: info.hint });
  }

  for (const trigger of scene.triggers ?? []) {
    if (trigger.event === 'scene:enterZone' && trigger.target) {
      const info = pickLabel(ZONE_LABELS, trigger.target, '走近 ');
      pushAction({ kind: 'zone', id: trigger.target, label: info.label, hint: info.hint });
    }
    if (trigger.event === 'scene:interact' && trigger.target) {
      const info = pickLabel(INTERACT_LABELS, trigger.target, '操作 ');
      pushAction({ kind: 'interact', id: trigger.target, label: info.label, hint: info.hint });
      continue;
    }
    if (trigger.event === 'scene:gazeHotspot' && trigger.target) {
      const info = pickLabel(HOTSPOT_LABELS, trigger.target, '看看 ');
      pushAction({ kind: 'hotspot', id: trigger.target, label: info.label, hint: info.hint });
    }
  }

  return {
    id: sceneId,
    title: scene.title,
    stage: SCENE_STAGE[sceneId] ?? scene.stageNotes?.join(' ') ?? scene.title,
    actions,
    onward,
  };
}

/** 过场文案：未知 key 使用温和通用的清晨校园描写 */
export function getLiteCutscene(key: string): { title: string; text: string } {
  return CUTSCENE_TEXT[key] ?? {
    title: '过场',
    text: '清晨的校园在眼前慢慢展开，脚步声和远处的人声混在一起。',
  };
}
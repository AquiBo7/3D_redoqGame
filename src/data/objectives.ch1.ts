import type { SceneId } from './storySchema';

export const chapter1Objectives: Partial<Record<SceneId, { text: string; hint: string; goal: string }>> = {
  S1: { text: '闹钟响个不停……先去床头看一眼手机吧。', hint: '走近床头手机，按 E 或点击查看', goal: '看一眼床头手机' },
  S3: { text: '8:47 了……拿上证件袋和文化衫，我要出门了，要迟到了！', hint: '可先拿桌上证件袋与椅背文化衫，或直接出发', goal: '拿好东西，出发' },
  S4: { text: '顺着这条街一直往前走，得赶快到校门口。', hint: '沿街道向前走往校门（手机震动可按 E 查看）', goal: '沿街前往校门' },
  S5: { text: '他们进校门了……我也踏上台阶进去吧。', hint: '走上校门台阶进入校园（向左转头可留意旁边的男生）', goal: '踏上校门台阶' },
  S7: { text: '先看看登记桌上的表格，再帮她把地上的药袋捡起来吧。', hint: '注视登记表，对准桌旁药袋按 E 或点击拾取', goal: '看看登记表与药袋' },
  S8: { text: '陪她一起沿着林荫道走到前面的 A 栋教学楼吧。', hint: '随林夏前行至 A 栋入口（也可回头望一眼校门口的父亲）', goal: '陪林夏走到 A 栋' },
};

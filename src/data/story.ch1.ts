// data/story.ch1.ts —— 第一章《到校段》完整剧本数据
// 纯数据：台词、选项、观察点、手机界面、跳转全部在此维护；状态推进由 core/sceneMachine 负责。

import type { ChapterStory, PhonePanel } from './storySchema';
import { PHOTO_HOTSPOT } from './assetManifest';

const phonePanel: PhonePanel = {
  id: 's2-phone',
  lockTime: '8:40',
  closeActionId: 'close',
  sections: [
    {
      kind: 'alarm',
      id: 'alarm',
      label: '报到！！别睡过头',
      dismissed: true,
    },
    {
      kind: 'chat',
      id: 'group',
      title: '迎新群',
      unread: 3,
      messages: [
        {
          id: 'group-1',
          from: '学姐',
          text: '@所有人 新生报到 9:00 截止，请抓紧～迟到的同学直接到 A 栋一楼迟到登记处。',
          unread: true,
        },
        {
          id: 'group-2',
          from: '群友',
          text: '我到了！人好多。',
          unread: true,
        },
        {
          id: 'group-3',
          from: '群友',
          text: '有人知道宿舍怎么走吗？',
          unread: true,
        },
      ],
    },
    {
      kind: 'memo',
      id: 'memo',
      title: '新生攻略（终）',
      updatedAt: '凌晨 3:12',
      items: [
        '不要迟到',
        '带好录取通知书和身份证',
        '拍宿舍照发给妈妈',
        '认识三个新朋友',
        '最后检查一遍行李',
      ],
    },
    {
      kind: 'chat',
      id: 'mom',
      title: '妈妈',
      unread: 2,
      messages: [
        { id: 'mom-1', from: '妈妈', time: '08:05', text: '起床了吗？记得吃早饭。' },
        { id: 'mom-2', from: '妈妈', time: '08:30', text: '报到别迟到哦。' },
      ],
      replyOptions: [
        {
          id: 'mom-reply-rise',
          text: '起了起了。',
          effects: {
            set: { momReply: '起了起了。' },
            log: { type: 'choice', summary: '回复妈妈：起了起了。' },
          },
        },
        {
          id: 'mom-reply-leaving',
          text: '马上出门。',
          effects: {
            set: { momReply: '马上出门。' },
            log: { type: 'choice', summary: '回复妈妈：马上出门。' },
          },
        },
        {
          id: 'mom-reply-none',
          text: '不回。',
          effects: {
            log: { type: 'choice', summary: '没有回复妈妈。' },
          },
        },
      ],
    },
  ],
};

export const chapter1: ChapterStory = {
  id: 'ch1',
  title: '第一章 · 到校段',
  startScene: 'S1',
  characters: {
    linxia: { name: '林夏' },
    father: { name: '林夏的爸爸' },
    volunteer: { name: '志愿者' },
    mom: { name: '妈妈' },
    xiaochen: { name: '小陈' },
    ayuan: { name: '阿远' },
    teacher: { name: '周老师' },
    admin: { name: '校园墙管理员' },
    passerby: { name: '同学' },
  },
  scenes: {
    S1: {
      id: 'S1',
      sceneKey: 'room',
      title: '起床',
      stageNotes: [
        '黑屏。闹钟响三声，被按掉；楼下传来行李箱滚轮声。',
        '睁眼：画面由模糊到清晰，眨眼两次；窗帘缝透进强光。',
        '睁眼后可以自由走动、转动视角，打开手机时暂停移动。',
      ],
      steps: [
        {
          kind: 'cutscene',
          id: 's1-wake',
          key: 's1-wake',
          durationMs: 4500,
          skippable: false,
        },
        {
          kind: 'caption',
          id: 's1-caption',
          text: '……几点了。',
          durationMs: 2400,
        },
        {
          kind: 'wait',
          id: 's1-phone-wait',
          waitFor: { interactId: 'phone' },
        },
      ],
      triggers: [
        {
          id: 's1-observe-window',
          event: 'scene:gazeHotspot',
          target: 'window',
          reveal: { text: '窗外远处有人拖着行李，往同一个方向走。' },
        },
        {
          id: 's1-observe-shirt',
          event: 'scene:gazeHotspot',
          target: 'culture-shirt',
          reveal: { text: '椅背上挂着一件新生文化衫。' },
        },
        {
          id: 's1-observe-suitcase',
          event: 'scene:gazeHotspot',
          target: 'suitcase',
          reveal: { text: '床边的行李箱还没打开。' },
        },
      ],
      transitions: [{ to: 'S2' }],
    },

    S2: {
      id: 'S2',
      sceneKey: 'room',
      title: '手机教学',
      stageNotes: ['点击枕边手机的光点后，2D 手机面板覆盖在画面上。', '锁屏时间 8:40。'],
      steps: [
        {
          kind: 'phone',
          id: 's2-phone',
          panel: phonePanel,
        },
        {
          kind: 'caption',
          id: 's2-caption',
          text: '……来不及了。',
          durationMs: 2400,
        },
      ],
      transitions: [{ to: 'S3' }],
    },

    S3: {
      id: 'S3',
      sceneKey: 'room',
      title: '出门',
      stageNotes: [
        '文化衫、桌上的证件袋有光点，点击自动带上（不是必须）。',
        '3 秒快跑过场：走廊、楼梯，晃动明显。',
      ],
      steps: [
        {
          kind: 'cutscene',
          id: 's3-run',
          key: 's3-run',
          durationMs: 3000,
          skippable: false,
        },
      ],
      triggers: [
        {
          id: 's3-take-shirt',
          event: 'scene:interact',
          target: 'culture-shirt',
          effects: {
            log: { type: 'observe', summary: '顺手带上了椅背上的文化衫。' },
          },
          reveal: { text: '你顺手把文化衫塞进了包里。' },
        },
        {
          id: 's3-take-document-bag',
          event: 'scene:interact',
          target: 'document-bag',
          effects: {
            log: { type: 'observe', summary: '拿上了桌上的证件袋。' },
          },
          reveal: { text: '你拿上了桌上的证件袋。' },
        },
      ],
      transitions: [{ to: 'S4' }],
    },

    S4: {
      id: 'S4',
      sceneKey: 'street',
      title: '街道',
      stageNotes: [
        '清晨，拖着行李的新生和家长，志愿者举着“新生报到 →”的牌子；目标光点在前方校门。',
        '路上手机最多震动 2 次，间隔不少于 20 秒；忽略一次 phoneIgnored +1。',
        '路边两位家长低声说话：“听说九点就关了。”不要刻意强调。',
        '不设倒计时，用镜头晃动和脚步声表现赶路感。',
      ],
      steps: [
        {
          kind: 'wait',
          id: 's4-wait-stairs',
          waitFor: { zoneId: 'stairs' },
        },
      ],
      triggers: [
        {
          id: 's4-vibrate-1-ignore',
          event: 'ui:phoneAction',
          target: 'street-vibration-1',
          action: 'ignore',
          effects: {
            add: { phoneIgnored: 1 },
            log: { type: 'ignore', summary: '没有看第一次手机震动。' },
          },
        },
        {
          id: 's4-vibrate-1-open',
          event: 'ui:phoneAction',
          target: 'street-vibration-1',
          action: 'open',
          effects: {
            log: { type: 'observe', summary: '看了第一次手机震动时的迎新群消息。' },
          },
        },
        {
          id: 's4-vibrate-2-ignore',
          event: 'ui:phoneAction',
          target: 'street-vibration-2',
          action: 'ignore',
          effects: {
            add: { phoneIgnored: 1 },
            log: { type: 'ignore', summary: '没有看第二次手机震动。' },
          },
        },
        {
          id: 's4-vibrate-2-open',
          event: 'ui:phoneAction',
          target: 'street-vibration-2',
          action: 'open',
          effects: {
            log: { type: 'observe', summary: '看了第二次手机震动时的迎新群消息。' },
          },
        },
      ],
      transitions: [{ to: 'S5' }],
    },

    S5: {
      id: 'S5',
      sceneKey: 'gate',
      title: '台阶一幕',
      stageNotes: [
        '15 秒演出，不强制玩家停下：男人背着穿浅黄色外套的女生，另一只手提着两个大袋子。',
        '到平地后女生轻拍男人的肩；放下后，袋子换到另一只手，男人跟在后面半步。',
        '周围有几个新生举着手机拍照，其中一人手机壳是橙色，不刻意强调。',
      ],
      steps: [
        {
          kind: 'dialogue',
          id: 's5-stairs-dialogue',
          lines: [
            {
              speaker: null,
              text: '台阶上，一个男人背着一位穿浅黄色外套的女生，另一只手提着两个大袋子，走得很慢。',
            },
            { speaker: 'linxia', text: '……放我下来。' },
            { speaker: 'father', text: '再背一段，前面还有台阶。' },
            { speaker: 'linxia', text: '……我自己能走。' },
            {
              speaker: null,
              text: '他犹豫一下，放下她，袋子换到另一只手，跟在后面半步。',
            },
          ],
        },
        {
          kind: 'wait',
          id: 's5-wait-gate',
          waitFor: { zoneId: 'school-gate' },
        },
      ],
      triggers: [
        {
          id: 's5-see-bag',
          event: 'scene:gazeHotspot',
          target: 'father-bags',
          effects: {
            set: { seenBag: true },
            log: { type: 'observe', summary: '注意到爸爸提着两个大袋子。' },
          },
        },
        {
          id: 's5-see-handoff',
          event: 'scene:gazeHotspot',
          target: 'handoff-moment',
          effects: {
            set: { seenHandoff: true },
            log: { type: 'observe', summary: '看到他把林夏放下的那一刻。' },
          },
        },
        {
          id: 's5-see-typer',
          event: 'scene:gazeHotspot',
          target: 'typer',
          effects: {
            set: { noticedTyper: true },
            log: { type: 'observe', summary: '注意到台阶旁低头打字的男生。' },
          },
        },
      ],
      transitions: [{ to: 'S6' }],
    },

    S6: {
      id: 'S6',
      sceneKey: 'gate',
      title: '开场 CG',
      stageNotes: [
        '约 5 秒，可跳过，淡入淡出。',
        '校门口全景：迎新横幅、行李箱、合影的新生；台阶上的背影、人群里举手机的人。',
        '林夏和爸爸占画面不到 10%，不画脸；构图给第二章照片裁剪留出余地。',
      ],
      steps: [
        {
          kind: 'cutscene',
          id: 's6-cg',
          key: 'school-gate-panorama',
          durationMs: 5000,
          skippable: true,
        },
      ],
      transitions: [{ to: 'S7' }],
    },

    S7: {
      id: 'S7',
      sceneKey: 'desk',
      title: '迟到登记处',
      stageNotes: [
        '迎新点快收摊，只剩一张“迟到登记”桌。',
        '药袋在 3D 中以光点呈现，对应 s7-bag 选项；爸爸站在登记处外面，不进来。',
        '表格上第一次出现她的名字“林夏”，不单独强调。',
      ],
      steps: [
        {
          kind: 'dialogue',
          id: 's7-volunteer',
          lines: [
            { speaker: 'volunteer', text: '迟到的在这边，最后两位了。' },
            { speaker: null, text: '林夏慢慢走来，有点跛。' },
          ],
        },
        {
          kind: 'choice',
          id: 's7-pen',
          prompt: '她走到登记桌前，手里没有笔。',
          options: [
            {
              id: 's7-pen-hand',
              text: '你先写吧。',
              effects: {
                set: { handedPen: true },
                add: { trust: 1 },
                log: { type: 'choice', summary: '把笔递给了林夏。' },
              },
            },
            {
              id: 's7-pen-self',
              text: '我先写。',
              effects: {
                log: { type: 'choice', summary: '自己先写了登记表。' },
              },
            },
            {
              id: 's7-pen-phone',
              text: '我先看下手机。',
              effects: {
                add: { phoneIgnored: 1 },
                log: { type: 'ignore', summary: '站到一旁看手机。' },
              },
            },
          ],
        },
        {
          kind: 'choice',
          id: 's7-reason',
          prompt: '迟到原因：',
          options: [
            {
              id: 's7-reason-late',
              text: '起晚了。',
              effects: {
                set: { reasonText: '起晚了' },
                log: { type: 'choice', summary: '登记原因：起晚了。' },
              },
            },
            {
              id: 's7-reason-delay',
              text: '路上耽搁了。',
              effects: {
                set: { reasonText: '路上耽搁了' },
                log: { type: 'choice', summary: '登记原因：路上耽搁了。' },
              },
            },
            {
              id: 's7-reason-lost',
              text: '迷路了。',
              effects: {
                set: { reasonText: '迷路了' },
                log: { type: 'choice', summary: '登记原因：迷路了。' },
              },
            },
          ],
        },
        {
          kind: 'choice',
          id: 's7-bag',
          allowMovement: true,
          prompt: '林夏掏学生证时，一只药袋掉在地上。',
          options: [
            {
              id: 's7-bag-pick',
              interactId: 'medicine-bag',
              text: '（把药袋捡起来）',
              effects: {
                set: { picked: true },
                log: { type: 'choice', summary: '捡起了药袋。' },
              },
              goto: 's7-return-bag',
            },
            {
              id: 's7-bag-leave',
              text: '（没有去捡）',
              effects: {
                log: { type: 'choice', summary: '没有捡药袋。' },
              },
              goto: 's7-linxia-picks',
            },
          ],
        },
        {
          kind: 'choice',
          id: 's7-return-bag',
          prompt: '药袋里有一张药店小票。',
          options: [
            {
              id: 's7-return-give',
              text: '给你。',
              effects: {
                add: { trust: 1 },
                log: { type: 'choice', summary: '把药袋还给林夏：给你。' },
              },
            },
            {
              id: 's7-return-dropped',
              text: '你东西掉了。',
              effects: {
                add: { trust: 1 },
                log: { type: 'choice', summary: '把药袋还给林夏：你东西掉了。' },
              },
            },
            {
              id: 's7-return-silent',
              text: '（默默放在桌上）',
              effects: {
                add: { trust: 1 },
                log: { type: 'choice', summary: '把药袋默默放在桌上。' },
              },
            },
          ],
        },
        {
          kind: 'dialogue',
          id: 's7-thanks',
          when: { key: 'picked', equals: true },
          lines: [{ speaker: 'linxia', text: '……谢谢。' }],
        },
        {
          kind: 'dialogue',
          id: 's7-linxia-picks',
          when: { key: 'picked', equals: false },
          lines: [{ speaker: null, text: '林夏自己慢慢弯下腰，捡起药袋，什么也没说。' }],
        },
      ],
      triggers: [
        {
          id: 's7-see-crossed-out',
          event: 'scene:gazeHotspot',
          target: 'reason-form',
          effects: {
            set: { seenCrossedOut: true },
            log: { type: 'observe', summary: '注意到林夏划掉了原因栏里的“脚崴了”。' },
          },
          reveal: {
            text: '原因栏里原本写着一行小字，被划掉了，改成了“路上耽搁了”。',
          },
        },
        {
          id: 's7-medicine-bag',
          event: 'scene:interact',
          target: 'medicine-bag',
          reveal: { text: '一只药袋掉在地上。' },
        },
      ],
      transitions: [{ to: 'S8' }],
    },

    S8: {
      id: 'S8',
      sceneKey: 'building',
      title: '同行',
      stageNotes: [
        '志愿者翻名单后，跟随林夏走向 A 栋；速度由林夏决定，玩家可以走在旁边或后面。',
        '回头可以看到爸爸还站在校门口，提着袋子。',
      ],
      steps: [
        {
          kind: 'dialogue',
          id: 's8-volunteer',
          lines: [{ speaker: 'volunteer', text: '你们俩一个班的吧，一起走。' }],
        },
        {
          kind: 'choice',
          id: 's8-walk',
          prompt: '（走向教学楼的路上）',
          options: [
            {
              id: 's8-walk-together',
              text: '我陪你走一段。',
              effects: { log: { type: 'choice', summary: '对林夏说：我陪你走一段。' } },
            },
            {
              id: 's8-walk-slow',
              text: '你慢慢来。',
              effects: { log: { type: 'choice', summary: '对林夏说：你慢慢来。' } },
            },
            {
              id: 's8-walk-silent',
              text: '（不说话，跟在旁边）',
              effects: { log: { type: 'choice', summary: '没有说话，跟在旁边。' } },
            },
          ],
        },
        {
          kind: 'wait',
          id: 's8-wait-building',
          waitFor: { zoneId: 'building-entrance' },
        },
      ],
      triggers: [
        {
          id: 's8-see-father',
          event: 'scene:gazeHotspot',
          target: 'look-back-father',
          effects: {
            set: { seenFatherWatching: true },
            log: { type: 'observe', summary: '回头看见爸爸站在校门口。' },
          },
          reveal: { text: '爸爸还站在校门口，提着袋子，看着这边。' },
        },
        {
          id: 's8-phone-behind', event: 'scene:gazeHotspot', target: 'phone-behind',
          effects: { set: { noticedPhoneBehind: true }, log: { type: 'observe', summary: '留意到路边举手机拍林荫道的同学。' } },
          reveal: { text: '路边有同学正举着手机拍林荫道，镜头晃过你们这边。' },
        },
      ],
      transitions: [{ to: 'S9' }],
    },

    S9: {
      id: 'S9',
      sceneKey: 'building',
      title: '群里的合照',
      stageNotes: ['到达教学楼门口，迎新群发来了开学第一天的照片合集。'],
      steps: [
        {
          kind: 'choice',
          id: 's9-choice',
          prompt: '手机在口袋里震动了一下。',
          options: [
            {
              id: 's9-look',
              text: '看一眼。',
              effects: { log: { type: 'choice', summary: '看了手机上的未读消息。' } },
              goto: 's9-phone',
            },
            {
              id: 's9-ignore',
              text: '不看。',
              effects: {
                add: { phoneIgnored: 1 },
                log: { type: 'ignore', summary: '没有看手机上的未读消息。' },
              },
              goto: 's9-end',
            },
          ],
        },
        {
          kind: 'phone',
          id: 's9-phone',
          panel: {
            id: 's9-phone',
            closeActionId: 'close',
            sections: [
              { kind: 'chat', id: 's9-group', title: '迎新群', unread: 3, messages: [
                { id: 's9-collection', from: '学姐', time: '8:50', text: '开学第一天照片合集～' },
                { id: 's9-left', from: '群友', text: '我在左边！' },
                { id: 's9-crowd', from: '群友', text: '好多人啊。' },
              ] },
              { kind: 'photo', id: 's9-photo', title: '开学第一天照片合集～', assetId: 'cg_s6_gate_panorama',
                hotspot: PHOTO_HOTSPOT, noticeActionId: 's9-notice-photo', likeActionId: 's9-like-photo' },
            ],
          },
        },
        {
          kind: 'system',
          id: 's9-end',
          effects: { log: { type: 'system', summary: '第一章 到校段结束。' } },
        },
      ],
      triggers: [
        { id: 's9-notice-photo', event: 'ui:phoneAction', target: 's9-phone', action: 'reply',
          effects: { set: { noticedPhoto: true }, log: { type: 'observe', summary: '在群合照的台阶上找到了浅黄色的小背影。' } } },
        { id: 's9-like-photo', event: 'ui:phoneAction', target: 's9-phone', action: 'reply',
          effects: { set: { likedPhoto: true }, log: { type: 'choice', summary: '给迎新群的合照点了赞。' } } },
      ],
      transitions: [{ to: 'S10' }],
    },
    S10: {
      id: 'S10', sceneKey: 'stage2d', title: '入学几天',
      stageNotes: ['入学后的日子逐渐熟悉，台阶上的事也慢慢淡出了记忆。'],
      steps: [{ kind: 'intertitle', id: 's10-days', skippable: true, lineDurationMs: 2000, lines: [
        '入学第三天，你记住了室友的名字。', '第五天，班群里有了第一个表情包梗。',
        '食堂的酸辣粉，比想象中好吃。', '走廊里偶尔遇到她，点点头，她也点点头。',
        '一切都很顺利。', '顺利得你几乎忘了，那天台阶上的事。', '直到……',
      ] }],
      transitions: [],
    },
  },
};
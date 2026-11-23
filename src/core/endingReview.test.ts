import { describe, expect, it } from 'vitest';
import { ASSET_MANIFEST } from '../data/assetManifest';
import { DRAWING_WITHDRAWN_LOG, ENDING_CONTENT, type EndingId } from '../data/endingContent';
import { createInitialStoryState, type LogEntry, type StoryState } from './state';
import { createEndingReview } from './endingReview';

function state(patch: Partial<StoryState> = {}): StoryState {
  return { ...createInitialStoryState(), ...patch };
}
function entry(sceneId: LogEntry['sceneId'], summary: string, type: LogEntry['type'] = 'choice', timestamp = 0): LogEntry {
  return { sceneId, summary, type, timestamp };
}
function footprint(input: StoryState, id: string) {
  return createEndingReview(input).footprints.find((item) => item.id === id);
}

const endings: EndingId[] = ['best', 'middle', 'worst', 'bystander', 'joined'];

describe('结局复盘纯模型', () => {
  it.each(endings)('%s 提供两段后日谈、启示、已有 CG、四草稿与五行动卡', (ending) => {
    const review = createEndingReview(state({ ending, trust: 7 }));
    expect(review.ending).toBe(ending);
    expect(review.title).toBe(ENDING_CONTENT[ending].title);
    expect(review.epilogue).toHaveLength(2);
    expect(review.epilogue.every((text) => text.length > 30)).toBe(true);
    expect(review.insight).toBe(ENDING_CONTENT[ending].insight);
    expect(ASSET_MANIFEST[review.cg.assetId]).toBeDefined();
    expect(review.cg.assetId).toMatch(/^cg_/);
    expect(review.cg.caption).not.toBe('');
    expect(review.drafts).toHaveLength(4);
    expect(review.actions).toHaveLength(5);
    expect(JSON.stringify(review)).not.toMatch(/harm|trust|yuanScore|伤害值|分数|得分/);
  });

  it.each([
    [-100, 0], [0, 0], [0.99, 0], [1, 1], [2.99, 1], [3, 2],
    [4.99, 2], [5, 3], [6.99, 3], [7, 4], [100, 4],
  ])('草稿阈值 %s 只展开 %s 条，锁定项不泄露隐藏正文', (trust, unlocked) => {
    const { drafts } = createEndingReview(state({ trust }));
    expect(drafts.filter((draft) => draft.unlocked)).toHaveLength(unlocked);
    expect(drafts.every((draft, index) => draft.unlocked === (index < unlocked))).toBe(true);
    expect(drafts[2].text).toBe(trust < 5 ? '想画给他，但……' : '想把那天早上的台阶画下来。画成完整的。');
    if (trust < 7) expect(JSON.stringify(drafts)).not.toContain('他会以为');
    expect(JSON.stringify(drafts)).not.toContain('threshold');
  });

  it.each([-8, 0, 3, 4.99])('最好结局低于送画阈值 %s 时不声称收到画', (trust) => {
    const review = createEndingReview(state({ ending: 'best', trust }));
    expect(review.title).toBe('完整的那一天');
    expect(review.epilogue[1]).toContain('合上速写本');
    expect(review.epilogue[1]).not.toMatch(/夹在笔记本|收到|送给/);
    expect(review.cg.assetId).not.toBe('cg_ending_best_drawing');
    expect(review.drafts[2]).toMatchObject({ unlocked: false, text: '想画给他，但……' });
  });

  it('最好结局恰好达到送画阈值才展示赠画版本；其他结局不借用该版本', () => {
    const review = createEndingReview(state({ ending: 'best', trust: 5 }));
    expect(review.epilogue[1]).toContain('夹在笔记本');
    expect(review.cg.assetId).toBe('cg_ending_best_drawing');
    for (const ending of endings.filter((id) => id !== 'best')) {
      expect(createEndingReview(state({ ending, trust: 100 })).cg.assetId).not.toBe('cg_ending_best_drawing');
    }
  });

  it('结局专属检查点与通用未完成章节兼容', () => {
    expect(createEndingReview(state({ ending: 'joined' })).retry?.key).toBe('ch2_canteen');
    expect(createEndingReview(state({ ending: 'bystander' })).retry?.key).toBe('ch3_morning');
    expect(createEndingReview(state({ ending: 'worst' })).retry?.key).toBe('ch4_platform');
    for (const ending of ['best', 'middle', null] as const) expect(createEndingReview(state({ ending })).retry).toBeUndefined();
    const review = createEndingReview(state());
    expect(review.ending).toBeNull();
    expect(review.epilogue[0]).toContain('没有走到结局');
    expect(review.footprints).toEqual([]);
  });

  it('只按实际观察展示台阶、合照、宿舍、食堂与帖子选择', () => {
    const input = state({ seenBag: true, noticedTyper: true, noticedPhoto: true, pointedOut: true,
      roommateReply: '这是我们班的吧。', canteenSeen: 2, postChoice: 'wait' });
    const review = createEndingReview(input);
    expect(footprint(input, 'steps')?.lines).toHaveLength(2);
    expect(JSON.stringify(review)).not.toContain('放下的瞬间');
    expect(footprint(input, 'photo')?.lines).toEqual(['你在合照的台阶上找到了浅黄色的小背影。', '本局未记录给合照点赞。']);
    expect(footprint(input, 'roommate')?.lines).toContain('你说过：“这是我们班的吧。”');
    expect(footprint(input, 'canteen')?.lines).toEqual(['你留意到了 2 处低语与目光。']);
    expect(footprint(input, 'post')?.lines).toEqual(['帖子爆发时，你选择了“等等”。']);
    expect(footprint(state({ seenHandoff: true }), 'steps')?.lines).toEqual(['你看见了爸爸把林夏放下的瞬间。']);
    expect(footprint(state({ likedPhoto: true }), 'photo')?.lines).toContain('你给群里合照点了赞。');
  });

  it.each(['explain', 'wait', 'joke'] as const)('帖子 %s 不用结局倒推选择', (postChoice) => {
    const expected = { explain: '解释', wait: '等等', joke: '玩笑' };
    expect(footprint(state({ postChoice }), 'post')?.lines[0]).toContain(expected[postChoice]);
    expect(footprint(state({ ending: 'joined' }), 'post')).toBeUndefined();
  });

  it.each(endings)('%s 本身不证明去过寻找、平台或守护', (ending) => {
    expect(createEndingReview(state({ ending })).footprints).toEqual([]);
  });

  it('参与者与旁观者提前结束不生成未到达 C5 / D 的行为', () => {
    for (const ending of ['joined', 'bystander'] as const) {
      const input = state({ ending, postChoice: ending === 'joined' ? 'joke' : 'wait',
        log: [entry('S14', '没有回复帖子，想等热度过去。'),
          ...(ending === 'bystander' ? [entry('C3', '听见楼梯间的动静，仍选择直接回班。')] : [])] });
      const ids = createEndingReview(input).footprints.map((item) => item.id);
      expect(ids).not.toContain('finding');
      expect(ids).not.toContain('platform');
      expect(ids).not.toContain('guardian');
    }
  });

  it.each(['recognize', 'relay', 'shout'] as const)('保留找人方式 %s 和客观认错次数', (foundAyuanWay) => {
    const item = footprint(state({ foundAyuanWay, wrongAsks: 2 }), 'finding');
    expect(item?.lines).toHaveLength(2);
    expect(item?.lines[1]).toBe('在走廊，你认错了 2 次人。');
    expect(item?.lines[0]).toContain({ recognize: '辨认', relay: '管理员', shout: '公开喊话' }[foundAyuanWay]);
  });

  it('平台按实际轮次保留重复倾向、提前中断与说过的原句', () => {
    const input = state({ yuanKeys: ['fact', 'fact', 'company'], phrase: '删了不够，我们去把话说清楚。' });
    expect(footprint(input, 'platform')?.lines).toEqual([
      '第 1 轮：说明事实。', '第 2 轮：说明事实。', '第 3 轮：提出陪伴。', '你说过：“删了不够，我们去把话说清楚。”',
    ]);
    expect(footprint(state({ ending: 'worst', yuanKeys: ['force'] }), 'platform')?.lines).toEqual(['第 1 轮：施压公开。']);
    expect(footprint(state({ yuanKeys: ['empathy', 'noise', 'legacy'] }), 'platform')?.lines).toEqual([
      '第 1 轮：换位询问。', '第 2 轮：淡化或不作表态。', '第 3 轮：未识别的选择。',
    ]);
  });

  it('入队不等于玩过守护；零次击退的完成记录仍可回放', () => {
    expect(footprint(state({ joined: true, route: 'team' }), 'guardian')).toBeUndefined();
    expect(footprint(state({ log: [entry('D5', '进入保护水晶。', 'system')] }), 'guardian')).toBeUndefined();
    const input = state({ joined: true, log: [entry('D5', '守在浅黄色水晶旁。')] });
    expect(footprint(input, 'guardian')?.lines).toEqual(['你击退了 0 个气泡，水晶被击中了 0 次。', '本次守护没有阿远协助。']);
    expect(footprint(state({ kills: 24, crystalHits: 3, helpedByAyuan: true }), 'guardian')?.lines).toEqual([
      '你击退了 24 个气泡，水晶被击中了 3 次。', '阿远与你并肩守护。',
    ]);
  });

  it('日志独有行为不丢失：过滤系统记录，保留重复与原始顺序，不按时间戳排序', () => {
    const input = state({ log: [entry('C5', '询问了一位无关的同学。', 'choice', 200),
      entry('C5', '请校园墙管理员转达。', 'choice', 100), entry('C5', '询问了一位无关的同学。', 'choice', 1),
      entry('S3', '带上文化衫。', 'observe'), entry('S14', '第二章结束。', 'system')] });
    const review = createEndingReview(input);
    expect(footprint(input, 'finding')?.records).toEqual(input.log.slice(0, 3).map((item) => item.summary));
    expect(footprint(input, 'arrival')?.records).toEqual(['带上文化衫。']);
    expect(JSON.stringify(review)).not.toContain('第二章结束');
  });

  it('检查点回放忠于输入快照，不残留上次结局足迹或草稿', () => {
    const checkpoint = state({ ending: 'joined', trust: 1, postChoice: 'joke', log: [entry('S14', '发了一条玩笑。')] });
    const before = createEndingReview(checkpoint);
    createEndingReview(state({ ending: 'best', trust: 9, yuanKeys: ['fact', 'empathy', 'company'],
      kills: 18, helpedByAyuan: true, log: [entry('D5', '守在浅黄色水晶旁。')] }));
    expect(createEndingReview(JSON.parse(JSON.stringify(checkpoint)) as StoryState)).toEqual(before);
    expect(before.footprints.map((item) => item.id)).toEqual(['post']);
    expect(before.drafts.filter((item) => item.unlocked)).toHaveLength(1);
  });

  it('负数存档不报错、不曝露调试量，不生成负次数或不存在的行为', () => {
    const input = state({ ending: 'best', trust: -3, harm: -80, yuanScore: -5,
      canteenSeen: -4, wrongAsks: -2, kills: -99, crystalHits: -9, stage1Tries: -7 });
    expect(() => createEndingReview(input)).not.toThrow();
    expect(createEndingReview(input).footprints).toEqual([]);
    input.log = [entry('S12', '走近食堂。'), entry('C5', '正在寻找。'), entry('D5', '守在浅黄色水晶旁。')];
    const output = JSON.stringify(createEndingReview(input));
    expect(output).not.toMatch(/-\d+\s*(?:个|次|处)|harm|trust|yuanScore|伤害|分数/);
    expect(output).toContain('击退了 0 个气泡');
    expect(createEndingReview(input).drafts.every((item) => !item.unlocked)).toBe(true);
  });

  it('防止日志和旧存档自由文本泄露调试字段，保留客观次数', () => {
    const input = state({ roommateReply: 'trust: 7', phrase: 'harm=-20',
      log: [entry('D5', '分数 99'), entry('D5', '伤害值 -2'), entry('C5', '信任值 7'),
        entry('D5', '击退了 3 个气泡。')] });
    const output = JSON.stringify(createEndingReview(input));
    expect(output).not.toMatch(/trust|harm|伤害|信任值|分数/);
    expect(output).toContain('击退了 3 个气泡');
  });

  it('投影不修改冻结输入，返回内容与输入/数据清单隔离', () => {
    const input = state({ ending: 'joined', trust: 7, yuanKeys: ['fact'], log: [entry('S14', '选择了玩笑。')] });
    Object.freeze(input.log[0]); Object.freeze(input.log); Object.freeze(input.yuanKeys); Object.freeze(input.clues); Object.freeze(input);
    const first = createEndingReview(input);
    const snapshot = JSON.stringify(first);
    first.cg.caption = '被改写'; first.drafts[0].text = '被改写'; first.actions[0].title = '被改写';
    first.nodeGuides[0].title = '被改写'; first.nodeGuides[0].perspectives[0].text = '被改写';
    first.footprints[0].records.push('被改写'); first.retry!.label = '被改写';
    expect(JSON.stringify(createEndingReview(input))).toBe(snapshot);
    expect(input.log).toHaveLength(1);
    expect(input.yuanKeys).toEqual(['fact']);
  });

  it('六个关键节点全部投影，三视角与法条文本齐全', () => {
    const { nodeGuides } = createEndingReview(state({ ending: 'middle' }));
    expect(nodeGuides.map((node) => node.id)).toEqual(['N1', 'N2', 'N3', 'N4', 'N5', 'N6']);
    for (const node of nodeGuides) {
      expect(node.experienced).toBe(false);
      expect(node.title).not.toBe('');
      expect(node.lawRef).toContain('《');
      expect(node.lawSummary).not.toBe('');
      expect(node.perspectives.map((item) => item.key)).toEqual(['victim', 'bystander', 'perpetrator']);
      for (const perspective of node.perspectives) {
        expect(perspective.label).not.toBe('');
        expect(perspective.text).not.toBe('');
      }
    }
  });

  it('experienced 只按日志真实到达的场景标记，不猜玩家选了什么', () => {
    const input = state({ ending: 'best', log: [entry('D2', '第 1 轮：说明事实。'), entry('D6', '陪她说完。')] });
    const { nodeGuides } = createEndingReview(input);
    expect(nodeGuides.map((node) => node.experienced)).toEqual([false, false, false, false, true, true]);

    const early = state({ ending: 'bystander', log: [entry('S14', '选择了玩笑。'), entry('C3', '说出了经过。')] });
    expect(createEndingReview(early).nodeGuides.map((node) => node.experienced)).toEqual([true, true, true, false, false, false]);

    // 只进入过 C4 时，N2 因关联场景而标记，其余仍为空。
    const partial = state({ log: [entry('C4', '尊重她的决定。')] });
    expect(createEndingReview(partial).nodeGuides.map((node) => node.experienced)).toEqual([false, true, false, false, false, false]);
  });

  it('追加 B/C：开场新闻在旁观结局后日谈与足迹重现，路上扶车进入 arrival 足迹', () => {
    const bystander = createEndingReview(state({ ending: 'bystander', newsSeen: true, helpedPasserby: true }));
    expect(bystander.epilogue.join('\n')).toContain('……跟我没关系。');
    expect(bystander.epilogue.join('\n')).toContain('你曾经说过，这件事跟你没关系。');
    expect(bystander.footprints.find((item) => item.id === 'arrival')?.lines).toEqual([
      '清晨起床时看到早间新闻，你心想：“……跟我没关系。”',
      '你曾经说过，这件事跟你没关系。',
      '上学路上，你走过去帮忙扶起了摔倒的自行车。',
    ]);

    const best = createEndingReview(state({ ending: 'best', newsSeen: true }));
    expect(best.footprints.find((item) => item.id === 'arrival')?.lines).toEqual([
      '清晨起床时看到早间新闻，你心想：“……跟我没关系。”',
    ]);
  });

  it('追加 D：最好结局送画前打断犹豫时，后日谈不声称收到画，画只留在草稿箱', () => {
    const review = createEndingReview(state({
      ending: 'best',
      trust: 7,
      log: [entry('E1', DRAWING_WITHDRAWN_LOG)],
    }));
    expect(review.cg.assetId).not.toBe('cg_ending_best_drawing');
    expect(review.epilogue[1]).not.toMatch(/夹在笔记本|收到/);
    expect(review.epilogue[1]).toContain('收回本子里');
    expect(review.drafts[2]).toMatchObject({
      id: 'draft-3',
      unlocked: true,
      assetId: 'cg_ending_best_drawing',
    });
  });

  it('追加 E/F：draftReactions 按顺序去重并过滤敏感字样，finalAnswer 写入足迹和草稿箱最后一条', () => {
    const review = createEndingReview(state({
      ending: 'best',
      trust: 5,
      draftReactions: [
        '那天，我看到有人点开了我的头像。',
        '那天，我看到有人点开了我的头像。',
        '我不知道是谁，但我猜得到。',
        '你先问了我。谢谢。',
        'harm=10',
      ],
      finalAnswer: 'tired',
    }));
    expect(review.drafts.map((draft) => draft.id)).toEqual([
      'draft-1', 'draft-2', 'draft-3', 'draft-4',
      'reaction-1', 'reaction-3', 'reaction-4', 'draft-final',
    ]);
    expect(review.drafts[4].text).toBe('那天，我看到有人点开了我的头像。');
    expect(review.drafts[5].text).toBe('我不知道是谁，但我猜得到。');
    expect(review.drafts[6].text).toBe('你先问了我。谢谢。');
    expect(review.drafts[review.drafts.length - 1]).toMatchObject({
      id: 'draft-final',
      unlocked: true,
    });
    expect(review.drafts[review.drafts.length - 1].text).toContain('撑不住');
    expect(review.footprints.find((item) => item.id === 'afterwards')?.lines).toContain(
      '面对林夏最后的提问，你的回应：“你那天看起来很累。”',
    );
    expect(JSON.stringify(review)).not.toMatch(/harm|trust|yuanScore|伤害值|分数/);
  });
});

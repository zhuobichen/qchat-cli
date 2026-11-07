/**
 * 去「人机味」：把模型默认的公文腔、总结癖、对称句式机械地削掉。
 *
 * 为什么要机械过滤而不是只靠 prompt：
 * prompt 里写「别用列表」是建议，模型经常不听；正则删掉是硬约束。
 * 两者要一起用——prompt 管"想说什么"，过滤器管"别怎么说"。
 *
 * 只用于**聊天回复**。写文档、发文件时不要走这里（那边需要结构）。
 */

/** 公文连接词：出现在句首时基本可以直接删 */
const CONNECTIVES = [
  // 长的放前面：先匹配"还有一点值得注意的是"，否则会被"值得注意的是"抢先
  '还有一点值得注意的是', '此外还需要注意的是', '还有一个值得说的点',
  '有几点需要说明', '需要注意的是', '需要强调的是',
  '首先', '其次', '再次', '最后', '另外', '此外', '同时', '而且', '并且',
  '总之', '综上', '综上所述', '总的来说', '总而言之', '简而言之', '换句话说',
  '值得注意的是', '需要说明的是', '需要指出的是', '值得一提的是',
  '在此基础上', '从这个角度看', '从某种意义上说', '客观来讲', '严格来说',
];

/** 自我指涉 / 客服腔：整句删掉或替换 */
const AI_SELF_TALK = [
  /作为(一个|一名)?\s*(AI|人工智能|语言模型|助手)[，,。]?/g,
  /我(作为一个)?\s*(AI|人工智能|语言模型)[^。！？\n]{0,20}[。！？]?/g,
  /我(先)?(说明|声明|强调|补充)一下[，,：:]?/g,
  /老实说[，,]?/g,
  /说实话[，,]?/g,
  /希望(这个|以上)(回答|内容|信息)(对你)?(有|能)[^。！？\n]{0,10}[。！？]?/g,
  /如果(你)?(还)?有(其他|别的|任何)(问题|疑问)[^。！？\n]{0,15}[。！？]?/g,
  /(以上|这些)(就是|是)我(的)?(回答|看法|建议)[。！？]?/g,
];

/** 结尾的总结癖。有冒号算，没冒号（"总的来说建议先做 X"）也算 */
const SUMMARY_TAIL = /\n*(?:总结一下|简单总结|总的来看|总的来说|综上|总而言之)[：:，,]?[\s\S]*$/;

/**
 * 清理一行。
 * @param line 原始行
 * @param aggressive 是否连句首连接词也删（聊天场景建议 true）
 */
function cleanLine(line: string, aggressive: boolean): string {
  let out = line;
  for (const re of AI_SELF_TALK) out = out.replace(re, '');
  if (aggressive) {
    // 要跑多轮：删掉一个连接词后，后面那个会露到句首来。
    // 例："此外，还有一点值得注意的是X" —— 第一轮删"此外"，
    // 第二轮才轮得到"还有一点值得注意的是"。单轮会漏。
    for (let pass = 0; pass < 3; pass += 1) {
      const snapshot = out;
      for (const c of CONNECTIVES) {
        // 尾随标点是否必需，看词长：
        //   短词（≤3，"最后""此外"）必须带标点才删 —— 否则
        //     "最后一波团战" 会被削成 "一波团战"，语义就坏了；
        //   长词（≥4，"还有一点值得注意的是"）允许直接接内容，
        //     那种情况本来就不会被误认成普通短语。
        const needPunct = c.length <= 3;
        const tail = needPunct ? '[，,：:]' : '[，,：:]?';
        out = out.replace(new RegExp(`(^|[。！？；\\n])\\s*${c}${tail}\\s*`, 'g'), '$1');
      }
      if (out === snapshot) break;
    }
  }
  return out;
}

export interface HumanizeOptions {
  /** 删掉 markdown 结构（表格/标题/列表）。聊天里基本都该删 */
  stripMarkdown?: boolean;
  /** 删句首连接词 */
  dropConnectives?: boolean;
  /** 删结尾总结段 */
  dropSummaryTail?: boolean;
  /** 硬上限（字符）。超过就截到最后一个句号 */
  maxChars?: number;
  /** 保留换行（多段消息）。默认 true */
  keepParagraphs?: boolean;
}

export interface HumanizeResult {
  text: string;
  /** 做了哪些改动，便于排查「怎么把我原话改了」 */
  changes: string[];
}

/**
 * 把一段回复削成"像人在群里说话"的样子。
 *
 * 注意：这个函数是**保守**的——它只删明显是模板的东西，
 * 不动内容本身。宁可少删，也不要删出病句。
 */
export function humanize(text: string, options: HumanizeOptions = {}): HumanizeResult {
  const opts: Required<Omit<HumanizeOptions, 'maxChars'>> & { maxChars?: number } = {
    stripMarkdown: options.stripMarkdown ?? true,
    dropConnectives: options.dropConnectives ?? true,
    dropSummaryTail: options.dropSummaryTail ?? true,
    keepParagraphs: options.keepParagraphs ?? true,
    maxChars: options.maxChars,
  };
  const changes: string[] = [];
  let out = String(text ?? '');
  const before = out;

  if (opts.stripMarkdown) {
    // 表格：整块删（聊天里没人发表格）
    if (/^\s*\|.*\|\s*$/m.test(out)) {
      out = out.replace(/^\s*\|.*\|\s*$/gm, '').replace(/^\s*[-:|\s]+$/gm, '');
      changes.push('删表格');
    }
    // 标题符号
    if (/^#{1,6}\s/m.test(out)) {
      out = out.replace(/^#{1,6}\s+/gm, '');
      changes.push('去标题符号');
    }
    // 短行 bullet（- xxx / • xxx / 数字. xxx），但如果整段都是列表就保留成句子
    if (/^\s*[-*•]\s+/m.test(out)) {
      out = out.replace(/^\s*[-*•]\s+/gm, '');
      changes.push('去 bullet');
    }
    // 粗体/行内代码
    out = out.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
  }

  out = out
    .split(/\r?\n/)
    .map((l) => cleanLine(l, opts.dropConnectives))
    .join('\n');

  if (opts.dropSummaryTail) {
    const m = out.match(SUMMARY_TAIL);
    if (m) {
      out = out.slice(0, m.index);
      changes.push('删结尾总结');
    }
  }

  // 多空行压成一个
  our: {
    const collapsed = out.replace(/\n{3,}/g, '\n\n');
    if (collapsed !== out) changes.push('压缩空行');
    out = collapsed;
  }

  if (!opts.keepParagraphs) {
    out = out.replace(/\n+/g, ' ');
  }

  out = out.trim();

  if (opts.maxChars && out.length > opts.maxChars) {
    const cut = out.slice(0, opts.maxChars);
    const lastStop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'));
    out = lastStop > opts.maxChars * 0.5 ? cut.slice(0, lastStop + 1) : cut;
    changes.push(`截断到 ${out.length} 字`);
  }

  // 去掉删完剩下的空行/孤立标点
  out = out.replace(/^[，,。.；;：:]+/, '').replace(/\n{2,}/g, '\n\n').trim();
  if (out !== before && changes.length === 0) changes.push('微调');

  return { text: out, changes };
}

/**
 * 估算一段话「有多像 AI」——只用于自查，不用于拦截。
 *
 * 打分依据都是可数的症状：结构符号、连接词、句长、对称句式。
 * 分数越低越像人。
 */
export function aiSmellScore(text: string): { score: number; reasons: string[] } {
  const s = String(text ?? '');
  const reasons: string[] = [];
  let score = 0;

  const bullets = (s.match(/^\s*[-*•]\s+/gm) ?? []).length;
  if (bullets >= 2) { score += bullets * 2; reasons.push(`${bullets} 个 bullet`); }

  const tableRows = (s.match(/^\s*\|.*\|\s*$/gm) ?? []).length;
  if (tableRows >= 2) { score += tableRows * 3; reasons.push(`${tableRows} 行表格`); }

  const heads = (s.match(/^#{1,6}\s/gm) ?? []).length;
  if (heads > 0) { score += heads * 3; reasons.push(`${heads} 个小标题`); }

  const conn = CONNECTIVES.filter((c) => s.includes(c));
  if (conn.length) { score += conn.length * 2; reasons.push(`连接词 ${conn.slice(0, 3).join('/')}`); }

  const bold = (s.match(/\*\*[^*]+\*\*/g) ?? []).length;
  if (bold >= 2) { score += bold; reasons.push(`${bold} 处粗体`); }

  const paras = s.split(/\n\s*\n/).filter(Boolean);
  if (paras.length >= 4) { score += paras.length; reasons.push(`${paras.length} 段`); }

  if (/总结|综上|总之/.test(s)) { score += 3; reasons.push('有总结'); }

  // 客服腔：这类整句都该删
  const service = (s.match(/作为(一个)?\s*(AI|人工智能|语言模型|助手)|随时(可以)?(问我|联系)|希望对(你)?有(所)?帮助|如果你还有(其他)?(问题|疑问)/g) ?? []).length;
  if (service) { score += service * 3; reasons.push(`${service} 处客服腔`); }

  // 「不是A，而是B」这类对仗，连续出现两次就明显是 AI
  const antithesis = (s.match(/不是[^，。]{1,12}[，,]?\s*而是/g) ?? []).length;
  if (antithesis >= 2) { score += antithesis * 2; reasons.push(`${antithesis} 处对仗`); }

  if (s.length > 260) { score += 2; reasons.push(`${s.length} 字偏长`); }

  return { score, reasons };
}

#!/usr/bin/env node
/**
 * 时间感知：把"现在几点、这条消息多久之前"钉在每条投递里。
 *
 * 为什么要单独做：今早 12 点体检时我看到"最新群消息 22:17（839 分钟前）"，
 * 判成"群里没人说话"——其实是 QQ 掉了 14 小时。**光有分钟数不够，得有时段语义**
 * （深夜 839 分钟很正常，上午 839 分钟就是出事了），还得有"我上次清醒是什么时候"。
 *
 * 这个模块只算，不发。被 qq-watch 调用拼进投递文本。
 */

/** 当前时段的说法 */
export function periodOf(hour) {
  if (hour >= 5 && hour < 9) return '清晨';
  if (hour >= 9 && hour < 12) return '上午';
  if (hour >= 12 && hour < 14) return '中午';
  if (hour >= 14 && hour < 18) return '下午';
  if (hour >= 18 && hour < 23) return '晚上';
  return '深夜';
}

/** 人话式时长："3 分钟" / "2 小时" / "1 天 3 小时" */
export function humanGap(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟`;
  const hr = Math.floor(min / 60);
  const rmin = min % 60;
  if (hr < 24) return rmin ? `${hr} 小时 ${rmin} 分钟` : `${hr} 小时`;
  const day = Math.floor(hr / 24);
  const rhr = hr % 24;
  return rhr ? `${day} 天 ${rhr} 小时` : `${day} 天`;
}

/**
 * 一眼看懂的"现在"。
 * @param {number} nowMs 当前时间
 * @param {object} opts  { lastSeenMs: 本群最后一条消息的时间, selfAwakeMs: 我上次确实收过消息的时间 }
 */
export function nowLine(nowMs = Date.now(), opts = {}) {
  const d = new Date(nowMs);
  const hh = d.getHours();
  const period = periodOf(hh);
  const parts = [
    `现在 ${String(hh).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}（${period}，${['日', '一', '二', '三', '四', '五', '六'][d.getDay()]}）`,
  ];

  if (Number.isFinite(opts.lastSeenMs) && opts.lastSeenMs > 0) {
    const gap = nowMs - opts.lastSeenMs;
    parts.push(`这个对话上一条是 ${humanGap(gap)}前`);
    // 深夜到早上本来就是没人说话，不要当成异常
    const quietOk = hh >= 0 && hh < 9;
    if (!quietOk && gap > 3 * 3600_000) {
      parts.push('——这么久没动静，先怀疑我掉线了，别默认是群里没人说话');
    }
  }

  if (Number.isFinite(opts.selfAwakeMs) && opts.selfAwakeMs > 0) {
    const gap = nowMs - opts.selfAwakeMs;
    if (gap > 2 * 3600_000) {
      parts.push(`我自己上一次真正收到消息是 ${humanGap(gap)}前`);
    }
  }

  return parts.join('，');
}

/**
 * 判断"这么久没消息，像不像掉线"。
 * 深夜不报警（群里本来就不说话），白天超过阈值才可疑。
 */
export function looksOffline(nowMs, lastSeenMs, { daytimeThresholdHours = 3 } = {}) {
  if (!Number.isFinite(lastSeenMs) || lastSeenMs <= 0) return false;
  const hh = new Date(nowMs).getHours();
  if (hh < 9) return false; // 深夜/凌晨不判
  return nowMs - lastSeenMs > daytimeThresholdHours * 3600_000;
}

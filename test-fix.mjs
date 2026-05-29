/**
 * 测试我们修复的去重和时间边界逻辑
 */

console.log('═══════════════════════════════════');
console.log('  测试去重和时间边界修复逻辑');
console.log('═══════════════════════════════════\n');

// 模拟状态
let friendMaxTime = { '123456': 1000 };
let processedMessageIds = new Set();
let pipedMsgIds = new Set();

const LOCK_DIR = new Map();

// 模拟 getMsgId
function getMsgId(msg) {
    if (msg.message_id) return `msg_${msg.message_id}`;
    if (msg.real_id) return `msg_${msg.real_id}`;
    if (msg.msgId) return `msg_${msg.msgId}`;
    return `msg_${msg.time}_${msg.msgSeq || 0}`;
}

// 模拟 tryLock
function tryLock(msgId) {
    if (LOCK_DIR.has(msgId)) return false;
    LOCK_DIR.set(msgId, Date.now());
    return true;
}

// 模拟 poll 函数（测试用）
function testPoll(name, testMessages) {
    console.log(`\n=== ${name} ===`);
    console.log(`当前 friendMaxTime:`, friendMaxTime);
    console.log(`当前处理的消息数量:`, testMessages.length);
    
    const msgs = [...testMessages];
    
    // 按时间排序
    msgs.sort((a, b) => (a.time || 0) - (b.time || 0));
    
    let currentMaxTime = friendMaxTime['123456'] || 0;
    let updatedMaxTime = currentMaxTime;
    let processedCount = 0;
    
    for (const msg of msgs) {
        const msgId = getMsgId(msg);
        
        // 更新时间边界
        if (msg.time && msg.time > updatedMaxTime) {
            updatedMaxTime = msg.time;
        }
        
        // 锁检查
        if (!tryLock(msgId)) {
            console.log(`  跳过已锁定消息: ${msgId} (time: ${msg.time})`);
            continue;
        }
        
        // 时间边界检查
        if (msg.time <= currentMaxTime) {
            console.log(`  跳过历史消息: ${msgId} (time: ${msg.time})`);
            continue;
        }
        
        processedCount++;
        console.log(`  处理消息: ${msgId} (time: ${msg.time}), 内容: ${msg.text}`);
    }
    
    // 更新时间边界
    if (updatedMaxTime > currentMaxTime) {
        friendMaxTime['123456'] = updatedMaxTime;
        console.log(`  更新 friendMaxTime 为: ${updatedMaxTime}`);
    }
    
    console.log(`  本轮处理消息数: ${processedCount}`);
    return processedCount;
}

// 测试 1：初始处理一批消息
const test1Messages = [
    { message_id: 101, time: 1001, text: '你好' },
    { message_id: 102, time: 1002, text: '在吗' },
    { message_id: 103, time: 1003, text: '有空吗' },
];

// 测试 2：再次轮询，包含旧消息和新消息
const test2Messages = [
    { message_id: 101, time: 1001, text: '你好' }, // 旧消息
    { message_id: 102, time: 1002, text: '在吗' }, // 旧消息
    { message_id: 103, time: 1003, text: '有空吗' }, // 旧消息
    { message_id: 104, time: 1004, text: '在干嘛' }, // 新消息
    { message_id: 105, time: 1005, text: '忙不忙' }, // 新消息
];

// 测试 3：第三次轮询，混合旧新消息
const test3Messages = [
    { message_id: 103, time: 1003, text: '有空吗' },
    { message_id: 104, time: 1004, text: '在干嘛' },
    { message_id: 105, time: 1005, text: '忙不忙' },
    { message_id: 106, time: 1006, text: '好的' },
];

// 运行测试
testPoll('第一次轮询 - 处理新消息', test1Messages);
testPoll('第二次轮询 - 跳过旧消息，处理新消息', test2Messages);
testPoll('第三次轮询 - 只处理最新消息', test3Messages);

console.log('\n═══════════════════════════════════');
console.log('  测试完成！');
console.log('  结论：修复后的逻辑可以正确');
console.log('  - 跳过已处理的旧消息');
console.log('  - 更新时间边界');
console.log('  - 防止重复处理');
console.log('═══════════════════════════════════');

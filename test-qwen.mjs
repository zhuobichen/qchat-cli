import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_KEY = 'sk-14924f01020744659165b23c63e66935';
const BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

const imagePath = join(__dirname, 'logo.png');
const imageBuffer = readFileSync(imagePath);
const base64Image = imageBuffer.toString('base64');
const dataUri = `data:image/png;base64,${base64Image}`;

const res = await fetch(`${BASE_URL}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`,
  },
  body: JSON.stringify({
    model: 'qwen3.6-plus',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUri } },
        { type: 'text', text: '请详细描述这张图片的内容。' },
      ],
    }],
    max_tokens: 500,
  }),
});

const data = await res.json();
if (!res.ok) {
  console.log('错误:', res.status, JSON.stringify(data, null, 2));
} else {
  console.log('模型:', data.model);
  console.log('回复:', data.choices?.[0]?.message?.content);
}

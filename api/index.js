// 飞书API代理 - Vercel Serverless函数
// 缓存 access_token，避免频繁请求
let cachedToken = null;
let tokenExpireTime = 0;

async function getAccessToken() {
    const { FEISHU_APP_ID, FEISHU_APP_SECRET } = process.env;
    if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
        throw new Error('FEISHU_APP_ID 和 FEISHU_APP_SECRET 环境变量未配置');
    }

    // 如果 token 未过期，直接返回
    if (cachedToken && Date.now() < tokenExpireTime) {
        return cachedToken;
    }

    const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET })
    });

    const data = await response.json();
    if (data.code === 0) {
        cachedToken = data.tenant_access_token;
        // 提前5分钟过期
        tokenExpireTime = Date.now() + (data.expire - 300) * 1000;
        return cachedToken;
    }
    throw new Error(data.msg || '获取token失败');
}

export default async function handler(req, res) {
    // 处理OPTIONS预检请求
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        return res.status(200).end();
    }

    try {
        const { FEISHU_SHEET_TOKEN } = process.env;
        if (!FEISHU_SHEET_TOKEN) {
            return res.status(500).json({ code: -1, msg: '服务端环境变量 FEISHU_SHEET_TOKEN 未配置' });
        }

        let path = req.url.replace(/^\/api\/feishu/, '') || req.query.path || '';

        // 前端使用占位符，服务端自动替换为真实的 sheetToken
        path = path.replace(/__SHEET_TOKEN__/g, FEISHU_SHEET_TOKEN);

        if (!path) {
            return res.status(400).json({ code: -1, msg: '缺少请求路径' });
        }

        const targetUrl = `https://open.feishu.cn${path}`;
        console.log(`[${req.method}] ${targetUrl.replace(FEISHU_SHEET_TOKEN, '***')}`);

        const headers = { 'Content-Type': 'application/json' };

        // 自动添加认证头
        const token = await getAccessToken();
        headers['Authorization'] = `Bearer ${token}`;

        const options = { method: req.method, headers };
        if (req.method !== 'GET' && req.body) options.body = JSON.stringify(req.body);

        const response = await fetch(targetUrl, options);

        // 获取响应文本
        const text = await response.text();
        let data;

        // 尝试解析JSON，如果失败则返回原始错误
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.error('JSON解析失败:', text.substring(0, 200));
            return res.status(500).json({
                code: -1,
                msg: '飞书API返回非JSON响应',
                error: text.substring(0, 200)
            });
        }

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

        return res.status(response.status).json(data);
    } catch (error) {
        console.error('代理请求失败:', error.message);
        return res.status(500).json({ code: -1, msg: '代理请求失败: ' + error.message });
    }
}

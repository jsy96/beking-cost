// 飞书API代理 - Vercel Serverless函数
export default async function handler(req, res) {
    // 处理OPTIONS预检请求
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        return res.status(200).end();
    }

    try {
        const path = req.url.replace(/^\/api\/feishu/, '') || req.query.path || '';
        if (!path) {
            return res.status(400).json({ code: -1, msg: '缺少请求路径' });
        }

        const targetUrl = `https://open.feishu.cn${path}`;
        console.log(`[${req.method}] ${targetUrl}`);

        const headers = { 'Content-Type': 'application/json' };
        if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;

        const options = { method: req.method, headers };
        if (req.method !== 'GET' && req.body) options.body = JSON.stringify(req.body);

        const response = await fetch(targetUrl, options);
        const data = await response.json();

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        return res.status(response.status).json(data);
    } catch (error) {
        console.error('代理请求失败:', error.message);
        return res.status(500).json({ code: -1, msg: '代理请求失败: ' + error.message });
    }
}

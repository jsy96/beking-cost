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
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        return res.status(response.status).json(data);
    } catch (error) {
        console.error('代理请求失败:', error.message);
        return res.status(500).json({ code: -1, msg: '代理请求失败: ' + error.message });
    }
}

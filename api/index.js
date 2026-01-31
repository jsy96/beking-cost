/**
 * 飞书API代理 - Vercel Serverless函数
 * 将前端请求转发到飞书API，解决CORS跨域问题
 */

export default async function handler(req, res) {
    // 处理 OPTIONS 预检请求
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        return res.status(200).end();
    }

    try {
        // 获取请求的路径
        const path = req.url.replace(/^\/api\/feishu/, '') || req.query.path || '';

        if (!path) {
            return res.status(400).json({
                code: -1,
                msg: '缺少请求路径'
            });
        }

        // 构造飞书API URL
        const targetUrl = `https://open.feishu.cn${path}`;

        console.log(`[${req.method}] ${targetUrl}`);

        // 准备请求头
        const headers = {
            'Content-Type': 'application/json'
        };

        // 添加 Authorization 头（如果有）
        if (req.headers.authorization) {
            headers['Authorization'] = req.headers.authorization;
        }

        // 准备请求选项
        const options = {
            method: req.method,
            headers
        };

        // 添加请求体（非GET请求）
        if (req.method !== 'GET' && req.body) {
            options.body = JSON.stringify(req.body);
        }

        // 发送请求到飞书API
        const response = await fetch(targetUrl, options);
        const data = await response.json();

        // 设置CORS头
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        // 返回飞书API的响应
        return res.status(response.status).json(data);

    } catch (error) {
        console.error('代理请求失败:', error.message);
        return res.status(500).json({
            code: -1,
            msg: '代理请求失败: ' + error.message
        });
    }
}

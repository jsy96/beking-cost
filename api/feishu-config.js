// 飞书配置检查 API - 只返回配置状态，不返回敏感信息
export default async function handler(req, res) {
    // 处理OPTIONS预检请求
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }

    // 只支持 GET 请求
    if (req.method !== 'GET') {
        return res.status(405).json({ code: -1, msg: '方法不允许' });
    }

    try {
        const { FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_SHEET_TOKEN } = process.env;

        // 检查环境变量是否配置（不返回具体值）
        const configured = !!(FEISHU_APP_ID && FEISHU_APP_SECRET && FEISHU_SHEET_TOKEN);

        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(200).json({ code: 0, data: { configured } });
    } catch (error) {
        console.error('检查配置失败:', error.message);
        return res.status(500).json({ code: -1, msg: '检查配置失败' });
    }
}

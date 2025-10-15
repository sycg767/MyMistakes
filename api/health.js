// api/health.js - Vercel Serverless Function
const GIT_TOKEN = process.env.GIT_TOKEN;

const FILES = {
    math: '数学错题本.md',
    ds: '数据结构错题本.md'
};

module.exports = async (req, res) => {
    // 设置 CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const hasToken = !!GIT_TOKEN;
    res.json({
        status: hasToken ? 'healthy' : 'unconfigured',
        configured: hasToken,
        files: FILES,
        features: ['auto-numbering', 'timestamps', 'statistics'],
        environment: 'vercel-serverless'
    });
};

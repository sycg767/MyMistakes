// api/stats/[subject].js - Vercel Serverless Function
const axios = require('axios');
const Buffer = require('buffer').Buffer;

const GIT_TOKEN = process.env.GIT_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER || 'sycg';
const REPO_NAME = process.env.REPO_NAME || 'my-mistakes';
const SUB_FOLDER = '';

const FILES = {
    math: '数学错题本.md',
    ds: '数据结构错题本.md'
};

const giteeClient = axios.create({
    baseURL: 'https://gitee.com/api/v5',
    timeout: 30000
});

// 检查文件是否存在
async function getFileContent(owner, repo, filePath) {
    try {
        console.log(`🔍 检查文件: ${filePath}`);

        const response = await giteeClient.get(
            `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`,
            {
                params: {
                    access_token: GIT_TOKEN,
                    ref: 'master'
                },
                validateStatus: status => status === 200 || status === 404
            }
        );

        if (response.status === 404) {
            console.log(`📄 文件不存在`);
            return null;
        }

        const fileData = Array.isArray(response.data) ? response.data[0] : response.data;

        if (fileData && fileData.sha && fileData.content) {
            const content = Buffer.from(fileData.content, 'base64').toString('utf8');
            console.log(`✅ 文件存在，当前长度: ${content.length} 字符`);

            return {
                sha: fileData.sha,
                content: content
            };
        }

        return null;

    } catch (error) {
        if (error.response?.status === 404) {
            return null;
        }
        throw error;
    }
}

// 计算当前题目数量
function countQuestions(content) {
    const matches = content.match(/^## 题目 #\d+/gm);
    const count = matches ? matches.length : 0;
    console.log(`📊 当前文件中有 ${count} 道题目`);
    return count;
}

module.exports = async (req, res) => {
    // 设置 CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const subject = req.query.subject;

        if (!['math', 'ds'].includes(subject)) {
            return res.status(400).json({
                success: false,
                message: '无效的科目'
            });
        }

        const fileName = FILES[subject];
        const filePath = SUB_FOLDER ? `${SUB_FOLDER}/${fileName}` : fileName;

        const fileData = await getFileContent(REPO_OWNER, REPO_NAME, filePath);

        if (!fileData) {
            return res.json({
                success: true,
                exists: false,
                questionCount: 0,
                message: '文件尚不存在'
            });
        }

        const questionCount = countQuestions(fileData.content);

        res.json({
            success: true,
            exists: true,
            questionCount: questionCount,
            totalLength: fileData.content.length,
            lastUpdate: new Date().toISOString()
        });

    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

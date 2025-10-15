// server.js - 题号+时间格式优化版
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const Buffer = require('buffer').Buffer;

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname)));

// --- 配置 ---
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

// 重试机制
async function retryRequest(requestFn, maxRetries = 2) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await requestFn();
        } catch (error) {
            const nonRetryable = [400, 401, 403, 404];
            if (error.response && nonRetryable.includes(error.response.status)) {
                throw error;
            }
            if (i === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
}

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
            console.log(`📄 文件不存在，将创建新文件`);
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

// 创建文件
async function createFile(owner, repo, filePath, message, content) {
    console.log(`📝 创建新文件: ${filePath}`);
    
    const response = await giteeClient.post(
        `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`,
        {
            access_token: GIT_TOKEN,
            content: content,
            message: message,
            branch: 'master'
        }
    );
    
    return response.data;
}

// 更新文件
async function updateFile(owner, repo, filePath, message, content, sha) {
    console.log(`📝 更新文件: ${filePath}`);
    
    const response = await giteeClient.put(
        `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`,
        {
            access_token: GIT_TOKEN,
            content: content,
            message: message,
            sha: sha,
            branch: 'master'
        }
    );
    
    return response.data;
}

// 创建文件头部
function createFileHeader(subject) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-CN');
    
    return `# ${subject} 错题本

> 📚 创建日期：${dateStr}  
> 🎯 学科：${subject}  
> 📖 用途：考研错题整理与复习  
> 🔢 题目总数：0 道

---

`;
}

// 格式化错题条目（题号 | 时间 | 内容）
function formatEntry(content, subject, questionNumber) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).replace(/\//g, '-');
    const timeStr = now.toLocaleTimeString('zh-CN', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
    });
    
    return `
## 题目 #${questionNumber} | ${dateStr} ${timeStr}

${content.trim()}

---
`;
}

// 更新文件头部的题目总数
function updateHeaderCount(content, totalCount) {
    return content.replace(
        /> 🔢 题目总数：.*/,
        `> 🔢 题目总数：${totalCount} 道`
    );
}

// 主推送API
app.post('/api/push', async (req, res) => {
    const { content, subject } = req.body;

    if (!content || !content.trim()) {
        return res.status(400).json({
            success: false,
            message: '内容不能为空'
        });
    }

    if (!['math', 'ds'].includes(subject)) {
        return res.status(400).json({
            success: false,
            message: '无效的科目'
        });
    }

    if (!GIT_TOKEN || !REPO_OWNER || !REPO_NAME) {
        return res.status(500).json({
            success: false,
            message: '服务器配置不完整，请检查 .env 文件'
        });
    }

    try {
        const fileName = FILES[subject];
        const filePath = SUB_FOLDER ? `${SUB_FOLDER}/${fileName}` : fileName;
        const subjectName = subject === 'math' ? '数学' : '数据结构';
        
        console.log(`\n📂 目标文件: ${fileName}`);

        // 检查文件是否存在
        const existingFile = await getFileContent(REPO_OWNER, REPO_NAME, filePath);

        let finalContent;
        let commitMessage;
        let isNewFile = false;
        let questionNumber;

        if (existingFile) {
            // 文件存在 - 计算题号并追加
            questionNumber = countQuestions(existingFile.content) + 1;
            console.log(`🔢 新题目编号: ${questionNumber}`);
            
            const newEntry = formatEntry(content, subjectName, questionNumber);
            finalContent = existingFile.content + newEntry;
            
            // 更新头部的题目总数
            finalContent = updateHeaderCount(finalContent, questionNumber);
            
            commitMessage = `追加${subjectName}错题 #${questionNumber}`;
            console.log(`➕ 追加模式 - 题目 ${questionNumber}`);
        } else {
            // 文件不存在 - 创建新文件
            questionNumber = 1;
            console.log(`🔢 新题目编号: ${questionNumber}`);
            
            const header = createFileHeader(subjectName);
            const newEntry = formatEntry(content, subjectName, questionNumber);
            finalContent = header + newEntry;
            
            // 更新头部的题目总数
            finalContent = updateHeaderCount(finalContent, questionNumber);
            
            commitMessage = `创建${subjectName}错题本 - 题目 #1`;
            isNewFile = true;
            console.log(`✨ 创建模式 - 题目 1`);
        }

        // Base64编码
        const contentBase64 = Buffer.from(finalContent, 'utf8').toString('base64');

        // 执行操作
        let result;
        if (existingFile) {
            result = await retryRequest(() =>
                updateFile(
                    REPO_OWNER,
                    REPO_NAME,
                    filePath,
                    commitMessage,
                    contentBase64,
                    existingFile.sha
                )
            );
        } else {
            result = await retryRequest(() =>
                createFile(
                    REPO_OWNER,
                    REPO_NAME,
                    filePath,
                    commitMessage,
                    contentBase64
                )
            );
        }

        console.log('✅ 操作成功完成\n');

        res.json({
            success: true,
            message: isNewFile 
                ? `创建${subjectName}错题本成功 - 题目 #1` 
                : `追加${subjectName}错题成功 - 题目 #${questionNumber}`,
            fileName: fileName,
            action: isNewFile ? 'created' : 'appended',
            questionNumber: questionNumber,
            totalLength: finalContent.length
        });

    } catch (error) {
        console.error('\n❌ 操作失败:', error.response?.data || error.message);

        let errorMessage = '操作失败';
        let statusCode = 500;

        if (error.response) {
            statusCode = error.response.status;
            const apiError = error.response.data;

            switch (statusCode) {
                case 401:
                    errorMessage = 'Token认证失败，请检查 .env 中的 GIT_TOKEN';
                    break;
                case 403:
                    errorMessage = '权限不足，请检查 Token 权限';
                    break;
                case 404:
                    errorMessage = '仓库未找到，请检查 REPO_OWNER 和 REPO_NAME';
                    break;
                default:
                    errorMessage = apiError?.message || '未知错误';
            }
        }

        res.status(statusCode).json({
            success: false,
            message: errorMessage
        });
    }
});

// 获取文件统计信息
app.get('/api/stats/:subject', async (req, res) => {
    try {
        const subject = req.params.subject;
        if (!['math', 'ds'].includes(subject)) {
            return res.status(400).json({ success: false, message: '无效的科目' });
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
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 健康检查
app.get('/api/health', (req, res) => {
    const hasToken = !!GIT_TOKEN;
    res.json({
        status: hasToken ? 'healthy' : 'unconfigured',
        configured: hasToken,
        files: FILES,
        features: ['auto-numbering', 'timestamps', 'statistics']
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🌐 服务器运行在 http://localhost:${PORT}`);
    console.log(`📚 双科目追加模式 + 自动题号 + 时间戳`);
    console.log(`📂 数学: ${FILES.math}`);
    console.log(`📂 数据结构: ${FILES.ds}`);
    console.log(`📝 格式: 题目 #N | 日期 时间`);
    
    if (!GIT_TOKEN) {
        console.log(`\n⚠️  警告: 未配置 GIT_TOKEN，请检查 .env 文件`);
    } else {
        console.log(`\n✅ 配置完成，准备就绪！`);
    }
    console.log('');
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

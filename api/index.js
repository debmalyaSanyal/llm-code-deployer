const { Octokit } = require("@octokit/rest");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Helper function to create content on GitHub
async function createFile(octokit, owner, repo, path, message, content) {
    await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message,
        content: Buffer.from(content).toString('base64'),
    });
}

// Helper function to update content on GitHub
async function updateFile(octokit, owner, repo, path, message, content, sha) {
    const { data } = await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message,
        content: Buffer.from(content).toString('base64'),
        sha, // <-- This is required for updates
    });
    return data.commit.sha; // Return the new commit SHA
}


module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Only POST requests are allowed' });
    }
    
    // Immediately send a success response
    res.status(200).json({ message: 'Request received. Processing...' });

    try {
        const requestData = req.body;
        const { email, secret, task, round, nonce, brief, checks, evaluation_url } = requestData;
        
        // --- Verify Secret ---
        const MY_SECRET = process.env.MY_PROJECT_SECRET;
        if (secret !== MY_SECRET) {
            console.error("Invalid secret received.");
            return;
        }

        const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
        const octokit = new Octokit({ auth: GITHUB_TOKEN });
        const repoName = task;

        // --- Initialize Gemini API ---
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });

        // =================================================================
        //  ROUND 1 LOGIC: CREATE NEW REPOSITORY
        // =================================================================
        if (round === 1) {
            console.log(`Starting Round 1 for task: ${task}`);
            
            // 1. Generate Code with LLM
            const createPrompt = `You are an expert web developer. Create a single, self-contained HTML file. All CSS and JavaScript must be embedded. Do not include any explanations, just the raw HTML code. Brief: ${brief}. Checks: ${JSON.stringify(checks)}`;
            const result = await model.generateContent(createPrompt);
            const htmlContent = result.response.text();
            
            // 2. Create Repository
            const repo = await octokit.repos.createForAuthenticatedUser({ name: repoName, private: false });
            const repoUrl = repo.data.html_url;

            // 3. Create initial files (index.html, README, LICENSE)
            const readmeContent = `# ${task}\n\n## Round 1\n\n**Brief:** ${brief}`;
            const licenseContent = "MIT License\n\nCopyright (c) 2025 Your Name\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions...\n(The full MIT license text should be here)";

            await createFile(octokit, GITHUB_USERNAME, repoName, 'index.html', 'feat: Initial commit with index.html', htmlContent);
            await createFile(octokit, GITHUB_USERNAME, repoName, 'README.md', 'docs: Add README', readmeContent);
            await createFile(octokit, GITHUB_USERNAME, repoName, 'LICENSE', 'feat: Add MIT License', licenseContent);
            
            // We need a commit SHA to send back. Let's get it from the last operation.
            const { data: mainBranch } = await octokit.repos.getBranch({ owner: GITHUB_USERNAME, repo: repoName, branch: 'main' });
            const commitSha = mainBranch.commit.sha;

            // 4. Enable GitHub Pages
            await octokit.repos.createPagesSite({ owner: GITHUB_USERNAME, repo: repoName, source: { branch: 'main', path: '/' } });
            const pagesUrl = `https://${GITHUB_USERNAME}.github.io/${repoName}/`;
            
            // 5. Notify Evaluation URL
            setTimeout(async () => {
                await fetch(evaluation_url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, task, round, nonce, repo_url: repoUrl, commit_sha: commitSha, pages_url: pagesUrl }),
                });
                console.log(`Round 1 notification sent for ${task}`);
            }, 20000);
        
        // =================================================================
        //  ROUND 2 LOGIC: UPDATE EXISTING REPOSITORY
        // =================================================================
        } else if (round === 2) {
            console.log(`Starting Round 2 for task: ${task}`);

            // 1. Get the existing code from the repo
            const { data: oldFile } = await octokit.repos.getContent({ owner: GITHUB_USERNAME, repo: repoName, path: 'index.html' });
            const oldHtmlContent = Buffer.from(oldFile.content, 'base64').toString('utf8');
            const oldFileSha = oldFile.sha;
            
            // 2. Generate updated code with LLM
            const revisePrompt = `You are an expert web developer. You will be given an existing HTML file and a new brief to modify it. Respond with ONLY the complete, raw, updated HTML code. Do not include explanations.\n\n**New Brief:** ${brief}\n\n**Existing HTML Code:**\n\`\`\`html\n${oldHtmlContent}\n\`\`\``;
            const result = await model.generateContent(revisePrompt);
            const newHtmlContent = result.response.text();

            // 3. Update index.html
            const newCommitSha = await updateFile(octokit, GITHUB_USERNAME, repoName, 'index.html', 'feat: Update code for round 2', newHtmlContent, oldFileSha);
            
            // 4. Update README.md
            const { data: oldReadme } = await octokit.repos.getContent({ owner: GITHUB_USERNAME, repo: repoName, path: 'README.md' });
            const updatedReadmeContent = `${Buffer.from(oldReadme.content, 'base64').toString('utf8')}\n\n## Round 2\n\n**Brief:** ${brief}`;
            await updateFile(octokit, GITHUB_USERNAME, repoName, 'README.md', 'docs: Update README for round 2', updatedReadmeContent, oldReadme.sha);

            // 5. Notify Evaluation URL
            const repoUrl = `https://github.com/${GITHUB_USERNAME}/${repoName}`;
            const pagesUrl = `https://${GITHUB_USERNAME}.github.io/${repoName}/`;
            
            setTimeout(async () => {
                await fetch(evaluation_url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, task, round, nonce, repo_url: repoUrl, commit_sha: newCommitSha, pages_url: pagesUrl }),
                });
                 console.log(`Round 2 notification sent for ${task}`);
            }, 20000);
        }

    } catch (error) {
        console.error("An error occurred during the main process:", error);
    }
};

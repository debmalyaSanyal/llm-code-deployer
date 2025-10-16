const { Octokit } = require("@octokit/rest");
// Import the Google Generative AI library
const { GoogleGenerativeAI } = require("@google/generative-ai");

// This is the main function that Vercel will run
module.exports = async (req, res) => {
    // 1. --- Check the request ---
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Only POST requests are allowed' });
    }

    const requestData = req.body;
    const { email, secret, task, round, nonce, brief, checks, evaluation_url } = requestData;

    // 2. --- Verify the "secret" ---
    // Use an environment variable for security
    const MY_SECRET = process.env.MY_PROJECT_SECRET || "ds-llmproj-2025-X9a2Q"; 
    if (secret !== MY_SECRET) {
        return res.status(401).json({ message: 'Invalid secret' });
    }
    
    // Immediately send a success response so the instructor's server doesn't time out
    res.status(200).json({ message: 'Request received. Processing...' });

    // 3. --- Use LLM to Generate the Website Code ---
    try {
        // Initialize the Google AI client with your API key from environment variables
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });

        // Construct a detailed prompt for the LLM
        const prompt = `
            You are an expert web developer. Your task is to generate the complete code for a single 'index.html' file.
            
            **Constraints:**
            - You must generate a single, self-contained HTML file.
            - All CSS and JavaScript must be embedded directly within the HTML file in <style> and <script> tags.
            - Do NOT use any external files or libraries unless explicitly asked for in the brief (e.g., Bootstrap from a CDN).
            - Your response must be ONLY the raw HTML code. Do not include any explanations, comments, or markdown formatting like \`\`\`html.

            **Project Brief:**
            ${brief}

            **Evaluation Checks (your code must pass these):**
            ${JSON.stringify(checks, null, 2)}

            Now, generate the complete HTML code.
        `;

        // Call the Gemini API to generate the code
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const htmlContent = response.text();
        
        // If the LLM fails to generate code, stop here to avoid errors
        if (!htmlContent || !htmlContent.startsWith('<!DOCTYPE html>')) {
             console.error("LLM failed to generate valid HTML.", htmlContent);
             return; // Stop execution for this request
        }

        const GITHUB_USERNAME = process.env.GITHUB_USERNAME; 
        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
        const octokit = new Octokit({ auth: GITHUB_TOKEN });
        const repoName = task;

        // 4. --- Create GitHub Repo and Push the Generated Code ---
        const repo = await octokit.repos.createForAuthenticatedUser({ name: repoName, private: false });
        const repoUrl = repo.data.html_url;

        const { data: { commit } } = await octokit.repos.createOrUpdateFileContents({
            owner: GITHUB_USERNAME,
            repo: repoName,
            path: 'index.html',
            message: `feat: Initial commit for task ${task}`,
            content: Buffer.from(htmlContent).toString('base64'),
        });
        const commitSha = commit.sha;

        // 5. --- Enable GitHub Pages ---
        await octokit.repos.createPagesSite({
            owner: GITHUB_USERNAME,
            repo: repoName,
            source: { branch: 'main', path: '/' },
        });
        const pagesUrl = `https://${GITHUB_USERNAME}.github.io/${repoName}/`;
        console.log(`Successfully created repo and enabled Pages at ${pagesUrl}`);

        // 6. --- Notify the Evaluation URL ---
        // Give GitHub Pages a few seconds to build and deploy the site
        setTimeout(async () => {
            await fetch(evaluation_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, task, round, nonce, repo_url: repoUrl, commit_sha: commitSha, pages_url: pagesUrl }),
            });
            console.log("Successfully notified evaluation URL.");
        }, 20000); // Wait 20 seconds

    } catch (error) {
        console.error("An error occurred during AI generation or GitHub operations:", error);
    }
};

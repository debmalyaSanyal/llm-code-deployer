// Import the Octokit library to interact with the GitHub API
const { Octokit } = require("@octokit/rest");

// This is the main function that Vercel will run
module.exports = async (req, res) => {
    // 1. --- Check the request ---
    // Make sure the request is a POST request
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Only POST requests are allowed' });
    }

    // Get the data from the request body
    const requestData = req.body;
    const { email, secret, task, round, nonce, brief, evaluation_url } = requestData;

    // 2. --- Verify the "secret" ---
    // IMPORTANT: Replace 'YOUR_SECRET_HERE' with the secret you will put in the form
    const MY_SECRET = "ds-llmproj-2025-X9a2Q"; 
    if (secret !== MY_SECRET) {
        return res.status(401).json({ message: 'Invalid secret' });
    }
    
    // Immediately send a success response to the instructor's server
    res.status(200).json({ message: 'Request received. Processing...' });

    // 3. --- Generate the Website Code ---
    // This is the "LLM-assisted" part. We'll create simple HTML based on the brief.
    const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Project Page</title>
        </head>
        <body>
            <h1>Task: ${task}</h1>
            <p>Brief: ${brief}</p>
        </body>
        </html>
    `;
    
    // The content needs to be in Base64 for the GitHub API
    const fileContentBase64 = Buffer.from(htmlContent).toString('base64');
    const readmeContentBase64 = Buffer.from(`# ${task}\n\nThis repository was auto-generated.`).toString('base64');
    const licenseContentBase64 = Buffer.from(`MIT License... (full license text here)`).toString('base64');


    // 4. --- Use GitHub API to Create Repo and Push Files ---
    try {
        // IMPORTANT: Use your GitHub username and Personal Access Token
        const GITHUB_USERNAME = "debmalyaSanyal"; 
        const GITHUB_TOKEN = "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";
        
        const octokit = new Octokit({ auth: GITHUB_TOKEN });

        // Repo name must be unique, so we use the task ID
        const repoName = task;

        // Create a new public repository
        const repo = await octokit.repos.createForAuthenticatedUser({
            name: repoName,
            private: false,
        });
        const repoUrl = repo.data.html_url;

        // Push the index.html file
        const { data: { commit } } = await octokit.repos.createOrUpdateFileContents({
            owner: GITHUB_USERNAME,
            repo: repoName,
            path: 'index.html',
            message: 'feat: Initial commit with index.html',
            content: fileContentBase64,
        });

        const commitSha = commit.sha;
        
        // (Optional but good practice) Add a README and LICENSE
        await octokit.repos.createOrUpdateFileContents({
            owner: GITHUB_USERNAME,
            repo: repoName,
            path: 'README.md',
            message: 'docs: Add README',
            content: readmeContentBase64,
        });
        await octokit.repos.createOrUpdateFileContents({
            owner: GITHUB_USERNAME,
            repo: repoName,
            path: 'LICENSE',
            message: 'feat: Add MIT License',
            content: licenseContentBase64,
        });


        // 5. --- Enable GitHub Pages ---
        await octokit.repos.createPagesSite({
            owner: GITHUB_USERNAME,
            repo: repoName,
            source: {
                branch: 'main', // or 'master'
                path: '/',
            },
        });
        const pagesUrl = `https://${GITHUB_USERNAME}.github.io/${repoName}/`;
        
        console.log(`Successfully created repo and enabled Pages at ${pagesUrl}`);

        // 6. --- Notify the Evaluation URL ---
        // Give GitHub Pages a moment to build the site before notifying
        setTimeout(async () => {
            await fetch(evaluation_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: email,
                    task: task,
                    round: round,
                    nonce: nonce,
                    repo_url: repoUrl,
                    commit_sha: commitSha,
                    pages_url: pagesUrl,
                }),
            });
            console.log("Successfully notified evaluation URL.");
        }, 15000); // Wait 15 seconds

    } catch (error) {
        console.error("An error occurred:", error);
    }
};

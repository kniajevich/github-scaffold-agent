import { Octokit } from "@octokit/rest";

const HTML_UI = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GitHub Scaffold Agent</title>
<style>
  body { font-family: -apple-system, monospace; background: #0d1117; color: #c9d1d9; padding: 16px; margin: 0; }
  h2 { color: #58a6ff; margin-bottom: 8px; }
  input, textarea, button { width: 100%; box-sizing: border-box; background: #161b22; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px; padding: 10px; margin-bottom: 12px; font-family: inherit; font-size: 14px; }
  button { background: #238636; color: #fff; font-weight: bold; cursor: pointer; border: none; padding: 14px; }
  button:active { background: #2ea043; }
  #log { background: #010409; padding: 12px; border-radius: 6px; white-space: pre-wrap; font-size: 12px; border: 1px solid #30363d; min-height: 80px; }
</style>
</head>
<body>
  <h2>⚡ Scaffold Agent</h2>
  <label>Repository:</label>
  <input id="repo" value="p4-teensy-audio" placeholder="repo-name" />
  <label>Commit Message:</label>
  <input id="msg" value="feat: batch module port" placeholder="commit message" />
  <label>Files Payload (JSON array):</label>
  <textarea id="payload" rows="12" placeholder='[{"path": "include/test.h", "content": "..."}]'></textarea>
  <button id="btn" onclick="sendCommit()">🚀 Push Atomic Bundle</button>
  <h3>Log:</h3>
  <div id="log">Ready.</div>

<script>
async function sendCommit() {
  const log = document.getElementById("log");
  const repo = document.getElementById("repo").value.trim();
  const message = document.getElementById("msg").value.trim();
  const payloadStr = document.getElementById("payload").value.trim();
  log.textContent = "Processing bundle...";
  try {
    const files = JSON.parse(payloadStr);
    const res = await fetch("/api/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo, message, files })
    });
    const data = await res.json();
    log.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    log.textContent = "Error: " + err.message;
  }
}
</script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(HTML_UI, { headers: { "Content-Type": "text/html;charset=utf-8" } });
    }

    if (request.method === "POST" && url.pathname === "/api/commit") {
      try {
        const { repo, message, files } = await request.json();
        if (!repo || !files || !Array.isArray(files) || files.length === 0) {
          return new Response(JSON.stringify({ error: "Invalid payload: repo and files array required" }), { status: 400 });
        }

        const octokit = new Octokit({ auth: env.GITHUB_TOKEN });
        const owner = env.GITHUB_OWNER || "kniajevich";

        // 1. Get branch reference
        const refData = await octokit.rest.git.getRef({ owner, repo, ref: "heads/main" });
        const latestCommitSha = refData.data.object.sha;

        // 2. Get base tree SHA
        const commitData = await octokit.rest.git.getCommit({ owner, repo, commit_sha: latestCommitSha });
        const baseTreeSha = commitData.data.tree.sha;

        // 3. Create Blobs & Tree nodes
        const treeItems = [];
        for (const file of files) {
          const blobData = await octokit.rest.git.createBlob({
            owner,
            repo,
            content: file.content,
            encoding: "utf-8"
          });
          treeItems.push({
            path: file.path,
            mode: "100644",
            type: "blob",
            sha: blobData.data.sha
          });
        }

        // 4. Create new Tree
        const newTree = await octokit.rest.git.createTree({
          owner,
          repo,
          base_tree: baseTreeSha,
          tree: treeItems
        });

        // 5. Create atomic commit
        const newCommit = await octokit.rest.git.createCommit({
          owner,
          repo,
          message: message || "chore: batch update via scaffold agent",
          tree: newTree.data.sha,
          parents: [latestCommitSha]
        });

        // 6. Update main branch pointer
        await octokit.rest.git.updateRef({
          owner,
          repo,
          ref: "heads/main",
          sha: newCommit.data.sha
        });

        return new Response(JSON.stringify({
          success: true,
          commit: newCommit.data.sha,
          files_pushed: files.length,
          url: `https://github.com/${owner}/${repo}/commit/${newCommit.data.sha}`
        }), { headers: { "Content-Type": "application/json" } });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};

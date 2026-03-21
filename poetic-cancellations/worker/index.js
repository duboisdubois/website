const GITHUB_REPO = 'duboisdubois/website';
const SKIPS_PATH = 'poetic-cancellations/data/skips.json';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/contents/${SKIPS_PATH}`;
const ALLOWED_ORIGIN = 'https://alicedubois.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return json({ success: false, error: 'Method not allowed' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ success: false, error: 'Invalid JSON' }, 400);
    }

    const { player, action, password } = body;

    if (!password || password !== env.EDIT_PASSWORD) {
      return json({ success: false, error: 'Wrong password' }, 403);
    }

    if (action === 'validate') {
      return json({ success: true });
    }

    if (!player || !['increment', 'decrement', 'reset'].includes(action)) {
      return json({ success: false, error: 'Invalid request' }, 400);
    }

    // Read current skips.json from GitHub — must be uncached to get the live SHA
    const getRes = await fetch(GITHUB_API, {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${env.SKIPS_PAT}`,
        'User-Agent': 'poetic-cancellations-worker',
        Accept: 'application/vnd.github+json',
      },
    });

    if (!getRes.ok) {
      return json({ success: false, error: `GitHub read failed: ${getRes.status}` }, 502);
    }

    const fileData = await getRes.json();
    const currentContent = JSON.parse(atob(fileData.content.replace(/\n/g, '')));
    const sha = fileData.sha;

    if (!(player in currentContent)) {
      return json({ success: false, error: 'Unknown player' }, 400);
    }

    // Apply the action
    if (action === 'increment') {
      currentContent[player] = currentContent[player] + 1;
    } else if (action === 'decrement') {
      currentContent[player] = Math.max(0, currentContent[player] - 1);
    } else if (action === 'reset') {
      currentContent[player] = 0;
    }

    // Write back to GitHub
    const newContent = btoa(JSON.stringify(currentContent, null, 2) + '\n');
    const putRes = await fetch(GITHUB_API, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${env.SKIPS_PAT}`,
        'User-Agent': 'poetic-cancellations-worker',
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `${action} skip count for ${player}`,
        content: newContent,
        sha,
      }),
    });

    if (!putRes.ok) {
      const err = await putRes.text();
      return json({ success: false, error: `GitHub write failed: ${putRes.status} ${err}` }, 502);
    }

    return json({ success: true, data: currentContent });
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const GITHUB_REPO = 'duboisdubois/website';
const SKIPS_PATH = 'poetic-cancellations/data/skips.json';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/contents/${SKIPS_PATH}`;
const ALLOWED_ORIGINS = [
  'https://alicedubois.com',
  'http://localhost:3000',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'POST') {
      return json({ success: false, error: 'Method not allowed' }, 405, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ success: false, error: 'Invalid JSON' }, 400);
    }

    const { player, action, password } = body;

    if (!password || password !== env.EDIT_PASSWORD) {
      return json({ success: false, error: 'Wrong password' }, 403, cors);
    }

    if (action === 'validate') {
      return json({ success: true }, 200, cors);
    }

    if (!player || !['increment', 'decrement', 'reset'].includes(action)) {
      return json({ success: false, error: 'Invalid request' }, 400, cors);
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
      return json({ success: false, error: `GitHub read failed: ${getRes.status}` }, 502, cors);
    }

    const fileData = await getRes.json();
    const currentContent = JSON.parse(atob(fileData.content.replace(/\n/g, '')));
    const sha = fileData.sha;

    if (!(player in currentContent)) {
      return json({ success: false, error: 'Unknown player' }, 400, cors);
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
      return json({ success: false, error: `GitHub write failed: ${putRes.status} ${err}` }, 502, cors);
    }

    return json({ success: true, data: currentContent }, 200, cors);
  },
};

function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// Pulls recent posts for each handle in accounts.json from Weir's API
// and writes data/tweets.json for the page to render.
// Run locally:  WEIR_API_KEY=... node la-feeeeed/fetch.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, "data");
const POSTS_PER_ACCOUNT = 10;
const MAX_TOTAL = 40;

const key = process.env.WEIR_API_KEY;
if (!key) {
  console.error("WEIR_API_KEY is not set");
  process.exit(1);
}
const headers = { Authorization: `Bearer ${key}` };

async function get(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// Weir's exact field names may differ slightly; pick the first that exists.
const pick = (obj, ...keys) => {
  for (const k of keys) {
    const v = k.split(".").reduce((o, p) => (o == null ? undefined : o[p]), obj);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

async function fetchAccount(handle) {
  const base = `https://api.weirapp.io/v1/x/users/${encodeURIComponent(handle)}`;
  const [profileRes, postsRes] = await Promise.all([
    get(base),
    get(`${base}/posts?limit=${POSTS_PER_ACCOUNT}`),
  ]);
  const profile = profileRes.data ?? profileRes;
  const posts = postsRes.data ?? postsRes.posts ?? postsRes;

  const author = {
    handle: pick(profile, "username", "screenName", "handle") ?? handle,
    name: pick(profile, "name", "displayName") ?? handle,
    avatar: pick(profile, "profileImageUrl", "avatarUrl", "avatar", "profileImage", "image"),
  };

  const clean = [];
  for (const p of posts) {
    if (p.retweetedPost || p.isRetweet) continue; // skip reposts: they read oddly out of context
    const media = []
      .concat(pick(p, "media", "images", "photos") ?? [])
      .map((m) => (typeof m === "string" ? m : pick(m, "url", "mediaUrl", "src")))
      .filter(Boolean);
    clean.push({
      id: String(pick(p, "id", "postId", "tweetId") ?? pick(p, "url")),
      url: pick(p, "url", "permalink") ?? `https://x.com/${author.handle}`,
      text: pick(p, "text", "fullText", "content") ?? "",
      createdAt: pick(p, "createdAt", "created_at", "date"),
      media,
      author,
    });
  }
  return { clean, raw: { profile: profileRes, posts: postsRes } };
}

const accounts = JSON.parse(await readFile(path.join(here, "accounts.json"), "utf8"))
  .filter((h) => h && !h.startsWith("REPLACE"));

const all = [];
const raw = {};
let failures = 0;
for (const handle of accounts) {
  try {
    const { clean, raw: r } = await fetchAccount(handle);
    all.push(...clean);
    raw[handle] = r;
    console.log(`${handle}: ${clean.length} posts`);
  } catch (err) {
    failures++;
    console.error(`${handle}: ${err.message}`);
  }
}

if (all.length === 0) {
  console.error("No posts fetched; keeping the previous tweets.json");
  process.exit(failures ? 1 : 0);
}

all.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
await mkdir(dataDir, { recursive: true });
await writeFile(
  path.join(dataDir, "tweets.json"),
  JSON.stringify({ updatedAt: new Date().toISOString(), posts: all.slice(0, MAX_TOTAL) }, null, 2)
);
await writeFile(path.join(dataDir, "raw-latest.json"), JSON.stringify(raw, null, 2));
console.log(`wrote ${Math.min(all.length, MAX_TOTAL)} posts to data/tweets.json`);

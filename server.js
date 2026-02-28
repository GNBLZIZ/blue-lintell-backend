// BLUE & LINTELL - ATHLETE DASHBOARD BACKEND (Phase 1 MVP)
// Includes CORS, historical tracking, and /api/athlete/:id/history/:days (Milestone 1)

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { ComprehendClient, DetectSentimentCommand, DetectEntitiesCommand } = require('@aws-sdk/client-comprehend');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('⚠️ SUPABASE_URL or SUPABASE_KEY is missing. Set both in .env.');
}
if (SUPABASE_URL && !SUPABASE_URL.startsWith('https://')) {
  console.warn('⚠️ SUPABASE_URL should start with https:// (e.g. https://your-project.supabase.co)');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const comprehendClient = new ComprehendClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// --- Apify (Twitter + Instagram) - replaces Netrows and Meta Instagram Graph API ---
const APIFY_TOKEN = process.env.APIFY_API_TOKEN || '';
if (!APIFY_TOKEN) {
  console.warn('⚠️ APIFY_API_TOKEN is missing. Twitter and Instagram data collection will fail.');
}

function logApiError(prefix, e) {
  const status = e.response?.status;
  const body = e.response?.data;
  if (status != null || body != null) {
    console.error(prefix, status != null ? `status ${status}` : '', body != null ? JSON.stringify(body) : e.message);
  } else {
    console.error(prefix, e.message);
  }
}

/** Run an Apify actor synchronously and return dataset items (JSON). See https://docs.apify.com/api/v2 */
async function apifyRunSync(actorId, input, options = {}) {
  if (!APIFY_TOKEN) return [];
  const timeout = options.timeout ?? 120;
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}&format=json&timeout=${timeout}`;
  try {
    const res = await axios.post(url, input, {
      headers: { 'Content-Type': 'application/json' },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: (timeout + 10) * 1000
    });
    return Array.isArray(res.data) ? res.data : [];
  } catch (e) {
    logApiError(`Apify ${actorId}:`, e);
    return [];
  }
}

// --- Twitter via Apify apidojo/tweet-scraper (replaces Netrows) ---
const APIFY_TWEET_SCRAPER = 'apidojo~tweet-scraper';

async function getTwitterProfile(username) {
  const handle = username.replace('@', '');
  const items = await apifyRunSync(APIFY_TWEET_SCRAPER, {
    twitterHandles: [handle],
    maxItems: 5,
    sort: 'Latest'
  }, { timeout: 90 });
  if (!items.length) return null;
  const first = items[0];
  // Apify may return user object first (type 'user') or tweet with nested user
  const isUserObj = first.type === 'user' || (first.followers != null && first.full_text == null && first.text == null);
  const user = isUserObj ? first : (first.user ?? first.author ?? first);
  // Apify apidojo/tweet-scraper: user object may have followers_count, public_metrics.followers_count, or followers
  const followersRaw = user.followers_count ?? user.public_metrics?.followers_count ?? user.followers ?? user.followersCount ?? 0;
  const followingRaw = user.following_count ?? user.public_metrics?.following_count ?? user.following ?? user.followingCount ?? 0;
  const followers = typeof followersRaw === 'number' ? followersRaw : parseInt(followersRaw, 10) || 0;
  const following = typeof followingRaw === 'number' ? followingRaw : parseInt(followingRaw, 10) || 0;
  return {
    username: user.userName ?? user.username ?? user.screen_name ?? handle,
    name: user.name ?? user.username ?? user.userName ?? handle,
    followers,
    following,
    verified: user.isBlueVerified ?? user.verified ?? user.verified_user ?? false,
    bio: user.description ?? user.bio ?? '',
    profileImage: user.profilePicture ?? user.profile_image_url_https ?? user.profile_image_url ?? user.avatar ?? null
  };
}

async function getRecentTweets(username, count = 20) {
  const handle = username.replace('@', '');
  const items = await apifyRunSync(APIFY_TWEET_SCRAPER, {
    twitterHandles: [handle],
    maxItems: Math.min(count, 100),
    sort: 'Latest'
  }, { timeout: 120 });
  const list = Array.isArray(items) ? items : [];
  // Apify can return user/profile objects first; skip items that are clearly not tweets (no content, no tweet id)
  const tweetsOnly = list.filter(t => {
    if (t.type === 'user') return false;
    const text = t.full_text ?? t.text ?? t.content ?? '';
    const hasContent = typeof text === 'string' && text.trim().length > 0;
    const hasTweetId = t.tweet_id ?? t.id_str ?? t.id;
    return hasContent || hasTweetId;
  });
  return tweetsOnly.map(t => ({
    id: t.id ?? t.tweet_id ?? t.id_str,
    text: t.full_text ?? t.text ?? t.content ?? '',
    createdAt: t.created_at ?? t.createdAt ?? t.date ?? t.created,
    likes: t.likeCount ?? t.likes ?? t.favorite_count ?? t.like_count ?? 0,
    retweets: t.retweetCount ?? t.retweets ?? t.retweet_count ?? 0,
    replies: t.replyCount ?? t.replies ?? t.reply_count ?? 0,
    views: t.viewCount ?? t.views ?? t.view_count ?? 0
  })).map(t => ({
    ...t,
    likes: Number(t.likes) || 0,
    retweets: Number(t.retweets) || 0,
    replies: Number(t.replies) || 0,
    views: Number(t.views) || 0
  }));
}

async function getTwitterMentions(username, count = 20) {
  const handle = username.replace('@', '');
  const items = await apifyRunSync(APIFY_TWEET_SCRAPER, {
    searchTerms: [`@${handle}`],
    maxItems: Math.min(count, 100),
    sort: 'Latest'
  }, { timeout: 120 });
  return Array.isArray(items) ? items : [];
}

// --- Instagram via Apify apify/instagram-profile-scraper (replaces Meta Graph API) ---
const APIFY_INSTAGRAM_SCRAPER = 'apify~instagram-profile-scraper';

/**
 * Resolve Instagram identifier to username for Apify.
 * Apify expects username (e.g. mosalah), not Meta numeric ID (e.g. 27298082519781975).
 * - Accepts: username, @username, or profile URL (https://www.instagram.com/username/).
 * - If value is purely numeric (old Meta Business ID), returns '' and skips Instagram (logs once).
 * - Fallback: INSTAGRAM_USER_ID env (use a username only; numeric ID will be rejected and Instagram skipped).
 */
function resolveInstagramUsername(instagramBusinessId) {
  const fromAthlete = (instagramBusinessId && String(instagramBusinessId).trim()) || '';
  const fromEnv = (process.env.INSTAGRAM_USER_ID && String(process.env.INSTAGRAM_USER_ID).trim()) || '';
  const v = fromAthlete || fromEnv;
  const raw = v.replace('@', '').trim();
  if (!raw) return '';

  // Extract username from Instagram profile URL if present
  const urlMatch = raw.match(/instagram\.com\/([^/?]+)/i);
  const candidate = urlMatch ? urlMatch[1] : raw;

  // Apify does not accept numeric IDs; only usernames (letters, numbers, underscores, dots)
  const isNumericId = /^\d+$/.test(candidate);
  if (isNumericId) {
    const source = fromAthlete ? 'athlete record' : 'INSTAGRAM_USER_ID env';
    console.warn(`⚠️ Instagram skipped: ${source} is a numeric ID. Apify needs username (e.g. mosalah). Use Instagram username in athletes.instagram_business_id and in .env INSTAGRAM_USER_ID if set.`);
    return '';
  }

  return candidate;
}

async function getInstagramProfile(instagramBusinessId) {
  const username = resolveInstagramUsername(instagramBusinessId);
  if (!username) return null;
  try {
    // Official apify/instagram-profile-scraper input: { usernames: string[] }. No resultsLimit.
    const input = { usernames: [username] };
    const items = await apifyRunSync(APIFY_INSTAGRAM_SCRAPER, input, { timeout: 120 });
    const raw = items && items[0] ? items[0] : null;
    if (!raw) {
      console.warn('📷 Instagram profile: Apify returned no items for username', username);
      return null;
    }
    // Apify output: followersCount, followsCount, postsCount, username, fullName, profilePicUrl
    const followersRaw = raw.followersCount ?? raw.followers ?? raw.edge_followed_by?.count ?? 0;
    const followingRaw = raw.followsCount ?? raw.following ?? raw.edge_follow ?? 0;
    const followers = typeof followersRaw === 'number' ? followersRaw : parseInt(followersRaw, 10) || 0;
    const following = typeof followingRaw === 'number' ? followingRaw : parseInt(followingRaw, 10) || 0;
    const profile = {
      username: raw.username ?? raw.fullName ?? raw.full_name ?? username,
      name: raw.fullName ?? raw.full_name ?? raw.username ?? username,
      followers,
      following,
      posts: raw.postsCount ?? raw.mediaCount ?? raw.edge_owner_to_timeline_media?.count ?? 0,
      bio: raw.biography ?? raw.bio ?? '',
      profileImage: raw.profilePicUrl ?? raw.profilePicUrlHD ?? raw.profile_picture_url ?? raw.profile_pic_url ?? null
    };
    if (followers > 0 || profile.username) console.log('📷 Instagram profile OK:', profile.username, followers, 'followers');
    return profile;
  } catch (e) {
    logApiError('Instagram profile error:', e);
    return null;
  }
}

async function getInstagramPosts(instagramBusinessId, limit = 10) {
  const username = resolveInstagramUsername(instagramBusinessId);
  if (!username) return [];
  try {
    const input = { usernames: [username] };
    const items = await apifyRunSync(APIFY_INSTAGRAM_SCRAPER, input, { timeout: 120 });
    const raw = items && items[0] ? items[0] : null;
    const posts = raw?.latestPosts ?? raw?.latest_posts ?? raw?.posts ?? [];
    const list = Array.isArray(posts) ? posts.slice(0, limit) : [];
    const mapped = list.map(p => ({
      id: p.id ?? p.shortCode,
      caption: p.caption ?? p.captionText ?? '',
      type: p.type ?? p.mediaType ?? 'IMAGE',
      url: p.displayUrl ?? p.url ?? p.mediaUrl ?? null,
      permalink: p.url ?? p.permalink ?? null,
      timestamp: p.timestamp ?? p.takenAt ?? p.createdAt,
      likes: Number(p.likesCount ?? p.likes ?? 0) || 0,
      comments: Number(p.commentsCount ?? p.comments ?? 0) || 0
    }));
    if (mapped.length > 0) console.log('📷 Instagram posts:', mapped.length, 'for', username);
    else if (raw && !raw.latestPosts?.length) console.warn('📷 Instagram posts: profile has no latestPosts for', username);
    return mapped;
  } catch (e) {
    logApiError('Instagram posts error:', e);
    return [];
  }
}

async function getInstagramInsights(instagramBusinessId) {
  const username = resolveInstagramUsername(instagramBusinessId);
  if (!username) return {};
  try {
    const input = { usernames: [username] };
    const items = await apifyRunSync(APIFY_INSTAGRAM_SCRAPER, input, { timeout: 120 });
    const raw = items && items[0] ? items[0] : null;
    if (!raw) return {};
    return {
      impressions: raw.impressions ?? null,
      reach: raw.reach ?? null,
      profile_views: raw.profileViews ?? null
    };
  } catch (e) {
    return {};
  }
}

// --- News (NewsData.io) - apikey + q + language (required); avoid unsupported params that cause 422 ---
async function searchNews(athleteName, daysBack = 7, country) {
  try {
    const q = (athleteName || '').trim();
    if (q.length < 3) return [];
    const res = await axios.get('https://newsdata.io/api/1/news', {
      params: {
        apikey: process.env.NEWSDATA_API_KEY,
        q,
        language: 'en',
        ...(country ? { country } : {})
      }
    });
    return (res.data.results || []).map(a => ({ title: a.title, description: a.description, content: a.content, url: a.link, source: a.source_id, publishedAt: a.pubDate, imageUrl: a.image_url, category: a.category, sentiment: a.sentiment }));
  } catch (e) {
    logApiError('News search error:', e);
    return [];
  }
}

// --- Sentiment (AWS) ---
const NEUTRAL_FALLBACK = { sentiment: 'NEUTRAL', scores: { positive: 0, negative: 0, neutral: 1, mixed: 0 } };

async function analyzeSentiment(text, languageCode = 'en') {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed || trimmed.length < 1) return NEUTRAL_FALLBACK;
  try {
    const cmd = new DetectSentimentCommand({ Text: trimmed.substring(0, 5000), LanguageCode: languageCode });
    const res = await comprehendClient.send(cmd);
    return { sentiment: res.Sentiment, scores: { positive: res.SentimentScore.Positive, negative: res.SentimentScore.Negative, neutral: res.SentimentScore.Neutral, mixed: res.SentimentScore.Mixed } };
  } catch (e) {
    if (e.message && e.message.includes('subscription')) {
      console.error('Sentiment error: AWS Comprehend not enabled for this account. Enable it in AWS Console → Comprehend, or check IAM/subscription.');
    } else {
      console.error('Sentiment error:', e.message);
    }
    return { sentiment: 'NEUTRAL', scores: { positive: 0, negative: 0, neutral: 1, mixed: 0 } };
  }
}

function calculateOverallSentiment(sentimentResults) {
  const valid = (sentimentResults || []).filter(r => r && r.scores);
  if (valid.length === 0) return 50;
  let total = 0;
  valid.forEach(r => { total += (r.scores.positive * 100) + (r.scores.neutral * 50) + (r.scores.negative * 0) + (r.scores.mixed * 50); });
  return Math.round(total / valid.length);
}

function calculateReputationScores(athleteData) {
  const { tweets, mentions, news, instagram } = athleteData;
  const tweetS = (tweets || []).map(t => t.sentiment);
  const newsS = (news || []).map(n => n.sentiment);
  const allS = [...tweetS, ...newsS];
  const sentimentScore = calculateOverallSentiment(allS);
  const followers = athleteData.profile?.followers || 1;
  const twitterEng = (tweets || []).reduce((s, t) => s + (t.likes + t.retweets + t.replies), 0);
  const instaPosts = instagram?.posts || [];
  const instaEng = instaPosts.reduce((s, p) => s + (p.likes + p.comments), 0);
  const credibilityScore = Math.min(100, Math.round((athleteData.profile?.verified ? 30 : 0) + (Math.log10(followers) * 10) + (news.length * 2)));
  const avgTweetEng = tweets.length ? twitterEng / tweets.length : 0;
  const likeabilityScore = Math.max(40, Math.min(100, Math.round(50 + Math.log10(1 + avgTweetEng) * 8 + (instaPosts.length ? 5 : 0))));
  const validS = allS.filter(s => s && s.scores);
  // Include negative + mixed sentiment so controversy is not always 0 when content is mostly neutral
  const negRatio = validS.length === 0 ? 0 : validS.reduce((sum, s) => sum + (s.scores.negative || 0) + (s.scores.mixed || 0) * 0.4, 0) / validS.length;
  const controversyScore = Math.min(100, Math.round(negRatio * 100));
  const relevanceScore = Math.min(100, Math.round((mentions.length * 2) + (news.length * 3) + (instagram?.insights?.impressions ? Math.log10(instagram.insights.impressions) * 5 : 0)));
  const leadershipScore = Math.max(50, Math.min(100, Math.round((credibilityScore * 0.35) + (sentimentScore * 0.35) + (relevanceScore * 0.2) + (news.length > 5 ? 5 : 0))));
  const authenticityScore = Math.max(50, Math.min(100, Math.round((sentimentScore * 0.4) + (likeabilityScore * 0.4) + (validS.length ? 10 : 0))));
  return { sentimentScore, credibilityScore, likeabilityScore, leadershipScore, authenticityScore, controversyScore, relevanceScore };
}

function calculateAlertLevel(data) {
  const s = data.sentiment_score ?? 70, c = data.controversy_score ?? 30;
  if (s < 50 || c > 40) return 'critical';
  if (s < 60 || c > 30) return 'elevated';
  return 'nominal';
}

// --- Claude (Anthropic) API for score explanations (perception_details) ---
// See https://docs.anthropic.com/en/api/messages and https://platform.claude.com/docs/en/api/messages
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_VERSION = '2023-06-01';
// Use current model; claude-3-5-sonnet-20241022 is deprecated and can return 404
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

async function generateScoreExplanation(metricName, score, context) {
  if (!ANTHROPIC_API_KEY) return { summary: '', breakdown: [] };
  const prompt = `Generate a 2-sentence explanation and exactly 4 bullet points for why this athlete's ${metricName} score is ${score}.

Context:
- Twitter: ${context.twitterPctPositive}% positive sentiment, ${context.twitterFollowers} followers, ${context.twitterMentions} mentions
- Instagram: ${context.instagramPctPositive}% positive, ${context.instagramFollowers} followers, ${context.instagramPosts} posts
- News: ${context.newsMentions} mentions, ${context.newsSentiment} sentiment

Format your response exactly as:
Description paragraph (2 sentences, no label).

- Bullet point 1
- Bullet point 2
- Bullet point 3
- Bullet point 4`;

  try {
    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: CLAUDE_MODEL,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': ANTHROPIC_VERSION
        },
        timeout: 60000,
        validateStatus: () => true
      }
    );
    if (res.status !== 200) {
      const errMsg = res.data?.error?.message || res.statusText;
      const errType = res.data?.error?.type;
      console.error('Claude API error for', metricName, ':', res.status, errType || '', errMsg);
      return { summary: '', breakdown: [] };
    }
    const text = res.data?.content?.[0]?.text || '';
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
    const bulletLines = lines.filter(l => l.startsWith('-'));
    const summaryLines = lines.filter(l => !l.startsWith('-'));
    const summary = summaryLines.join(' ').trim() || '';
    const breakdown = bulletLines.map(l => l.startsWith('-') ? l : `• ${l}`);
    return { summary, breakdown };
  } catch (e) {
    console.error('Claude explanation error for', metricName, ':', e.message);
    return { summary: '', breakdown: [] };
  }
}

/** Template-based explanation when Claude API is not available */
function getTemplateExplanation(metricName, score, context) {
  const s = score ?? 0;
  const templates = {
    Sentiment: {
      summary: s >= 70 ? `Positive sentiment detected across recent posts and news. Fans and media are largely supportive.` : s >= 50 ? `Mixed to neutral sentiment. Some positive coverage with limited negative mentions.` : `Elevated negative sentiment in recent coverage. Consider monitoring and response.`,
      breakdown: [
        `Twitter: ${context.twitterPctPositive}% positive in sampled posts`,
        `News: ${context.newsSentiment}`,
        `Based on ${context.twitterMentions} Twitter mentions and ${context.newsMentions} news articles`
      ]
    },
    Credibility: {
      summary: s >= 70 ? `Strong credibility from verification, follower base, and media presence.` : s >= 50 ? `Moderate credibility. Verification and reach contribute to score.` : `Credibility score reflects limited verification or reach data.`,
      breakdown: [
        `Twitter followers: ${context.twitterFollowers}; Instagram: ${context.instagramFollowers}`,
        `News mentions: ${context.newsMentions}`,
        `Verified status and engagement feed into this score`
      ]
    },
    Likeability: {
      summary: s >= 70 ? `High engagement and positive interaction on social channels.` : s >= 50 ? `Solid engagement levels. Audience responds well to content.` : `Engagement metrics are modest; more active posting may improve likeability.`,
      breakdown: [
        `Average engagement from tweets and posts`,
        `Instagram posts sampled: ${context.instagramPosts}`,
        `Engagement rate and fan interaction drive this metric`
      ]
    },
    Leadership: {
      summary: s >= 70 ? `Strong leadership perception from credibility, sentiment, and relevance.` : s >= 50 ? `Leadership score reflects current media and social footprint.` : `Leadership metric is based on limited data points.`,
      breakdown: [
        `Combines credibility, sentiment, and relevance scores`,
        `News coverage volume: ${context.newsMentions} articles`,
        `Higher media presence and positive sentiment raise this score`
      ]
    },
    Authenticity: {
      summary: s >= 70 ? `Authentic voice and consistent positive sentiment across channels.` : s >= 50 ? `Authenticity reflected in sentiment and likeability signals.` : `Score based on available sentiment and engagement data.`,
      breakdown: [
        `Sentiment and likeability contribute equally`,
        `Consistency of message and fan reaction factor in`,
        `More data improves accuracy of this score`
      ]
    },
    Controversy: {
      summary: s > 40 ? `Elevated controversy from negative or mixed sentiment in recent coverage. Worth monitoring.` : s > 20 ? `Some negative or mixed sentiment detected. Generally stable.` : `Low controversy. Sentiment is predominantly positive or neutral.`,
      breakdown: [
        `Derived from negative and mixed sentiment in tweets and news`,
        `Twitter and news sentiment analysis feed this score`,
        `Lower score indicates less contentious coverage`
      ]
    },
    Relevance: {
      summary: s >= 70 ? `High relevance: strong mention count and media coverage.` : s >= 50 ? `Relevance reflects current mention and news volume.` : `Relevance score is based on mention and news counts.`,
      breakdown: [
        `Twitter mentions: ${context.twitterMentions}, News: ${context.newsMentions}`,
        `Instagram impressions and engagement also factor in`,
        `More mentions and coverage increase relevance`
      ]
    }
  };
  const t = templates[metricName] || { summary: `Score: ${s}. Based on available social and news data.`, breakdown: [] };
  return { summary: t.summary, breakdown: t.breakdown || [] };
}

async function buildPerceptionDetails(scores, athleteData, context) {
  const base = { data_quality: context.data_quality || {} };
  const metricNames = ['Sentiment', 'Credibility', 'Likeability', 'Leadership', 'Authenticity', 'Controversy', 'Relevance'];
  const scoreKeys = ['sentimentScore', 'credibilityScore', 'likeabilityScore', 'leadershipScore', 'authenticityScore', 'controversyScore', 'relevanceScore'];
  for (let i = 0; i < metricNames.length; i++) {
    const score = scores[scoreKeys[i]] ?? 0;
    let summary = '';
    let breakdown = [];
    if (ANTHROPIC_API_KEY) {
      const result = await generateScoreExplanation(metricNames[i], score, context);
      summary = result.summary || '';
      breakdown = Array.isArray(result.breakdown) ? result.breakdown : [result.breakdown].filter(Boolean);
    }
    if (!summary) {
      const template = getTemplateExplanation(metricNames[i], score, context);
      summary = template.summary;
      breakdown = template.breakdown;
    }
    base[metricNames[i]] = { summary, breakdown };
  }
  return base;
}

async function saveHistoricalSnapshot(athleteId, dashboardData) {
  const today = new Date().toISOString().split('T')[0];
  const { data: existing } = await supabase.from('athlete_score_history').select('id').eq('athlete_id', athleteId).eq('snapshot_date', today).maybeSingle();
  if (existing) return { data: existing, error: null };
  const row = { athlete_id: athleteId, snapshot_date: today, sentiment_score: dashboardData.sentiment_score, credibility_score: dashboardData.credibility_score, likeability_score: dashboardData.likeability_score, leadership_score: dashboardData.leadership_score, authenticity_score: dashboardData.authenticity_score, controversy_score: dashboardData.controversy_score, relevance_score: dashboardData.relevance_score, twitter_followers: dashboardData.twitter_followers, instagram_followers: dashboardData.instagram_followers, news_mentions: dashboardData.total_mentions ?? dashboardData.news_articles_count ?? 0, overall_alert_level: calculateAlertLevel(dashboardData) };
  const { data, error } = await supabase.from('athlete_score_history').insert(row).select().single();
  if (error) { console.error('Snapshot error:', error.message); return { data: null, error }; }
  console.log('✅ Historical snapshot saved');
  return { data, error: null };
}

function generateTimeline(tweets, news, instagramPosts) {
  const events = [];
  (tweets || []).forEach(t => { const eng = t.likes + t.retweets + t.replies; if (eng > 500) events.push({ date: new Date(t.createdAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }), platforms: 'TWITTER', title: (t.text || '').substring(0, 100), description: `${(t.likes || 0).toLocaleString()} likes, ${(t.retweets || 0).toLocaleString()} retweets`, sentiment: t.sentiment?.sentiment || 'NEUTRAL' }); });
  (news || []).forEach(a => events.push({ date: new Date(a.publishedAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }), platforms: 'NEWS MEDIA', title: a.title, description: (a.description || a.content || '').substring(0, 200), sentiment: a.sentiment?.sentiment || 'NEUTRAL' }));
  (instagramPosts || []).slice(0, 5).forEach(p => { const ts = p.timestamp || p.takenAt || p.createdAt; if (ts) events.push({ date: new Date(ts).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }), platforms: 'INSTAGRAM', title: (p.caption || 'Instagram post').substring(0, 100), description: `${(p.likes || 0).toLocaleString()} likes, ${(p.comments || 0).toLocaleString()} comments`, sentiment: 'NEUTRAL' }); });
  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  return events.slice(0, 15);
}

async function collectAthleteData(athleteId, athleteName, twitterHandle, instagramBusinessId, country) {
  console.log('\n📊 Collecting data for', athleteName);
  try {
    console.log('🐦 Twitter...');
    const twitterProfile = await getTwitterProfile(twitterHandle);
    const tweets = await getRecentTweets(twitterHandle, 20);
    const mentions = await getTwitterMentions(twitterHandle, 20);
    console.log('📷 Instagram...');
    const hasInstagram = !!resolveInstagramUsername(instagramBusinessId);
    const instagramProfile = hasInstagram ? await getInstagramProfile(instagramBusinessId) : null;
    const instagramPosts = hasInstagram ? await getInstagramPosts(instagramBusinessId, 10) : [];
    const instagramInsights = hasInstagram ? await getInstagramInsights(instagramBusinessId) : {};
    console.log('📰 News...');
    const news = await searchNews(athleteName, 7, country);
    console.log('🤖 Sentiment...');
    const tweetSents = await Promise.all(tweets.slice(0, 10).map(t => analyzeSentiment(t.text)));
    tweets.forEach((t, i) => { if (i < 10) t.sentiment = tweetSents[i]; });
    const newsSents = await Promise.all(news.slice(0, 10).map(a => analyzeSentiment(a.title + ' ' + (a.description || ''))));
    news.forEach((a, i) => { if (i < 10) a.sentiment = newsSents[i]; });
    const athleteData = { profile: twitterProfile, tweets, mentions, instagram: { profile: instagramProfile, posts: instagramPosts, insights: instagramInsights }, news };
    const twitterOk = !!twitterProfile;
    const sentimentOk = (tweetSents.length > 0 && tweetSents.some(s => s && s.scores && (s.scores.positive + s.scores.negative) > 0)) || (newsSents.length > 0 && newsSents.some(s => s && s.scores && (s.scores.positive + s.scores.negative) > 0));
    console.log('📈 Scores...');
    const scores = calculateReputationScores(athleteData);
    const timeline = generateTimeline(tweets, news, instagramPosts);
    const twitterPos = tweetSents.filter(s => s && s.sentiment === 'POSITIVE').length;
    const twitterPctPositive = tweetSents.length ? Math.round((twitterPos / tweetSents.length) * 100) : 0;
    const newsPos = newsSents.filter(s => s && s.sentiment === 'POSITIVE').length;
    const newsNeutral = newsSents.filter(s => s && s.sentiment === 'NEUTRAL').length;
    const newsSentimentStr = newsSents.length ? `${newsPos} positive, ${newsNeutral} neutral` : 'no data';
    const claudeContext = {
      twitterPctPositive,
      twitterFollowers: (twitterProfile?.followers || 0).toLocaleString(),
      twitterMentions: mentions.length,
      instagramPctPositive: instagramPosts.length ? 70 : 0,
      instagramFollowers: (instagramProfile?.followers || 0).toLocaleString(),
      instagramPosts: instagramPosts.length,
      newsMentions: news.length,
      newsSentiment: newsSentimentStr,
      data_quality: { twitter_ok: twitterOk, sentiment_ok: sentimentOk }
    };
    console.log('📝 Generating score explanations (Claude)...');
    const perception_details = await buildPerceptionDetails(scores, athleteData, claudeContext);
    const avgInstaEng = instagramPosts.length ? Math.round(instagramPosts.reduce((s, p) => s + (p.likes || 0) + (p.comments || 0), 0) / instagramPosts.length) : 0;
    const twitterFollowerCount = twitterProfile?.followers ?? 0;
    const instagramFollowerCount = instagramProfile?.followers ?? 0;
    const totalTweetEng = tweets.reduce((s, t) => s + (t.likes || 0) + (t.retweets || 0) + (t.replies || 0), 0);
    const totalInstaEng = instagramPosts.reduce((s, p) => s + (p.likes || 0) + (p.comments || 0), 0);
    const avgEngRateTwitter = tweets.length && twitterFollowerCount > 0 ? Number(((totalTweetEng / tweets.length) / twitterFollowerCount * 100).toFixed(2)) : null;
    const avgEngRateInstagram = instagramPosts.length && instagramFollowerCount > 0 ? Number(((totalInstaEng / instagramPosts.length) / instagramFollowerCount * 100).toFixed(2)) : null;
    const avgLikesTwitter = tweets.length ? Math.round(tweets.reduce((s, t) => s + (t.likes || 0), 0) / tweets.length) : 0;
    const avgCommentsTwitter = tweets.length ? Math.round(tweets.reduce((s, t) => s + (t.replies || 0), 0) / tweets.length) : 0;
    const avgRetweets = tweets.length ? Math.round(tweets.reduce((s, t) => s + (t.retweets || 0), 0) / tweets.length) : 0;
    const avgLikesInstagram = instagramPosts.length ? Math.round(instagramPosts.reduce((s, p) => s + (p.likes || 0), 0) / instagramPosts.length) : 0;
    const avgCommentsInstagram = instagramPosts.length ? Math.round(instagramPosts.reduce((s, p) => s + (p.comments || 0), 0) / instagramPosts.length) : 0;
    const resolvedIgUsername = resolveInstagramUsername(instagramBusinessId);
    perception_details.instagram_handle = instagramProfile?.username ?? (resolvedIgUsername || null);
    perception_details.twitter_pct_positive = twitterPctPositive;
    perception_details.instagram_pct_positive = instagramPosts.length ? 70 : (twitterPctPositive || 0);
    perception_details.recent_instagram_posts = instagramPosts.slice(0, 5);
    perception_details.avg_instagram_engagement = avgInstaEng;
    perception_details.engagement_aggregates = {
      avg_engagement_rate_twitter_pct: avgEngRateTwitter,
      avg_engagement_rate_instagram_pct: avgEngRateInstagram,
      avg_likes_per_post_twitter: avgLikesTwitter,
      avg_comments_replies_twitter: avgCommentsTwitter,
      avg_retweets: avgRetweets,
      avg_likes_per_post_instagram: avgLikesInstagram,
      avg_comments_per_post_instagram: avgCommentsInstagram
    };
    // total_mentions = Twitter @mentions count + news articles count (combined social + news visibility)
    const dashboardData = {
      athlete_id: athleteId,
      athlete_name: athleteName,
      updated_at: new Date().toISOString(),
      twitter_handle: twitterHandle,
      twitter_followers: twitterProfile?.followers ?? null,
      instagram_followers: instagramProfile?.followers ?? null,
      sentiment_score: scores.sentimentScore,
      credibility_score: scores.credibilityScore,
      likeability_score: scores.likeabilityScore,
      leadership_score: scores.leadershipScore,
      authenticity_score: scores.authenticityScore,
      controversy_score: scores.controversyScore,
      relevance_score: scores.relevanceScore,
      recent_tweets: tweets.slice(0, 10),
      recent_news: news.slice(0, 10),
      timeline_events: timeline,
      total_mentions: mentions.length,
      news_articles_count: news.length,
      avg_tweet_engagement: tweets.length ? Math.round(tweets.reduce((s, t) => s + t.likes + t.retweets, 0) / tweets.length) : 0,
      perception_details,
      recent_instagram_posts: instagramPosts.slice(0, 10),
      avg_engagement_rate_twitter: avgEngRateTwitter,
      avg_engagement_rate_instagram: avgEngRateInstagram,
      avg_likes_twitter: avgLikesTwitter,
      avg_comments_retweets_twitter: avgCommentsTwitter + avgRetweets,
      avg_likes_instagram: avgLikesInstagram,
      avg_comments_instagram: avgCommentsInstagram,
      engagement_aggregates: {
        avg_engagement_rate_twitter_pct: avgEngRateTwitter,
        avg_engagement_rate_instagram_pct: avgEngRateInstagram,
        avg_likes_per_post_twitter: avgLikesTwitter,
        avg_comments_replies_twitter: avgCommentsTwitter,
        avg_retweets: avgRetweets,
        avg_likes_per_post_instagram: avgLikesInstagram,
        avg_comments_per_post_instagram: avgCommentsInstagram
      }
    };
    dashboardData.overall_alert_level = calculateAlertLevel(dashboardData);
    console.log('💾 Saving...');
    const { error } = await supabase.from('athlete_dashboards').upsert(dashboardData, { onConflict: 'athlete_id' });
    if (error) { console.error('❌ DB error:', error.message); return null; }
    console.log('✅ Dashboard updated');
    await saveHistoricalSnapshot(athleteId, dashboardData);
    return dashboardData;
  } catch (e) { console.error('❌ Error:', e); return null; }
}

app.get('/api/health', (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));
// List athletes from master table (use this to get athleteId for /api/athlete/refresh when you don't have dashboard access)
app.get('/api/athletes/list', async (req, res) => {
  try {
    const { data, error } = await supabase.from('athletes').select('id, name, twitter_handle, instagram_business_id').eq('active', true).order('name');
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Create a new athlete (for seeding / testing via Postman)
app.post('/api/athletes', async (req, res) => {
  const { name, twitter_handle, instagram_business_id, sport, team, position, age } = req.body;
  if (!name || !twitter_handle) return res.status(400).json({ error: 'Missing required fields: name, twitter_handle' });
  try {
    const row = { name, twitter_handle, instagram_business_id: instagram_business_id || null, sport: sport || 'Football', team: team || null, position: position || null, age: age != null ? parseInt(age, 10) : null };
    const { data, error } = await supabase.from('athletes').insert(row).select('id, name, twitter_handle, instagram_business_id, sport, team, position, age').single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/athlete/:athleteId', async (req, res) => {
  try {
    const { data: dashboard, error } = await supabase.from('athlete_dashboards').select('*').eq('athlete_id', req.params.athleteId).single();
    if (error) throw error;
    if (!dashboard) { res.json(null); return; }
    const { data: athlete } = await supabase.from('athletes').select('instagram_business_id').eq('id', req.params.athleteId).maybeSingle();
    const payload = { ...dashboard };
    if (athlete?.instagram_business_id && !payload.perception_details?.instagram_handle) {
      payload.perception_details = { ...(payload.perception_details || {}), instagram_handle: athlete.instagram_business_id };
    }
    res.json(payload);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/athlete/:athleteId/history/:days', async (req, res) => {
  try {
    const daysNum = Math.min(30, Math.max(1, parseInt(req.params.days, 10) || 7));
    const fromStr = new Date(Date.now() - daysNum * 86400000).toISOString().split('T')[0];
    const { data, error } = await supabase.from('athlete_score_history').select('*').eq('athlete_id', req.params.athleteId).gte('snapshot_date', fromStr).order('snapshot_date', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/athlete/refresh', async (req, res) => {
  const { athleteId, athleteName, twitterHandle, instagramBusinessId, instagramUsername, userName, country } = req.body;
  if (!athleteId || !athleteName || !twitterHandle) return res.status(400).json({ error: 'Missing required fields: athleteId, athleteName, twitterHandle' });
  // Prefer athletes table as source of truth so Instagram username from DB is used (dashboard may have stale/null)
  let instagramId = instagramUsername ?? userName ?? instagramBusinessId ?? null;
  let useName = athleteName;
  let useTwitter = twitterHandle;
  let useCountry = country;
  try {
    const { data: athleteRow } = await supabase.from('athletes').select('instagram_business_id, twitter_handle, name, country').eq('id', athleteId).maybeSingle();
    if (athleteRow) {
      if (athleteRow.instagram_business_id != null && String(athleteRow.instagram_business_id).trim() !== '') {
        instagramId = athleteRow.instagram_business_id;
      }
      if (athleteRow.twitter_handle != null && String(athleteRow.twitter_handle).trim() !== '') useTwitter = athleteRow.twitter_handle;
      if (athleteRow.name != null && String(athleteRow.name).trim() !== '') useName = athleteRow.name;
      if (athleteRow.country != null && String(athleteRow.country).trim() !== '') useCountry = athleteRow.country;
    }
  } catch (_) { /* use body values */ }
  try {
    const data = await collectAthleteData(athleteId, useName, useTwitter, instagramId, useCountry);
    res.json({ success: !!data, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/athletes', async (req, res) => {
  try {
    const { data, error } = await supabase.from('athlete_dashboards').select('*').order('updated_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Daily job (used by in-process cron and by HTTP trigger for production) ---
// When: in-process cron at 06:00 server time (0 6 * * *). Same logic as POST /api/athlete/refresh (Apify Twitter/Instagram, News, Sentiment).
async function runDailyUpdate() {
  console.log('\n🔄 DAILY UPDATE');
  try {
    const { data: athletes, error } = await supabase.from('athletes').select('*').eq('active', true);
    if (error) throw error;
    for (const a of athletes || []) {
      await collectAthleteData(a.id, a.name, a.twitter_handle, a.instagram_business_id, a.country);
      await new Promise(r => setTimeout(r, 5000));
    }
    console.log('✅ Daily update done');
    return { success: true, updated: (athletes || []).length };
  } catch (e) {
    console.error('❌ Daily update failed:', e);
    throw e;
  }
}

// In-process cron: runs daily at 06:00 server time (same Apify/Instagram logic as manual refresh)
cron.schedule('0 6 * * *', runDailyUpdate);

// HTTP-triggered cron: for production hosts that sleep (e.g. Render). Call from cron-job.org or similar.
// Secured by CRON_SECRET in env. Example: GET /api/cron/daily?secret=your-secret
app.get('/api/cron/daily', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.query.secret !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await runDailyUpdate();
    res.json(result);
  } catch (e) {
    const msg = e.message || String(e);
    const hint = (msg.includes('ENOTFOUND') || msg.includes('fetch failed')) && process.env.SUPABASE_URL
      ? ' Check SUPABASE_URL in .env (use https://your-project.supabase.co from Supabase Dashboard → Project Settings → API).'
      : '';
    res.status(500).json({ error: msg + hint });
  }
});

app.listen(PORT, () => {
  console.log('\n🚀 Blue & Lintell Backend on port', PORT);
  console.log('   GET /api/health  GET /api/athletes/list  POST /api/athletes  GET /api/athlete/:id  GET /api/athlete/:id/history/:days  POST /api/athlete/refresh  GET /api/athletes  GET /api/cron/daily\n');
});

module.exports = app;

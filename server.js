// BLUE & LINTELL - ATHLETE DASHBOARD BACKEND
// Version: 2.0 - Enhanced Scoring + Career Profile + Controversy Classification
// Changes from v1:
//   - Credibility: now weighted by news source authority (BBC vs tabloid)
//   - Likeability: engagement RATE not raw engagement, no artificial floor
//   - Controversy: category classification + time decay (sporting ≠ conduct)
//   - Leadership: Claude-derived from news/tweets analysis + career profile
//   - Authenticity: Claude-derived from consistency analysis
//   - Influence: properly built (reach + engagement quality + career authority)
//   - Composite score: single headline number combining all dimensions
//   - Sponsor Readiness: traffic-light indicator for commercial conversations
//   - Career profile: onboarding endpoint captures caps, honours, club level

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
  console.warn('⚠️ SUPABASE_URL should start with https://');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const comprehendClient = new ComprehendClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const APIFY_TOKEN = process.env.APIFY_API_TOKEN || '';
if (!APIFY_TOKEN) {
  console.warn('⚠️ APIFY_API_TOKEN is missing. Twitter and Instagram data collection will fail.');
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_VERSION = '2023-06-01';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// ==================== UTILITIES ====================

function logApiError(prefix, e) {
  const status = e.response?.status;
  const body = e.response?.data;
  if (status != null || body != null) {
    console.error(prefix, status != null ? `status ${status}` : '', body != null ? JSON.stringify(body) : e.message);
  } else {
    console.error(prefix, e.message);
  }
}

// ==================== APIFY ====================

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

// ==================== TWITTER (Apify) ====================

const APIFY_TWEET_SCRAPER = 'apidojo~tweet-scraper';

async function getTwitterProfile(username) {
  const handle = username.replace('@', '');
  const items = await apifyRunSync(APIFY_TWEET_SCRAPER, {
    startUrls: [`https://twitter.com/${handle}`],
    maxItems: 5,
    sort: 'Latest'
  }, { timeout: 90 });
  if (!items.length) return null;
  const first = items[0];
  const isUserObj = first.type === 'user' || (first.followers != null && first.full_text == null && first.text == null);
  const user = isUserObj ? first : (first.user ?? first.author ?? first);
  const followersRaw = user.followers_count ?? user.public_metrics?.followers_count ?? user.followers ?? user.followersCount ?? 0;
  const followingRaw = user.following_count ?? user.public_metrics?.following_count ?? user.following ?? user.followingCount ?? 0;
  return {
    username: user.userName ?? user.username ?? user.screen_name ?? handle,
    name: user.name ?? user.username ?? user.userName ?? handle,
    followers: typeof followersRaw === 'number' ? followersRaw : parseInt(followersRaw, 10) || 0,
    following: typeof followingRaw === 'number' ? followingRaw : parseInt(followingRaw, 10) || 0,
    verified: user.isBlueVerified ?? user.verified ?? user.verified_user ?? false,
    bio: user.description ?? user.bio ?? '',
    profileImage: user.profilePicture ?? user.profile_image_url_https ?? user.profile_image_url ?? user.avatar ?? null
  };
}

async function getRecentTweets(username, count = 20) {
  const handle = username.replace('@', '');
 const items = await apifyRunSync(APIFY_TWEET_SCRAPER, {
    startUrls: [`https://twitter.com/${handle}`],
    maxItems: Math.min(count, 100),
    sort: 'Latest'
  }, { timeout: 120 });
  const list = Array.isArray(items) ? items : [];
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
    likes: Number(t.likeCount ?? t.likes ?? t.favorite_count ?? t.like_count ?? 0) || 0,
    retweets: Number(t.retweetCount ?? t.retweets ?? t.retweet_count ?? 0) || 0,
    replies: Number(t.replyCount ?? t.replies ?? t.reply_count ?? 0) || 0,
    views: Number(t.viewCount ?? t.views ?? t.view_count ?? 0) || 0
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

// ==================== INSTAGRAM (Apify) ====================

const APIFY_INSTAGRAM_SCRAPER = 'apify~instagram-profile-scraper';

function resolveInstagramUsername(instagramBusinessId) {
  const fromAthlete = (instagramBusinessId && String(instagramBusinessId).trim()) || '';
  const fromEnv = (process.env.INSTAGRAM_USER_ID && String(process.env.INSTAGRAM_USER_ID).trim()) || '';
  const v = fromAthlete || fromEnv;
  const raw = v.replace('@', '').trim();
  if (!raw) return '';
  const urlMatch = raw.match(/instagram\.com\/([^/?]+)/i);
  const candidate = urlMatch ? urlMatch[1] : raw;
  const isNumericId = /^\d+$/.test(candidate);
  if (isNumericId) {
    console.warn(`⚠️ Instagram skipped: numeric ID found. Apify needs username.`);
    return '';
  }
  return candidate;
}

async function getInstagramProfile(instagramBusinessId) {
  const username = resolveInstagramUsername(instagramBusinessId);
  if (!username) return null;
  try {
    const items = await apifyRunSync(APIFY_INSTAGRAM_SCRAPER, { usernames: [username] }, { timeout: 120 });
    const raw = items && items[0] ? items[0] : null;
    if (!raw) { console.warn('📷 Instagram: no items for', username); return null; }
    const followersRaw = raw.followersCount ?? raw.followers ?? raw.edge_followed_by?.count ?? 0;
    const followingRaw = raw.followsCount ?? raw.following ?? raw.edge_follow ?? 0;
    const profile = {
      username: raw.username ?? raw.fullName ?? username,
      name: raw.fullName ?? raw.full_name ?? raw.username ?? username,
      followers: typeof followersRaw === 'number' ? followersRaw : parseInt(followersRaw, 10) || 0,
      following: typeof followingRaw === 'number' ? followingRaw : parseInt(followingRaw, 10) || 0,
      posts: raw.postsCount ?? raw.mediaCount ?? raw.edge_owner_to_timeline_media?.count ?? 0,
      bio: raw.biography ?? raw.bio ?? '',
      profileImage: raw.profilePicUrl ?? raw.profilePicUrlHD ?? null
    };
    if (profile.followers > 0) console.log('📷 Instagram OK:', profile.username, profile.followers, 'followers');
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
    const items = await apifyRunSync(APIFY_INSTAGRAM_SCRAPER, { usernames: [username] }, { timeout: 120 });
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
    const items = await apifyRunSync(APIFY_INSTAGRAM_SCRAPER, { usernames: [username] }, { timeout: 120 });
    const raw = items && items[0] ? items[0] : null;
    if (!raw) return {};
    return { impressions: raw.impressions ?? null, reach: raw.reach ?? null, profile_views: raw.profileViews ?? null };
  } catch (e) {
    return {};
  }
}

// ==================== NEWS ====================

async function searchNews(athleteName, daysBack = 7, country, sport = 'football') {
  try {
    const q = (athleteName || '').trim();
    if (q.length < 3) return [];
    const searchQuery = sport ? `${q} ${sport}` : q;
    const res = await axios.get('https://newsdata.io/api/1/news', {
      params: {
        apikey: process.env.NEWSDATA_API_KEY,
        q: searchQuery,
        language: 'en',
        ...(country ? { country } : {})
      }
    });
    return (res.data.results || []).map(a => ({
      title: a.title, description: a.description, content: a.content,
      url: a.link, source: a.source_id, publishedAt: a.pubDate,
      imageUrl: a.image_url, category: a.category, sentiment: a.sentiment
    }));
  } catch (e) {
    logApiError('News search error:', e);
    return [];
  }
}

const NEWSAPI_KEY = process.env.NEWSAPI_KEY || '';
let newsApiRequestCount = 0;
const NEWS_API_DAILY_LIMIT = 100;

async function searchNewsAPI(athleteName, daysBack = 30) {
  if (!NEWSAPI_KEY) {
    console.log('⚠️  NewsAPI.org key not set - skipping tabloid search.');
    return [];
  }
  if (newsApiRequestCount >= NEWS_API_DAILY_LIMIT) {
    console.warn(`⚠️  NewsAPI.org daily limit reached.`);
    return [];
  }
  try {
    const q = (athleteName || '').trim();
    if (q.length < 3) return [];
    const from = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];
    const to = new Date().toISOString().split('T')[0];
    newsApiRequestCount++;
    console.log(`📰 NewsAPI.org request ${newsApiRequestCount}/${NEWS_API_DAILY_LIMIT}`);
    const res = await axios.get('https://newsapi.org/v2/everything', {
      params: { apiKey: NEWSAPI_KEY, q, language: 'en', from, to, sortBy: 'publishedAt', pageSize: 20 },
      timeout: 10000
    });
    if (res.data.status === 'ok' && res.data.articles) {
      return res.data.articles.map(a => ({
        title: a.title, description: a.description, content: a.content,
        url: a.url, source: a.source?.name || 'Unknown', publishedAt: a.publishedAt,
        imageUrl: a.urlToImage, category: ['sports'], sentiment: null
      }));
    }
    return [];
  } catch (e) {
    if (e.response?.status === 429) console.error('⚠️  NewsAPI.org rate limit hit!');
    else logApiError('NewsAPI.org error:', e);
    return [];
  }
}

// ==================== SENTIMENT (AWS) ====================

const NEUTRAL_FALLBACK = { sentiment: 'NEUTRAL', scores: { positive: 0, negative: 0, neutral: 1, mixed: 0 } };

async function analyzeSentiment(text, languageCode = 'en') {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed || trimmed.length < 1) return NEUTRAL_FALLBACK;
  try {
    const cmd = new DetectSentimentCommand({ Text: trimmed.substring(0, 5000), LanguageCode: languageCode });
    const res = await comprehendClient.send(cmd);
    return {
      sentiment: res.Sentiment,
      scores: { positive: res.SentimentScore.Positive, negative: res.SentimentScore.Negative, neutral: res.SentimentScore.Neutral, mixed: res.SentimentScore.Mixed }
    };
  } catch (e) {
    if (e.message && e.message.includes('subscription')) {
      console.error('Sentiment error: AWS Comprehend not enabled for this account.');
    } else {
      console.error('Sentiment error:', e.message);
    }
    return NEUTRAL_FALLBACK;
  }
}

function calculateOverallSentiment(sentimentResults) {
  const valid = (sentimentResults || []).filter(r => r && r.scores);
  if (valid.length === 0) return 50;
  let total = 0;
  valid.forEach(r => { total += (r.scores.positive * 100) + (r.scores.neutral * 50) + (r.scores.negative * 0) + (r.scores.mixed * 50); });
  return Math.round(total / valid.length);
}

// ==================== NEWS SOURCE AUTHORITY ====================
// Weights how much a news mention moves the Credibility score.
// Add sources as you encounter them. Key: lowercase, letters only.

const NEWS_SOURCE_AUTHORITY = {
  // Tier 1 - High authority (1.0)
  'bbcsport': 1.0, 'bbc': 1.0, 'theguardian': 1.0, 'guardian': 1.0,
  'skysports': 1.0, 'theathletic': 1.0, 'athletic': 1.0,
  'telegraph': 1.0, 'times': 1.0, 'sundaytimes': 1.0,
  'independent': 0.9, 'espn': 0.9, 'fourfourtwo': 0.9,
  // Tier 2 - Mid authority (0.6)
  'mirror': 0.6, 'goal': 0.6, 'talksport': 0.6, 'eurosport': 0.6, 'sportbible': 0.5,
  // Tier 3 - Tabloid (0.2)
  'thesun': 0.2, 'dailymail': 0.2, 'dailystar': 0.2, 'express': 0.2
};
const DEFAULT_SOURCE_WEIGHT = 0.4;

function getSourceAuthority(sourceId) {
  if (!sourceId) return DEFAULT_SOURCE_WEIGHT;
  const key = sourceId.toLowerCase().replace(/[^a-z]/g, '');
  if (NEWS_SOURCE_AUTHORITY[key]) return NEWS_SOURCE_AUTHORITY[key];
  for (const [pattern, weight] of Object.entries(NEWS_SOURCE_AUTHORITY)) {
    if (key.includes(pattern) || pattern.includes(key)) return weight;
  }
  return DEFAULT_SOURCE_WEIGHT;
}

// ==================== CONTROVERSY CLASSIFICATION ====================
// Categories control how much weight an incident carries in the score.
// SPORTING incidents (match results, CL exits) now carry only 15% weight —
// this is what was inflating Trippier's score unfairly.

const CONTROVERSY_CATEGORIES = {
  CONDUCT:            { weight: 1.0,  description: 'Personal conduct' },
  PROFESSIONAL:       { weight: 0.4,  description: 'Professional incident' },
  MEDIA_SPECULATION:  { weight: 0.2,  description: 'Media speculation' },
  SPORTING:           { weight: 0.15, description: 'Sporting event' }
};

const CONDUCT_KEYWORDS = [
  'arrest', 'assault', 'charged', 'convicted', 'gambling', 'drugs',
  'drunk', 'alcohol', 'affair', 'divorce', 'abuse', 'doping',
  'suspended', 'nightclub', 'onlyfans', 'leaked', 'racist', 'sexist',
  'violence', 'lawsuit', 'court', 'police', 'investigation', 'misconduct'
];

const SPORTING_KEYWORDS = [
  'defeat', 'loss', 'lost', 'backfired', 'tactical', 'champions league',
  'relegated', 'eliminated', 'knocked out', 'penalty miss', 'own goal',
  'red card', 'injury', 'substituted', 'dropped', 'form', 'performance'
];

const PROFESSIONAL_KEYWORDS = [
  'transfer', 'contract', 'agent', 'dispute', 'wages', 'fell out',
  'training ground', 'disciplinary', 'fined', 'warning', 'manager row'
];

function suggestControversyCategory(text) {
  const lower = (text || '').toLowerCase();
  const conductMatches = CONDUCT_KEYWORDS.filter(k => lower.includes(k)).length;
  const sportingMatches = SPORTING_KEYWORDS.filter(k => lower.includes(k)).length;
  const professionalMatches = PROFESSIONAL_KEYWORDS.filter(k => lower.includes(k)).length;
  if (conductMatches >= sportingMatches && conductMatches >= professionalMatches && conductMatches > 0) return 'CONDUCT';
  if (sportingMatches >= professionalMatches && sportingMatches > 0) return 'SPORTING';
  if (professionalMatches > 0) return 'PROFESSIONAL';
  return 'MEDIA_SPECULATION';
}

// ==================== TIME DECAY ====================
// Incidents lose weight over time. Conduct decays slowly (reputation matters long-term).
// Sporting incidents decay fast — a bad match result is old news within weeks.

function getTimeDecayMultiplier(incidentDate, category) {
  const daysSince = Math.floor((Date.now() - new Date(incidentDate).getTime()) / 86400000);
  if (category === 'CONDUCT') {
    if (daysSince <= 7)   return 1.0;   // Full impact first week
    if (daysSince <= 14)  return 0.75;  // 75% — still live in media cycle
    if (daysSince <= 21)  return 0.50;  // 50% — fading
    if (daysSince <= 30)  return 0.30;  // 30% — old news
    if (daysSince <= 90)  return 0.15;  // 15% — historical footnote
    if (daysSince <= 180) return 0.08;
    if (daysSince <= 365) return 0.03;
    return 0.01;
  }
  if (category === 'SPORTING' || category === 'PROFESSIONAL') {
    if (daysSince <= 14)  return 1.0;
    if (daysSince <= 30)  return 0.60;
    if (daysSince <= 60)  return 0.30;
    if (daysSince <= 90)  return 0.15;
    return 0.05;
  }
  // MEDIA_SPECULATION decays fastest
  if (daysSince <= 7)   return 1.0;
  if (daysSince <= 14)  return 0.50;
  if (daysSince <= 30)  return 0.20;
  return 0.05;
}

// ==================== CAREER AUTHORITY SCORE ====================
// Stable component of Influence — set once at onboarding, updated on milestones.
// Trippier (54 caps, 2 World Cups, Atletico, ~10 elite years) would score ~78.
// A 19-year-old with no caps would score ~30. This feels real-world correct.

function calculateCareerAuthorityScore(careerProfile) {
  if (!careerProfile) return 40; // Default for unknown athletes

  let score = 0;

  // International caps (max 30 pts) — log scale so 100 caps ≠ 10x better than 10 caps
  const caps = careerProfile.international_caps || 0;
  score += Math.min(30, Math.round(Math.sqrt(caps) * 3));

  // Tournament appearances (max 20 pts)
  const worldCups = (careerProfile.world_cup_appearances || 0) * 8;
  const majorTournaments = (careerProfile.major_tournament_appearances || 0) * 5;
  const minorTournaments = (careerProfile.minor_tournament_appearances || 0) * 2;
  score += Math.min(20, worldCups + majorTournaments + minorTournaments);

  // Club pedigree (max 20 pts)
  const clubLevelScores = {
    'champions_league_regular': 20, 'champions_league_occasional': 16,
    'top6_premier_league': 15, 'premier_league': 10,
    'championship': 5, 'league_one': 2, 'other': 1
  };
  score += clubLevelScores[careerProfile.highest_club_level || 'premier_league'] || 5;

  // Career longevity (max 15 pts)
  const eliteYears = careerProfile.years_at_elite_level || 1;
  score += Math.min(15, Math.round(eliteYears * 1.5));

  // Honours (max 15 pts)
  score += Math.min(15, (careerProfile.major_honours || 0) * 3);

  return Math.min(100, Math.round(score));
}

// ==================== FETCH CAREER PROFILE ====================

async function getCareerProfile(athleteId) {
  try {
    const { data, error } = await supabase
      .from('athlete_career_profiles')
      .select('*')
      .eq('athlete_id', athleteId)
      .single();
    if (error) return null;
    return data;
  } catch (e) {
    return null;
  }
}

// ==================== CONTROVERSY SCORE (NEW) ====================
// Replaces the old brand-risk-keyword-count approach.
// Manual incidents (stored in athlete_controversies table) are primary signal.
// Automated sentiment is secondary and filtered by context.

async function calculateControversyScore(athleteId, allSentiments, news, manualIncidentsLegacy) {
  // --- Manual incidents (new table first, legacy fallback) ---
  let manualIncidents = [];
  let incidentBreakdown = [];
  let manualScore = 0;

  try {
    const { data } = await supabase
      .from('athlete_controversies')
      .select('*')
      .eq('athlete_id', athleteId)
      .order('incident_date', { ascending: false });

    if (data && data.length > 0) {
      manualIncidents = data;
    } else if (manualIncidentsLegacy && manualIncidentsLegacy.length > 0) {
      // Fall back to legacy incidents stored in athletes table
      // Convert legacy format to new format for scoring
      manualIncidents = manualIncidentsLegacy.map(i => ({
        description: i.title,
        severity: i.severity || 'medium',
        category: suggestControversyCategory(i.title),
        incident_date: i.date || new Date().toISOString()
      }));
    }
  } catch (e) {
    // New table may not exist yet — fall back to legacy
    if (manualIncidentsLegacy && manualIncidentsLegacy.length > 0) {
      manualIncidents = manualIncidentsLegacy.map(i => ({
        description: i.title,
        severity: i.severity || 'medium',
        category: suggestControversyCategory(i.title),
        incident_date: i.date || new Date().toISOString()
      }));
    }
  }

  for (const incident of manualIncidents) {
    const category = incident.category || 'CONDUCT';
    const categoryWeight = CONTROVERSY_CATEGORIES[category]?.weight || 1.0;
    const timeDecay = getTimeDecayMultiplier(incident.incident_date, category);
    const baseSeverity = { low: 8, medium: 16, high: 24 }[incident.severity] || 16;
    const weightedScore = baseSeverity * categoryWeight * timeDecay;
    manualScore += weightedScore;
    incidentBreakdown.push({
      description: incident.description,
      category: CONTROVERSY_CATEGORIES[category]?.description,
      severity: incident.severity,
      daysAgo: Math.floor((Date.now() - new Date(incident.incident_date)) / 86400000),
      contribution: Math.round(weightedScore)
    });
  }

  // --- Automated sentiment signal (filtered by context) ---
  const validS = (allSentiments || []).filter(s => s && s.scores);
  let automatedControversy = 0;

  const negativeNews = (news || []).filter(n => n.sentiment?.sentiment === 'NEGATIVE');
  for (const article of negativeNews) {
    const text = ((article.title || '') + ' ' + (article.description || '')).toLowerCase();
    const isSporting = SPORTING_KEYWORDS.some(k => text.includes(k));
    const isConduct = CONDUCT_KEYWORDS.some(k => text.includes(k));
    const authority = getSourceAuthority(article.source);
    if (isConduct)       automatedControversy += 3 * authority;
    else if (isSporting) automatedControversy += 0.5 * authority; // Heavily discounted
    else                 automatedControversy += 1 * authority;
  }

  // Manual incidents are primary (70%), automated sentiment secondary (30%)
  const rawScore = (manualScore * 0.7) + (automatedControversy * 0.3);
  const controversyScore = Math.min(100, Math.round(rawScore));

  if (manualIncidents.length > 0) {
    console.log(`⚠️  Controversy: ${controversyScore} (${manualIncidents.length} incidents, automated: ${Math.round(automatedControversy)})`);
  }

  return {
    score: controversyScore,
    breakdown: incidentBreakdown,
    hasManualIncidents: manualIncidents.length > 0,
    dominantCategory: incidentBreakdown.length > 0 ? incidentBreakdown[0].category : 'None logged'
  };
}

// ==================== TWITTER SCANDAL DETECTION (kept from v1) ====================

function scanTwitterForScandals(tweets, brandRiskKeywords) {
  const scandalSignals = [];
  (tweets || []).forEach(tweet => {
    const text = (tweet.text || '').toLowerCase();
    const matchedKeywords = brandRiskKeywords.filter(k => text.includes(k.toLowerCase()));
    if (matchedKeywords.length > 0) {
      scandalSignals.push({
        text: tweet.text, keywords: matchedKeywords,
        likes: tweet.likes || 0, retweets: tweet.retweets || 0,
        date: tweet.createdAt, engagement: (tweet.likes || 0) + (tweet.retweets || 0)
      });
    }
  });
  scandalSignals.sort((a, b) => b.engagement - a.engagement);
  return scandalSignals.slice(0, 5);
}

// ==================== MAIN SCORE CALCULATION ====================

async function calculateReputationScores(athleteData, athleteId, careerProfile) {
  const { tweets, mentions, news, instagram, profile, manualIncidents } = athleteData;

  // --- SENTIMENT ---
  // Tweets weighted 60%, news 40% (news carries more reputational weight)
  const tweetSentiments = (tweets || []).map(t => t.sentiment).filter(Boolean);
  const newsSentiments = (news || []).map(n => n.sentiment).filter(Boolean);
  const tweetSentimentScore = calculateOverallSentiment(tweetSentiments);
  const newsSentimentScore = calculateOverallSentiment(newsSentiments);
  const sentimentScore = Math.round((tweetSentimentScore * 0.6) + (newsSentimentScore * 0.4));

  // --- CREDIBILITY ---
  // Old: verified(30) + log(followers)*10 + news.length*2 → this was fame, not credibility
  // New: weighted by source authority — BBC moves the needle, The Sun barely does
  let credibilitySignal = 0;
  let totalAuthorityWeight = 0;
  for (const article of (news || [])) {
    const authority = getSourceAuthority(article.source);
    const sentimentValue = article.sentiment?.sentiment === 'POSITIVE' ? 1 :
                           article.sentiment?.sentiment === 'NEGATIVE' ? -0.5 : 0.3;
    credibilitySignal += authority * sentimentValue;
    totalAuthorityWeight += authority;
  }
  const verificationBonus = profile?.verified ? 15 : 0;
  const newsCredibility = totalAuthorityWeight > 0
    ? Math.max(0, Math.min(70, Math.round(((credibilitySignal / totalAuthorityWeight) + 1) * 35)))
    : 35;
  const rawCredibility = newsCredibility + verificationBonus;
  const credibilityScore = Math.min(85, Math.max(0, rawCredibility));
  // Cap at 85 — nobody has perfect press coverage
  console.log(`📊 Credibility: newsCredibility=${newsCredibility} verificationBonus=${verificationBonus} raw=${rawCredibility} final=${credibilityScore}`);

  // --- LIKEABILITY ---
  // Old: raw engagement / 100, floored at 60 (meaningless)
  // New: engagement RATE — 50k followers + 8% engagement > 2m followers + 0.1%
  const twitterFollowers = Math.max(1, profile?.followers || 1);
  const instagramFollowers = Math.max(1, instagram?.profile?.followers || 1);
  const twitterEng = (tweets || []).reduce((s, t) => s + (t.likes + t.retweets + t.replies), 0);
  const instaPosts = instagram?.posts || [];
  const instaEng = instaPosts.reduce((s, p) => s + (p.likes + p.comments), 0);
  const twitterEngRate = tweets?.length ? (twitterEng / tweets.length) / twitterFollowers * 100 : 0;
  const instaEngRate = instaPosts.length ? (instaEng / instaPosts.length) / instagramFollowers * 100 : 0;
  const avgEngagementRate = (twitterEngRate + instaEngRate) / 2;

  // Industry benchmarks: >3% excellent, 1-3% good, 0.3-1% average
  let likeabilityBase;
  if (avgEngagementRate >= 5)        likeabilityBase = 85;
  else if (avgEngagementRate >= 3)   likeabilityBase = 78;
  else if (avgEngagementRate >= 1)   likeabilityBase = 70;
  else if (avgEngagementRate >= 0.5) likeabilityBase = 63;
  else if (avgEngagementRate >= 0.3) likeabilityBase = 57;
  else                               likeabilityBase = 50;

  // Blend with sentiment — genuine likeability shows in both engagement AND tone
  const likeabilityScore = Math.min(85, Math.round((likeabilityBase * 0.7) + (sentimentScore * 0.3)));
  // No artificial floor — if it drops below 50 that's important information

  // --- CONTROVERSY (new system) ---
  const controversyData = await calculateControversyScore(athleteId, [...tweetSentiments, ...newsSentiments], news, manualIncidents);
  const controversyScore = controversyData.score;

  // Keep brandRiskArticles for backward compat with existing Claude prompts
  const brandRiskKeywords = [
    'divorce', 'affair', 'onlyfans', 'escort', 'assault', 'arrested', 'charged',
    'banned', 'suspended', 'drugs', 'cocaine', 'drunk', 'gambling', 'fraud',
    'racist', 'homophobic', 'sexual misconduct', 'court', 'lawsuit', 'scandal'
  ];
  const brandRiskArticles = [];
  (news || []).forEach(article => {
    const content = ((article.title || '') + ' ' + (article.description || '')).toLowerCase();
    const matched = brandRiskKeywords.filter(k => content.includes(k));
    if (matched.length > 0) brandRiskArticles.push({ title: article.title, source: article.source, keywords: matched, date: article.publishedAt, detectSource: 'news' });
  });
  const twitterScandals = scanTwitterForScandals(mentions || [], brandRiskKeywords);
  twitterScandals.filter(t => t.engagement >= 100).slice(0, 3).forEach(s => {
    brandRiskArticles.push({ title: s.text.substring(0, 100), source: 'Twitter', keywords: s.keywords, date: s.date, detectSource: 'twitter' });
  });

  // --- RELEVANCE ---
  // Keeping existing approach, removing artificial square root cap push
  const relevanceScore = Math.min(90, Math.round(
    (Math.sqrt((mentions || []).length) * 7) +
    (Math.sqrt((news || []).length) * 9) +
    (instagram?.insights?.impressions ? Math.log10(instagram.insights.impressions) * 5 : 0)
  ));

  // --- INFLUENCE (new) ---
  // 40% reach + 30% engagement quality + 30% career authority
  const totalFollowers = twitterFollowers + instagramFollowers;
  const reachScore = Math.min(100, Math.round(Math.log10(Math.max(1, totalFollowers)) * 14));
  const engagementQualityScore = Math.min(100,
    avgEngagementRate >= 5 ? 85 : avgEngagementRate >= 3 ? 75 :
    avgEngagementRate >= 1 ? 65 : avgEngagementRate >= 0.5 ? 55 : 45
  );
  const careerAuthorityScore = calculateCareerAuthorityScore(careerProfile);
  const influenceScore = Math.min(90, Math.round(
    (reachScore * 0.40) + (engagementQualityScore * 0.30) + (careerAuthorityScore * 0.30)
  ));

  // --- LEADERSHIP & AUTHENTICITY ---
  // These are set to null here — generated by Claude in buildPerceptionDetails
  // The existing per-score commentary already calls generateScoreExplanation for these.
  // We'll generate proper Claude-derived scores in the enhanced explanation flow.
  const leadershipScore = null;
  const authenticityScore = null;

  // --- COMPOSITE SCORE ---
  // Single headline number. Excludes Leadership/Authenticity until Claude has scored them.
  const compositeScore = Math.round(
    (sentimentScore    * 0.20) +
    (credibilityScore  * 0.15) +
    (likeabilityScore  * 0.15) +
    (Math.max(0, 100 - controversyScore) * 0.20) + // Inverse — high controversy hurts
    (relevanceScore    * 0.15) +
    (influenceScore    * 0.15)
  );

  // --- SPONSOR READINESS ---
  const sponsorScore = Math.round(
    (sentimentScore             * 0.25) +
    (Math.max(0, 100 - controversyScore) * 0.35) +
    (likeabilityScore           * 0.25) +
    (credibilityScore           * 0.15)
  );
  let sponsorReadiness;
  if (sponsorScore >= 70 && controversyScore < 25) {
    sponsorReadiness = { rating: 'GREEN', label: 'Sponsor Ready', summary: 'Profile presents low risk and strong commercial appeal.' };
  } else if (sponsorScore >= 55 || controversyScore < 40) {
    sponsorReadiness = { rating: 'AMBER', label: 'Proceed with Caution', summary: 'Some areas require monitoring before committing to long-term partnerships.' };
  } else {
    sponsorReadiness = { rating: 'RED', label: 'High Risk', summary: 'Current profile carries significant reputational risk for brand partners.' };
  }

  return {
    sentimentScore,
    credibilityScore,
    likeabilityScore,
    leadershipScore,
    authenticityScore,
    controversyScore,
    relevanceScore,
    influenceScore,
    compositeScore,
    sponsorReadiness,
    brandRiskArticles,
    // Metadata for Claude prompts
    scoringMetadata: {
      controversy: controversyData,
      engagementRate: avgEngagementRate.toFixed(2),
      careerAuthorityScore,
      reachScore
    }
  };
}

// ==================== ALERT LEVEL ====================

function calculateAlertLevel(data) {
  const s = data.sentiment_score ?? 70;
  const c = data.controversy_score ?? 30;
  if (s < 50 || c > 40) return 'critical';
  if (s < 60 || c > 30) return 'elevated';
  return 'nominal';
}

// ==================== CLAUDE: SCORE EXPLANATIONS ====================
// These prompts are your existing ones — they already produce excellent output.
// Leadership and Authenticity now get a richer prompt that uses career context.

async function generateScoreExplanation(metricName, score, context, athleteName, careerProfile, rollingAvg = null, divergence = null) {
  if (!ANTHROPIC_API_KEY) return { summary: '', breakdown: [] };

  const newsHeadlines = (context.recentNewsHeadlines || []).slice(0, 5).map((a, i) =>
    `${i + 1}. "${a.title}" (${a.source}, ${a.date})`
  ).join('\n') || 'No recent news articles available.';

  const recentTweets = (context.recentTweets || []).slice(0, 5).map((t, i) =>
    `${i + 1}. "${t.text}" (${t.likes} likes, ${t.retweets} retweets, ${t.date})`
  ).join('\n') || 'No recent tweets available.';

  const careerContext = careerProfile
    ? `Career context: ${careerProfile.international_caps || 0} international caps for ${careerProfile.national_team || 'national team'}, ` +
      `${careerProfile.world_cup_appearances || 0} World Cup(s), ` +
      `${careerProfile.years_at_elite_level || 0} years at elite level, ` +
      `${careerProfile.major_honours || 0} major honours, ` +
      `current club level: ${careerProfile.highest_club_level || 'premier_league'}.`
    : '';

  const scoreGuidance = {
    'Sentiment': `Measures EMOTIONAL TONE — how people feel about the athlete. Focus on: positive/negative language in tweets and headlines, fan emotional reactions, praise vs criticism. Distinguish from Credibility: Sentiment is about FEELINGS, not facts.`,

    'Credibility': `Measures TRUST & AUTHORITY — how believable and authoritative the athlete is perceived. Focus on: tier-1 media coverage (BBC, Times, Athletic vs tabloids), expert opinions, institutional recognition. Distinguish: Credibility is about TRUSTWORTHINESS, not popularity.`,

    'Likeability': `Measures FAN AFFECTION — how much people personally like and feel connected to the athlete. Focus on: engagement rates showing active affection, community connection, personal warmth. Distinguish: Likeability is about PERSONAL CONNECTION, not performance or authority.`,

    'Leadership': `Measures INFLUENCE & ON-FIELD AUTHORITY — leadership qualities and team influence.
${careerContext}
CALIBRATION: A solid Premier League player scores 55-65. Scores above 75 require clear evidence of captaincy, mentoring, or community leadership. Nobody scores above 85.
Focus on: captaincy mentions, manager/teammate quotes about leadership, calm professional statements during adversity, community/charity work.`,

    'Authenticity': `Measures GENUINE VOICE & CONSISTENCY — whether the athlete appears real vs manufactured.
Focus on: consistency in messaging over time, personal brand alignment, genuine moments vs scripted PR, personal voice vs corporate speak.
CALIBRATION: Most professional athletes score 60-72. High authenticity (75+) requires a distinctively genuine voice that stands out from typical athlete content.`,

    'Controversy': `Measures RISK & SCANDALS — negative incidents and reputational damage.
IMPORTANT CONTEXT: This score uses category classification. Sporting events (match results, Champions League exits) carry only 15% weight. Personal conduct incidents carry full weight. Always clarify in your response whether controversy is driven by conduct or sporting events — this matters enormously for commercial partners.
Focus on: specific incidents, disciplinary issues, brand-damaging personal life issues, pattern of behaviour vs isolated incidents.`,

    'Relevance': `Measures CULTURAL IMPACT & VISIBILITY — how much the athlete is part of the conversation. Focus on: trending status, mainstream media attention, cultural crossover, social conversation volume. Distinguish: Relevance is about VISIBILITY, not quality or sentiment.`,

    'Influence': `Measures REAL-WORLD COMMERCIAL POWER — the athlete's ability to move audiences, shift opinions, and deliver value to commercial partners.

SCORING COMPONENTS:
- REACH (40%): Total follower base across Twitter/X and Instagram
- ENGAGEMENT QUALITY (30%): Average engagement rate — 3%+ signals an actively engaged audience, below 1% suggests passive following
- CAREER AUTHORITY (30%): International caps, tournament appearances, club pedigree, years at elite level

${careerContext}

CRITICAL CONTEXT TO FACTOR IN:
- If Twitter/X shows no recent posts (last post over 6 months ago), this is a significant commercial negative. Brands pay for active amplification, not dormant accounts. Flag this explicitly.
- If Instagram is the primary active channel, assess whether that platform alone can deliver sufficient commercial reach.
- Compare engagement rate to follower count. A 1.5M Instagram following with 1.4% engagement is worth less commercially than a 500K following with 4% engagement.
- Career authority should reflect CURRENT status. A retired international carries less authority than an active one. Flag international retirement explicitly if relevant.

CALIBRATION:
- 85+: Elite commercial asset. Multiple active platforms, high engagement, current international profile.
- 75-84: Strong commercial platform with at least one area of genuine strength.
- 65-74: Solid but limited. Either reach or engagement is underperforming.
- Below 65: Commercial liability. Dormant platforms, disengaged audience, or fading career authority.

YOUR OUTPUT MUST:
1. Open with a single sentence verdict on commercial viability.
2. Give specific numbers — actual follower counts, engagement rates, caps.
3. Identify the single biggest factor holding the score back.
4. State explicitly whether each platform is active, dormant, or declining.
5. End with one concrete action that would move this score higher.

This must read like a briefing from a commercial director to a board, not a data summary. Be direct, be specific, be actionable.`
  };

  const guidance = scoreGuidance[metricName] || 'Analyse this score based on the available data.';

  const brandRiskInfo = (metricName === 'Controversy' && context.brandRiskArticles && context.brandRiskArticles.length > 0)
    ? `\n\nBRAND RISK ALERTS (${context.brandRiskArticles.length} articles with brand-damaging keywords):\n` +
      context.brandRiskArticles.map((a, i) => `${i + 1}. "${a.title}" — Contains: ${a.keywords.slice(0, 3).join(', ')}`).join('\n')
    : '';

  const returnScore = ['Leadership', 'Authenticity'].includes(metricName);
  const scoreInstructions = returnScore
    ? `\n\nADDITIONAL TASK: Based on your analysis, assign a score 0-85 for this metric. Output it as the very first line in format: DERIVED_SCORE: [number]\nThen continue with the normal explanation format below.`
    : '';

  const prompt = `You are analyzing reputation data for a professional athlete.

ATHLETE: ${athleteName || 'Professional Athlete'}
METRIC: ${metricName}
SCORE (today's raw): ${score}/100 ${rollingAvg != null ? `7-DAY ROLLING AVERAGE: ${rollingAvg}/100` : ''} ${divergence != null && Math.abs(divergence) >= 10 ? ` ⚠️ SIGNIFICANT DIVERGENCE DETECTED: Today's score is ${divergence > 0 ? '+' : ''}${divergence} points ${divergence > 0 ? 'above' : 'below'} the 7-day average. This is a meaningful recent shift. Lead your commentary by acknowledging this divergence — explain what it likely signals and whether it represents an emerging trend or a one-day spike. The 7-day average is the primary stable metric; today's reading is the signal to watch.` : ''} ${divergence != null && Math.abs(divergence) < 10 ? `Note: Today's score is close to the 7-day average (${divergence > 0 ? '+' : ''}${divergence} points), suggesting stability. Anchor your commentary to the rolling average as the reliable trend figure.` : ''}

${guidance}${brandRiskInfo}${scoreInstructions}

RECENT NEWS HEADLINES (Last 7 days):
${newsHeadlines}

RECENT TWEETS (Last 7 days):
${recentTweets}

STATISTICS:
- Twitter: ${context.twitterPctPositive}% positive sentiment, ${context.twitterFollowers} followers, ${context.twitterMentions} mentions
- Instagram: ${context.instagramPctPositive}% positive, ${context.instagramFollowers} followers, ${context.instagramPosts} posts
- News: ${context.newsMentions} articles total, ${context.newsSentiment} sentiment breakdown

TASK: Write a compelling, natural explanation for this ${metricName} score of ${score}.

CRITICAL FILTERING RULE: You are analysing ${athleteName} ONLY. Ignore articles where ${athleteName} is NOT the primary subject. Only use articles where ${athleteName} is named in the headline or the article is clearly about them.

STYLE REQUIREMENTS:
1. Natural prose — like a sports analyst, not an academic report
2. NO markdown (no **, no ##, no labels)
3. Punchy and direct — short, impactful sentences
4. Extract SPECIFIC events with dates from the data above
5. British English: realise, analyse, whilst, favour, match (not game)
6. FOCUS ON THIS SPECIFIC METRIC — don't repeat points across scores

FORMAT:
[2-3 sentences of natural prose explaining what drives this score. Be specific. No labels, no bold text.]

• [Specific detail with date/evidence — under 25 words]
• [Another specific achievement or incident — direct and clear]
• [Concrete example with numbers]
• [Supporting evidence — actual event or stat]`;

  try {
    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      { model: CLAUDE_MODEL, max_tokens: 450, messages: [{ role: 'user', content: prompt }] },
      {
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': ANTHROPIC_VERSION },
        timeout: 60000,
        validateStatus: () => true
      }
    );
    if (res.status !== 200) {
      console.error('Claude API error for', metricName, ':', res.status, res.data?.error?.type);
      return { summary: '', breakdown: [], derivedScore: null };
    }
    const text = (res.data?.content?.[0]?.text || '').replace(/\*\*/g, '').replace(/\*/g, '');
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);

    // Extract derived score if present (Leadership/Authenticity)
    let derivedScore = null;
    const scoreMatch = text.match(/DERIVED_SCORE:\s*(\d+)/);
    if (scoreMatch) derivedScore = Math.min(85, Math.max(0, parseInt(scoreMatch[1])));

    const bulletLines = lines.filter(l => l.startsWith('•') || l.startsWith('-'));
    const summaryLines = lines.filter(l => !l.startsWith('•') && !l.startsWith('-') && !l.startsWith('DERIVED_SCORE'));
    const summary = summaryLines.join(' ').trim();
    const breakdown = bulletLines.map(l => `• ${l.replace(/^[•\-]\s*/, '')}`);

    return { summary, breakdown, derivedScore };
  } catch (e) {
    console.error('Claude explanation error for', metricName, ':', e.message);
    return { summary: '', breakdown: [], derivedScore: null };
  }
}

// ==================== CLAUDE: STRATEGIC INTELLIGENCE ====================
// Your existing strategic intelligence prompt — kept exactly as-is as it produces great output.

async function generateStrategicIntelligence(scores, athleteData, context, athleteName) {
  if (!ANTHROPIC_API_KEY) return null;

  const newsHeadlines = (context.recentNewsHeadlines || []).slice(0, 8).map((a, i) =>
    `${i + 1}. "${a.title}" (${a.source}, ${a.date})`
  ).join('\n') || 'No recent news articles available.';

  const recentTweets = (context.recentTweets || []).slice(0, 5).map((t, i) =>
    `${i + 1}. "${t.text}" (${t.likes} likes, ${t.retweets} retweets, ${t.date})`
  ).join('\n') || 'No recent tweets available.';

  const controversyContext = scores.scoringMetadata?.controversy?.breakdown?.length > 0
    ? `Active controversy incidents: ${scores.scoringMetadata.controversy.breakdown.map(i =>
        `${i.description} (${i.category}, ${i.daysAgo} days ago, contributing ${i.contribution} pts)`
      ).join('; ')}`
    : 'No active controversy incidents logged.';

  const sponsorStatus = scores.sponsorReadiness
    ? `Sponsor Readiness: ${scores.sponsorReadiness.rating} — ${scores.sponsorReadiness.summary}`
    : '';

  const prompt = `You are an elite athlete reputation intelligence advisor providing strategic analysis.

ATHLETE: ${athleteName || 'Professional Athlete'}

REPUTATION SCORES:
- Sentiment: ${scores.sentimentScore}/100
- Credibility: ${scores.credibilityScore}/100
- Likeability: ${scores.likeabilityScore}/100
- Leadership: ${scores.leadershipScore || 'Analysing...'}/100
- Authenticity: ${scores.authenticityScore || 'Analysing...'}/100
- Controversy: ${scores.controversyScore}/100 (lower is better)
- Relevance: ${scores.relevanceScore}/100
- Influence: ${scores.influenceScore}/100
- Composite: ${scores.compositeScore}/100
${sponsorStatus}
${controversyContext}

RECENT NEWS HEADLINES:
${newsHeadlines}

RECENT SOCIAL MEDIA:
${recentTweets}

STATISTICS:
- Twitter: ${context.twitterPctPositive}% positive, ${context.twitterFollowers} followers, ${context.twitterMentions} mentions
- Instagram: ${context.instagramPctPositive}% positive, ${context.instagramFollowers} followers, ${context.instagramPosts} posts
- News: ${context.newsMentions} articles, ${context.newsSentiment}

CRITICAL FILTERING RULE: You are analysing ${athleteName} ONLY. Completely ignore articles about other players even if they mention the same team.

TASK: Provide strategic intelligence analysis.

OUTPUT FORMAT (no labels, no markdown, natural sections):

[STRATEGIC OVERVIEW — 3-4 sentences]
Assess current reputation position. Identify critical inflection points. Reference specific events. Be direct about what's working and what's at risk. If controversy is present, explicitly state whether it is conduct-driven or sporting-driven.

[KEY RISKS — 3-4 bullets with •]
Specific reputation threats based on actual headlines and scores. Time-bound and actionable.

[IMMEDIATE RECOMMENDATIONS — 4-5 bullets with •]
Tactical actions for next 7-14 days. Specific and actionable. Prioritised by urgency.

[WATCH-OUTS — 3-4 bullets with •]
Early warning signals that need monitoring. Specific timing and triggers.

STYLE: No markdown. Punchy bullets under 30 words. Direct and authoritative. Write like you're briefing a client who pays £12k/month. British English throughout.`;

  try {
    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      { model: CLAUDE_MODEL, max_tokens: 900, messages: [{ role: 'user', content: prompt }] },
      {
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': ANTHROPIC_VERSION },
        timeout: 60000,
        validateStatus: () => true
      }
    );
    if (res.status !== 200) {
      console.error('Claude strategic intelligence error:', res.status, res.data?.error?.type);
      return null;
    }
    const text = (res.data?.content?.[0]?.text || '').replace(/\*\*/g, '').replace(/\*/g, '');
    const allLines = text.split('\n').map(s => s.trim()).filter(Boolean);
    const firstBulletIndex = allLines.findIndex(l => l.startsWith('•') || l.startsWith('-'));
    const overviewLines = firstBulletIndex > 0 ? allLines.slice(0, firstBulletIndex) : [allLines[0] || ''];
    const overview = overviewLines.join(' ').trim();
    const allBullets = allLines
      .filter(l => l.startsWith('•') || l.startsWith('-'))
      .map(l => `• ${l.replace(/^[•\-]\s*/, '')}`);
    const total = allBullets.length;
    if (total === 0) {
      return { strategic_overview: overview, key_risks: ['• No specific risks identified'], immediate_recommendations: ['• Continue monitoring'], watch_outs: ['• Track sentiment changes'] };
    }
    let risks = [], recommendations = [], watchouts = [];
    if (total >= 9) {
      const s1 = Math.floor(total / 3), s2 = Math.floor(total * 2 / 3);
      risks = allBullets.slice(0, s1);
      recommendations = allBullets.slice(s1, s2);
      watchouts = allBullets.slice(s2);
    } else {
      for (const b of allBullets) {
        const lower = b.toLowerCase();
        if (lower.includes('risk') || lower.includes('threat') || lower.includes('escalat') || lower.includes('negative') || lower.includes('damag')) risks.push(b);
        else if (lower.includes('accelerate') || lower.includes('leverage') || lower.includes('proactive') || lower.includes('secure') || lower.includes('engage')) recommendations.push(b);
        else if (lower.includes('watch') || lower.includes('monitor') || lower.includes('track') || lower.includes('next') || lower.includes('upcoming')) watchouts.push(b);
        else risks.length <= recommendations.length ? risks.push(b) : recommendations.push(b);
      }
      if (risks.length === 0) risks.push(allBullets[0] || '• Monitor current metrics');
      if (recommendations.length === 0) recommendations.push(allBullets[1] || '• Maintain current engagement');
      if (watchouts.length === 0) watchouts.push(allBullets[allBullets.length - 1] || '• Track sentiment changes');
    }
    return { strategic_overview: overview, key_risks: risks, immediate_recommendations: recommendations, watch_outs: watchouts };
  } catch (e) {
    console.error('Strategic intelligence error:', e.message);
    return null;
  }
}

// ==================== TEMPLATE FALLBACK ====================

function getTemplateExplanation(metricName, score, context) {
  const s = score ?? 0;
  const templates = {
    Sentiment: { summary: s >= 70 ? 'Positive sentiment detected across recent posts and news. Fans and media are largely supportive.' : s >= 50 ? 'Mixed to neutral sentiment. Some positive coverage with limited negative mentions.' : 'Elevated negative sentiment in recent coverage. Consider monitoring and response.', breakdown: [`Twitter: ${context.twitterPctPositive}% positive`, `News: ${context.newsSentiment}`, `Based on ${context.twitterMentions} mentions and ${context.newsMentions} articles`] },
    Credibility: { summary: s >= 70 ? 'Strong credibility from high-authority media coverage.' : s >= 50 ? 'Moderate credibility. Mix of authoritative and tabloid coverage.' : 'Limited high-authority coverage affecting credibility score.', breakdown: [`Twitter followers: ${context.twitterFollowers}`, `News mentions: ${context.newsMentions}`, `Source authority weighted in calculation`] },
    Likeability: { summary: s >= 70 ? 'High engagement rate signals strong fan affection.' : s >= 50 ? 'Solid engagement levels across social channels.' : 'Engagement rate suggests audience connection could be strengthened.', breakdown: [`Instagram posts: ${context.instagramPosts}`, `Engagement rate drives this metric`, `No artificial floor — reflects true audience connection`] },
    Leadership: { summary: s >= 70 ? 'Strong leadership signals in public discourse.' : 'Leadership score reflects current media and social footprint.', breakdown: [`Claude-derived from news and tweet analysis`, `Career experience factored in`, `Captaincy and mentoring signals assessed`] },
    Authenticity: { summary: s >= 70 ? 'Consistent authentic voice across platforms.' : 'Authenticity reflects consistency between self-presentation and external perception.', breakdown: [`Cross-platform consistency assessed`, `Personal vs managed content analysed`, `Fan engagement signals reviewed`] },
    Controversy: { summary: s > 40 ? 'Elevated controversy detected. Review incident breakdown for context.' : s > 20 ? 'Some controversy signals. Generally stable profile.' : 'Low controversy. Clean reputation profile.', breakdown: [`Category-classified incidents with time decay`, `Sporting events carry reduced weight`, `Conduct incidents carry full weight`] },
    Relevance: { summary: s >= 70 ? 'High relevance: strong mention count and media coverage.' : 'Relevance reflects current mention and news volume.', breakdown: [`Twitter mentions: ${context.twitterMentions}`, `News articles: ${context.newsMentions}`, `Instagram impressions factor in where available`] }
  };
  const t = templates[metricName] || { summary: `Score: ${s}. Based on available social and news data.`, breakdown: [] };
  return { summary: t.summary, breakdown: t.breakdown || [] };
}

// ==================== BUILD PERCEPTION DETAILS ====================
// Enhanced: Leadership and Authenticity now get DERIVED_SCORE from Claude,
// which then feeds back into the final score saved to the dashboard.

async function buildPerceptionDetails(scores, athleteData, context, athleteName, careerProfile, athleteId = null, dashboardData = null) {
  const base = { data_quality: context.data_quality || {} };

  // Fetch yesterday's scores for divergence calculation
  let yesterdayScores = null;
  let rollingAverages = {};
  if (athleteId) {
    const { data: hist } = await supabase
      .from('athlete_score_history')
      .select('*')
      .eq('athlete_id', athleteId)
      .order('snapshot_date', { ascending: false })
      .limit(8);
    if (hist && hist.length >= 2) {
      yesterdayScores = hist[1];
      const scoreFields = ['sentiment_score','credibility_score','likeability_score','leadership_score','authenticity_score','controversy_score','relevance_score','influence_score'];
      scoreFields.forEach(f => {
        const vals = hist.slice(0, 7).map(h => h[f]).filter(v => v != null);
        rollingAverages[f] = vals.length ? Math.round(vals.reduce((a,b) => a+b,0) / vals.length) : null;
      });
    }
  }
  const metricNames = ['Sentiment', 'Credibility', 'Likeability', 'Leadership', 'Authenticity', 'Controversy', 'Relevance'];
  const scoreKeys = ['sentimentScore', 'credibilityScore', 'likeabilityScore', 'leadershipScore', 'authenticityScore', 'controversyScore', 'relevanceScore'];

  for (let i = 0; i < metricNames.length; i++) {
    // For Leadership and Authenticity, pass a placeholder score to Claude
    // Claude will return a DERIVED_SCORE we use as the actual score
    const isClaudeDerived = ['Leadership', 'Authenticity'].includes(metricNames[i]);
    const rawScore = scores[scoreKeys[i]] ?? 0;
    let summary = '', breakdown = [], derivedScore = null;
    if (ANTHROPIC_API_KEY) {
      const dbField = `${metricNames[i].toLowerCase()}_score`;
      const rollingAvg = rollingAverages[dbField] ?? null;
      const divergence = (rollingAvg != null) ? rawScore - rollingAvg : null;
      const scoreToPass = isClaudeDerived ? 70 : (rollingAvg ?? rawScore);
      const result = await generateScoreExplanation(metricNames[i], scoreToPass, context, athleteName, careerProfile, rollingAvg, divergence);      summary = result.summary || '';
      breakdown = Array.isArray(result.breakdown) ? result.breakdown : [result.breakdown].filter(Boolean);
      derivedScore = result.derivedScore;
    }

    if (!summary) {
      const template = getTemplateExplanation(metricNames[i], scoreToPass, context);
      summary = template.summary;
      breakdown = template.breakdown;
    }

    // Feed derived scores back into the scores object
    if (isClaudeDerived && derivedScore !== null) {
      if (metricNames[i] === 'Leadership') scores.leadershipScore = derivedScore;
      if (metricNames[i] === 'Authenticity') scores.authenticityScore = derivedScore;
    }

    // Fallback defaults if Claude didn't return a derived score
    if (metricNames[i] === 'Leadership' && !scores.leadershipScore) scores.leadershipScore = 65;
    if (metricNames[i] === 'Authenticity' && !scores.authenticityScore) scores.authenticityScore = 68;

    base[metricNames[i]] = { summary, breakdown };
  }

  // Now recalculate composite with all 8 scores populated
  scores.compositeScore = Math.round(
    (scores.sentimentScore    * 0.15) +
    (scores.credibilityScore  * 0.12) +
    (scores.likeabilityScore  * 0.12) +
    (scores.leadershipScore   * 0.12) +
    (scores.authenticityScore * 0.12) +
    (Math.max(0, 100 - scores.controversyScore) * 0.17) +
    (scores.relevanceScore    * 0.10) +
    (scores.influenceScore    * 0.10)
  );

  // Generate strategic intelligence
  if (ANTHROPIC_API_KEY) {
    console.log('📋 Generating strategic intelligence...');
    const strategicIntel = await generateStrategicIntelligence(scores, athleteData, context, athleteName);
    if (strategicIntel) base.strategic_intelligence = strategicIntel;
  }

  // Add Influence score explanation (simple — no Claude call needed)
  const careerAuth = calculateCareerAuthorityScore(careerProfile);
  base['Influence'] = {
    summary: `Influence combines reach (${scores.scoringMetadata?.reachScore || 0}/100), engagement quality, and career authority (${careerAuth}/100 based on caps, honours, and club level). ${!careerProfile ? 'Career profile not yet set — add via onboarding endpoint to improve this score.' : ''}`,
    breakdown: [
      `• Reach component: ${scores.scoringMetadata?.reachScore || 0}/100 (follower scale across platforms)`,
      `• Engagement quality: ${scores.scoringMetadata?.engagementRate || 0}% average engagement rate`,
      `• Career authority: ${careerAuth}/100${careerProfile ? ` (${careerProfile.international_caps || 0} caps, ${careerProfile.major_honours || 0} honours)` : ' (not set — update via career profile endpoint)'}`
    ]
  };

  // Add sponsor readiness to perception details
  if (scores.sponsorReadiness) {
    base['SponsorReadiness'] = scores.sponsorReadiness;
  }

  // Keep existing metadata fields
  const resolvedIgUsername = resolveInstagramUsername(athleteData.instagram?.profile?.username || '');
  base.instagram_handle = athleteData.instagram?.profile?.username ?? null;
  base.twitter_pct_positive = context.twitter_pct_positive || 0;
  base.instagram_pct_positive = context.instagram_pct_positive || 0;
  base.recent_instagram_posts = (athleteData.instagram?.posts || []).slice(0, 5);
  base.avg_instagram_engagement = athleteData.instagram?.posts?.length
    ? Math.round(athleteData.instagram.posts.reduce((s, p) => s + (p.likes || 0) + (p.comments || 0), 0) / athleteData.instagram.posts.length)
    : 0;

  return base;
}

// ==================== HISTORICAL SNAPSHOT ====================

async function saveHistoricalSnapshot(athleteId, dashboardData) {
  const today = new Date().toISOString().split('T')[0];
  const { data: existing } = await supabase.from('athlete_score_history').select('id').eq('athlete_id', athleteId).eq('snapshot_date', today).maybeSingle();
  if (existing) return { data: existing, error: null };
  const row = {
    athlete_id: athleteId, snapshot_date: today,
    sentiment_score: dashboardData.sentiment_score,
    credibility_score: dashboardData.credibility_score,
    likeability_score: dashboardData.likeability_score,
    leadership_score: dashboardData.leadership_score,
    authenticity_score: dashboardData.authenticity_score,
    controversy_score: dashboardData.controversy_score,
    relevance_score: dashboardData.relevance_score,
    twitter_followers: dashboardData.twitter_followers,
    instagram_followers: dashboardData.instagram_followers,
    news_mentions: dashboardData.total_mentions ?? dashboardData.news_articles_count ?? 0,
    overall_alert_level: calculateAlertLevel(dashboardData)
  };
  const { data, error } = await supabase.from('athlete_score_history').insert(row).select().single();
  if (error) { console.error('Snapshot error:', error.message); return { data: null, error }; }
  console.log('✅ Historical snapshot saved');
  return { data, error: null };
}

// ==================== TIMELINE ====================
function generateTimeline(tweets, news, instagramPosts) {
  const events = [];

  // ── Tweets: individual entries for high-engagement posts ──
  (tweets || []).forEach(t => {
    const eng = (t.likes || 0) + (t.retweets || 0) + (t.replies || 0);
    if (eng > 500) events.push({
      date: t.createdAt ? new Date(t.createdAt).toISOString() : null,
      platforms: 'X',
      title: (t.text || '').substring(0, 100),
      description: `${(t.likes || 0).toLocaleString()} likes · ${(t.retweets || 0).toLocaleString()} reposts`,
      sentiment: t.sentiment?.sentiment || 'NEUTRAL',
      type: 'tweet'
    });
  });

  // ── Instagram: individual entries ──
  (instagramPosts || []).slice(0, 5).forEach(p => {
    const ts = p.timestamp || p.takenAt || p.createdAt;
    if (ts) events.push({
      date: new Date(ts).toISOString(),
      platforms: 'INSTAGRAM',
      title: (p.caption || 'Instagram post').substring(0, 100),
      description: `${(p.likes || 0).toLocaleString()} likes · ${(p.comments || 0).toLocaleString()} comments`,
      sentiment: 'NEUTRAL',
      type: 'instagram'
    });
  });

  // ── News: group articles within 48hrs of each other ──
  const sortedNews = (news || [])
    .filter(a => a.publishedAt)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const newsGroups = [];
  sortedNews.forEach(article => {
    const articleDate = new Date(article.publishedAt).getTime();
    const existingGroup = newsGroups.find(g => {
      const groupDate = new Date(g.articles[0].publishedAt).getTime();
      return Math.abs(articleDate - groupDate) < 48 * 60 * 60 * 1000;
    });
    if (existingGroup) {
      existingGroup.articles.push(article);
    } else {
      newsGroups.push({ articles: [article] });
    }
  });

  newsGroups.forEach(group => {
    const { articles } = group;
    const lead = articles[0];
    const leadDate = new Date(lead.publishedAt);

    // Generate group title
    let groupTitle;
    if (articles.length === 1) {
      groupTitle = lead.title;
    } else {
      // Extract common theme from titles
      const titles = articles.map(a => a.title || '');
      // Find shared keywords to build theme label
      const allWords = titles.join(' ').toLowerCase();
      if (allWords.includes('champions league') || allWords.includes('barcelona') || allWords.includes('ucl')) {
        groupTitle = `Champions League coverage (${articles.length} articles)`;
      } else if (allWords.includes('transfer') || allWords.includes('signing') || allWords.includes('departure')) {
        groupTitle = `Transfer coverage (${articles.length} articles)`;
      } else if (allWords.includes('injury') || allWords.includes('injured') || allWords.includes('fitness')) {
        groupTitle = `Injury coverage (${articles.length} articles)`;
      } else if (allWords.includes('contract') || allWords.includes('extension') || allWords.includes('renewal')) {
        groupTitle = `Contract coverage (${articles.length} articles)`;
      } else if (allWords.includes('england') || allWords.includes('international') || allWords.includes('world cup') || allWords.includes('euros')) {
        groupTitle = `International coverage (${articles.length} articles)`;
      } else if (allWords.includes('match') || allWords.includes('game') || allWords.includes('goal') || allWords.includes('win') || allWords.includes('defeat') || allWords.includes('draw')) {
        groupTitle = `Match coverage (${articles.length} articles)`;
      } else {
        groupTitle = `${lead.title.substring(0, 60)}… (${articles.length} articles)`;
      }
    }

    events.push({
      date: leadDate.toISOString(),
      platforms: 'NEWS MEDIA',
      title: groupTitle,
      articles: articles.map(a => ({
        title: a.title,
        source: a.source?.name || a.source || null,
        url: a.url || null,
        sentiment: a.sentiment?.sentiment || 'NEUTRAL'
      })),
      sentiment: lead.sentiment?.sentiment || 'NEUTRAL',
      type: 'news_group'
    });
  });

  // Sort all events by date descending
  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  return events.slice(0, 20);
}

// ==================== GOOGLE ALERT QUERY GENERATOR ====================

function generateGoogleAlertQuery(athleteName, teamName) {
  const conductTerms = 'scandal OR arrest OR nightclub OR OnlyFans OR controversy OR lawsuit OR banned OR suspended OR drugs OR drunk OR crash OR assault OR inappropriate OR divorce OR affair OR gambling OR doping OR charged OR convicted';
  if (teamName) {
    return `"${athleteName}" AND (${conductTerms})`;
  }
  return `"${athleteName}" AND (${conductTerms})`;
}

// ==================== MAIN DATA COLLECTION ====================

async function collectAthleteData(athleteId, athleteName, twitterHandle, instagramBusinessId, country, sport = 'football') {
  console.log('\n📊 Collecting data for', athleteName);
  try {
    console.log('🐦 Twitter...');
    const twitterProfile = await getTwitterProfile(twitterHandle);
    const tweets = await getRecentTweets(twitterHandle, 20);
    const mentions = await getTwitterMentions(twitterHandle, 50);

    console.log('📷 Instagram...');
    const resolvedUsername = resolveInstagramUsername(instagramBusinessId);
    const hasInstagram = !!resolvedUsername;
    const instagramProfile = hasInstagram ? await getInstagramProfile(instagramBusinessId) : null;
    const instagramPosts = hasInstagram ? await getInstagramPosts(instagramBusinessId, 10) : [];
    const instagramInsights = hasInstagram ? await getInstagramInsights(instagramBusinessId) : {};

    console.log('📰 News...');
    const news = await searchNews(athleteName, 7, country, sport);
    const tabloidNews = await searchNewsAPI(athleteName, 28);
const seen = new Set();
    const allNews = [...news].filter(a => {
      const key = a.title ? a.title.toLowerCase().trim() : null;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });    let tabloidCount = 0;
    tabloidNews.forEach(article => {
      const exists = allNews.some(a => a.title && article.title && a.title.toLowerCase() === article.title.toLowerCase());
      if (!exists) { allNews.push(article); tabloidCount++; }
    });
    console.log(`📰 Total: ${allNews.length} articles (${tabloidCount} from tabloids)`);

    // Fetch legacy manual incidents
    let manualIncidents = [];
    try {
      const { data: athleteRow } = await supabase.from('athletes').select('manual_controversy_incidents').eq('id', athleteId).maybeSingle();
      manualIncidents = athleteRow?.manual_controversy_incidents || [];
      if (manualIncidents.length > 0) console.log(`⚠️  ${manualIncidents.length} legacy manual incidents found`);
    } catch (e) {
      console.error('Error fetching manual incidents:', e.message);
    }

    // Fetch career profile
    const careerProfile = await getCareerProfile(athleteId);
    if (careerProfile) console.log('👤 Career profile loaded:', careerProfile.international_caps, 'caps,', careerProfile.major_honours, 'honours');
    else console.log('👤 No career profile found — Influence career authority will use default');

    console.log('🤖 Sentiment...');
    const tweetSents = await Promise.all(tweets.slice(0, 10).map(t => analyzeSentiment(t.text)));
    tweets.forEach((t, i) => { if (i < 10) t.sentiment = tweetSents[i]; });
    const newsSents = await Promise.all(allNews.slice(0, 10).map(a => analyzeSentiment(a.title + ' ' + (a.description || ''))));
    allNews.forEach((a, i) => { if (i < 10) a.sentiment = newsSents[i]; });

    const athleteData = {
      profile: twitterProfile, tweets, mentions,
      instagram: { profile: instagramProfile, posts: instagramPosts, insights: instagramInsights },
      news: allNews, manualIncidents
    };

    console.log('📈 Scores...');
    const scores = await calculateReputationScores(athleteData, athleteId, careerProfile);
    const timeline = generateTimeline(tweets, allNews, instagramPosts);

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
      newsMentions: allNews.length,
      newsSentiment: newsSentimentStr,
      twitter_pct_positive: twitterPctPositive,
      instagram_pct_positive: instagramPosts.length ? 70 : (twitterPctPositive || 0),
      data_quality: { twitter_ok: !!twitterProfile, sentiment_ok: tweetSents.length > 0 },
      recentNewsHeadlines: allNews.slice(0, 5).map(a => ({
        title: a.title, source: a.source || 'Unknown',
        date: a.publishedAt ? new Date(a.publishedAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Recent'
      })),
      recentTweets: tweets.slice(0, 5).map(t => ({
        text: (t.text || '').substring(0, 200),
        likes: t.likes || 0, retweets: t.retweets || 0,
        date: t.createdAt ? new Date(t.createdAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Recent'
      })),
      brandRiskArticles: scores.brandRiskArticles || []
    };

    console.log('📝 Generating score explanations (Claude)...');
    const perception_details = await buildPerceptionDetails(scores, athleteData, claudeContext, athleteName, careerProfile, athleteId, null);

    // Engagement metrics
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
      influence_score: scores.influenceScore,
      composite_score: scores.compositeScore,
      sponsor_readiness: scores.sponsorReadiness,
      recent_tweets: tweets.slice(0, 10),
      recent_news: allNews.slice(0, 10),
      timeline_events: timeline,
      total_mentions: mentions.length,
      news_articles_count: allNews.length,
      avg_tweet_engagement: tweets.length ? Math.round(tweets.reduce((s, t) => s + t.likes + t.retweets, 0) / tweets.length) : 0,
      perception_details,       manual_controversy_incidents: manualIncidents,       
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
// Calculate and store rolling averages
    const { data: recentHistory } = await supabase
      .from('athlete_score_history')
      .select('*')
      .eq('athlete_id', athleteId)
      .order('snapshot_date', { ascending: false })
      .limit(7);
    
    const calcRollingAvg = (field) => {
      if (!recentHistory || recentHistory.length === 0) return null;
      const vals = recentHistory.map(h => h[field]).filter(v => v != null);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };

    dashboardData.sentiment_rolling_avg = calcRollingAvg('sentiment_score');
    dashboardData.credibility_rolling_avg = calcRollingAvg('credibility_score');
    dashboardData.likeability_rolling_avg = calcRollingAvg('likeability_score');
    dashboardData.leadership_rolling_avg = calcRollingAvg('leadership_score');
    dashboardData.authenticity_rolling_avg = calcRollingAvg('authenticity_score');
    dashboardData.controversy_rolling_avg = calcRollingAvg('controversy_score');
    dashboardData.relevance_rolling_avg = calcRollingAvg('relevance_score');
    dashboardData.influence_rolling_avg = calcRollingAvg('influence_score');
    console.log('💾 Saving...');
    const { error } = await supabase.from('athlete_dashboards').upsert(dashboardData, { onConflict: 'athlete_id' });
    if (error) { console.error('❌ DB error:', error.message); return null; }
    console.log('✅ Dashboard updated — Composite:', scores.compositeScore, '| Sponsor:', scores.sponsorReadiness?.rating);
    await saveHistoricalSnapshot(athleteId, dashboardData);
    return dashboardData;

  } catch (e) {
    console.error('❌ Error collecting data:', e);
    return null;
  }
}

// ==================== API ENDPOINTS ====================

app.get('/api/health', (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

app.get('/api/athletes/list', async (req, res) => {
  try {
    const { data, error } = await supabase.from('athletes').select('id, name, twitter_handle, instagram_business_id').eq('active', true).order('name');
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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

// --- NEW: Athlete onboarding with career profile ---
// POST /api/athlete/onboard
// Creates athlete + career profile + returns Google Alert query in one step.
app.post('/api/athlete/onboard', async (req, res) => {
  const { name, twitterHandle, instagramHandle, sport, team, careerProfile } = req.body;
  if (!name || !twitterHandle) return res.status(400).json({ error: 'Required: name, twitterHandle' });
  try {
    const { data: athlete, error: athleteError } = await supabase
      .from('athletes')
      .insert({ name, twitter_handle: twitterHandle, instagram_business_id: instagramHandle || null, sport: sport || 'football', team: team || null, active: true })
      .select().single();
    if (athleteError) throw athleteError;

    let careerData = null;
    if (careerProfile) {
      const { data: career } = await supabase.from('athlete_career_profiles').insert({
        athlete_id: athlete.id,
        international_caps: careerProfile.internationalCaps || 0,
        international_goals: careerProfile.internationalGoals || 0,
        national_team: careerProfile.nationalTeam || null,
        world_cup_appearances: careerProfile.worldCupAppearances || 0,
        major_tournament_appearances: careerProfile.majorTournamentAppearances || 0,
        minor_tournament_appearances: careerProfile.minorTournamentAppearances || 0,
        highest_club_level: careerProfile.highestClubLevel || 'premier_league',
        current_club: careerProfile.currentClub || team || null,
        career_clubs: careerProfile.careerClubs || [],
        years_at_elite_level: careerProfile.yearsAtEliteLevel || 1,
        career_start_year: careerProfile.careerStartYear || null,
        major_honours: careerProfile.majorHonours || 0,
        individual_awards: careerProfile.individualAwards || [],
        notes: careerProfile.notes || null
      }).select().single();
      careerData = career;
    }

    const googleAlertQuery = generateGoogleAlertQuery(name, team);
    // Kick off initial data collection in background
    collectAthleteData(athlete.id, name, twitterHandle, instagramHandle, null, sport || 'football')
      .then(() => console.log(`✅ Initial data collected for ${name}`))
      .catch(e => console.error(`❌ Initial collection failed for ${name}:`, e.message));

    res.json({
      success: true,
      athlete: { id: athlete.id, name, twitterHandle },
      careerProfileCreated: !!careerData,
      googleAlertSetup: {
        query: googleAlertQuery,
        instructions: [
          '1. Go to https://google.com/alerts',
          `2. Paste this query: ${googleAlertQuery}`,
          '3. Settings: As-it-happens | News | English | UK | All results',
          '4. Deliver to your monitoring email',
          `5. When an alert fires, log it via POST /api/athlete/${athlete.id}/controversy`
        ]
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- NEW: Update career profile ---
app.put('/api/athlete/:athleteId/career', async (req, res) => {
  const { athleteId } = req.params;
  const updates = req.body;
  const dbUpdates = { last_updated: new Date().toISOString() };
  if (updates.internationalCaps !== undefined) dbUpdates.international_caps = updates.internationalCaps;
  if (updates.worldCupAppearances !== undefined) dbUpdates.world_cup_appearances = updates.worldCupAppearances;
  if (updates.majorTournamentAppearances !== undefined) dbUpdates.major_tournament_appearances = updates.majorTournamentAppearances;
  if (updates.highestClubLevel !== undefined) dbUpdates.highest_club_level = updates.highestClubLevel;
  if (updates.majorHonours !== undefined) dbUpdates.major_honours = updates.majorHonours;
  if (updates.yearsAtEliteLevel !== undefined) dbUpdates.years_at_elite_level = updates.yearsAtEliteLevel;
  if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
  try {
    const { data, error } = await supabase.from('athlete_career_profiles').update(dbUpdates).eq('athlete_id', athleteId).select().single();
    if (error) throw error;
    res.json({ success: true, message: 'Career profile updated. Influence score updates on next refresh.', profile: data });
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

app.get('/api/athlete/:id/rolling/:days', async (req, res) => {
  try {
    const { id, days } = req.params;
    const numDays = parseInt(days) || 7;

    // Fetch enough history for two overlapping 7-day windows (today's avg + yesterday's avg)
    const { data: history, error } = await supabase
      .from('athlete_score_history')
      .select('*')
      .eq('athlete_id', id)
      .order('snapshot_date', { ascending: false })
      .limit(numDays + 2);

    if (error) throw error;
    if (!history || history.length < 2) return res.status(404).json({ error: 'Not enough historical data' });

    const scoreFields = ['sentiment', 'credibility', 'likeability', 'leadership', 'authenticity', 'controversy', 'relevance', 'influence'];

    const calcWindowAvg = (data, field) => {
      const dbField = `${field}_score`;
      const vals = data.map(h => h[dbField]).filter(v => v != null);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };

    // Today's 7-day window: rows 0 to numDays-1
    const todayWindow = history.slice(0, numDays);
    // Yesterday's 7-day window: rows 1 to numDays
    const yesterdayWindow = history.slice(1, numDays + 1);
    // Today's raw score: most recent snapshot
    const todayRaw = history[0];

    const scores = {};
    scoreFields.forEach(f => {
      const dbField = `${f}_score`;
      const todayAvg = calcWindowAvg(todayWindow, f);
      const yesterdayAvg = calcWindowAvg(yesterdayWindow, f);
      const todayRawScore = todayRaw[dbField] ?? null;

      // Change = today's rolling avg vs yesterday's rolling avg
      const change = (todayAvg != null && yesterdayAvg != null) ? todayAvg - yesterdayAvg : 0;

      // Divergence = today's raw 24hr score vs today's rolling avg (early warning signal)
      const divergence = (todayRawScore != null && todayAvg != null) ? todayRawScore - todayAvg : null;

      scores[f] = {
        current: todayRawScore,        // raw 24hr score — for divergence alerts only
        rolling_avg: todayAvg,         // primary displayed score
        yesterday_avg: yesterdayAvg,   // for reference
        change_from_yesterday: change, // rolling avg vs rolling avg
        trend: change > 0 ? 'up' : change < 0 ? 'down' : 'stable',
        divergence_from_average: divergence  // early warning trigger
      };
    });

    res.json({
      athlete_id: id,
      period_days: numDays,
      period_start: todayWindow[todayWindow.length - 1]?.snapshot_date,
      period_end: todayWindow[0]?.snapshot_date,
      scores
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/athlete/refresh', async (req, res) => {
  const { athleteId, athleteName, twitterHandle, instagramBusinessId, instagramUsername, userName, country, sport } = req.body;
  if (!athleteId || !athleteName || !twitterHandle) return res.status(400).json({ error: 'Missing required fields: athleteId, athleteName, twitterHandle' });

  let instagramId = instagramUsername ?? userName ?? instagramBusinessId ?? null;
  let useName = athleteName, useTwitter = twitterHandle, useCountry = country, useSport = sport || 'football';

  try {
    const { data: athleteRow } = await supabase.from('athletes').select('instagram_business_id, twitter_handle, name, sport, country').eq('id', athleteId).maybeSingle();
    if (athleteRow) {
      if (athleteRow.instagram_business_id?.trim()) instagramId = athleteRow.instagram_business_id;
      if (athleteRow.twitter_handle?.trim()) useTwitter = athleteRow.twitter_handle;
      if (athleteRow.name?.trim()) useName = athleteRow.name;
      if (athleteRow.country?.trim()) useCountry = athleteRow.country;
      if (athleteRow.sport?.trim()) useSport = athleteRow.sport;
    }
  } catch (e) { console.error('Error fetching athlete from DB:', e.message); }

  try {
    const data = await collectAthleteData(athleteId, useName, useTwitter, instagramId, useCountry, useSport);
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

// ==================== CONTROVERSY ENDPOINTS (UPGRADED) ====================
// These replace the old add/remove/list endpoints.
// New: uses athlete_controversies table with classification and time decay.
// Backward compatible: legacy /api/athlete/controversy/add still works.

// Add incident — new structured endpoint
// POST /api/athlete/:athleteId/controversy
app.post('/api/athlete/:athleteId/controversy', async (req, res) => {
  const { athleteId } = req.params;
  const { description, severity, incident_date, category } = req.body;
  if (!description || !severity || !incident_date) {
    return res.status(400).json({ error: 'Required: description, severity (low/medium/high), incident_date (YYYY-MM-DD)' });
  }
  const suggestedCategory = category || suggestControversyCategory(description);
  try {
    const { data, error } = await supabase.from('athlete_controversies').insert({
      athlete_id: athleteId, description, severity, incident_date,
      category: suggestedCategory, created_at: new Date().toISOString()
    }).select().single();
    if (error) throw error;
    res.json({
      success: true,
      incident: data,
      category: suggestedCategory,
      categoryDescription: CONTROVERSY_CATEGORIES[suggestedCategory]?.description,
      message: `Incident logged as "${CONTROVERSY_CATEGORIES[suggestedCategory]?.description}". Will update score on next refresh.`
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// List incidents with decay info
// GET /api/athlete/:athleteId/controversy
app.get('/api/athlete/:athleteId/controversy', async (req, res) => {
  const { athleteId } = req.params;
  try {
    const { data, error } = await supabase.from('athlete_controversies').select('*').eq('athlete_id', athleteId).order('incident_date', { ascending: false });
    if (error) throw error;
    const annotated = (data || []).map(incident => {
      const decay = getTimeDecayMultiplier(incident.incident_date, incident.category || 'CONDUCT');
      const baseSeverity = { low: 8, medium: 16, high: 24 }[incident.severity] || 16;
      const categoryWeight = CONTROVERSY_CATEGORIES[incident.category]?.weight || 1.0;
      return {
        ...incident,
        currentDecayMultiplier: decay,
        currentScoreContribution: Math.round(baseSeverity * categoryWeight * decay),
        daysAgo: Math.floor((Date.now() - new Date(incident.incident_date)) / 86400000)
      };
    });
    res.json(annotated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete incident
// DELETE /api/athlete/:athleteId/controversy/:incidentId
app.delete('/api/athlete/:athleteId/controversy/:incidentId', async (req, res) => {
  const { athleteId, incidentId } = req.params;
  try {
    const { error } = await supabase.from('athlete_controversies').delete().eq('id', incidentId).eq('athlete_id', athleteId);
    if (error) throw error;
    res.json({ success: true, message: 'Incident removed.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Legacy endpoints — kept for backward compatibility with existing Postman/scripts
app.post('/api/athlete/controversy/add', async (req, res) => {
  const { athleteId, incident } = req.body;
  if (!athleteId || !incident) return res.status(400).json({ error: 'Missing required fields: athleteId, incident' });
  if (!incident.title || !incident.date || !incident.source) return res.status(400).json({ error: 'Incident must have title, date, and source' });
  try {
    const { data: athlete, error: fetchError } = await supabase.from('athletes').select('manual_controversy_incidents').eq('id', athleteId).single();
    if (fetchError) throw fetchError;
    const currentIncidents = athlete?.manual_controversy_incidents || [];
    const severity = incident.severity || 'medium';
    const points = severity === 'low' ? 8 : severity === 'high' ? 24 : 16;
    const newIncident = { id: Date.now().toString(), title: incident.title, date: incident.date, source: incident.source, severity, points, added_at: new Date().toISOString(), notes: incident.notes || '' };
    const updatedIncidents = [...currentIncidents, newIncident];
    const { error: updateError } = await supabase.from('athletes').update({ manual_controversy_incidents: updatedIncidents }).eq('id', athleteId);
    if (updateError) throw updateError;
    console.log(`✅ Legacy incident added for ${athleteId}: ${newIncident.title}`);
    res.json({ success: true, incident: newIncident, total_incidents: updatedIncidents.length, total_points: updatedIncidents.reduce((s, i) => s + i.points, 0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/athlete/controversy/remove', async (req, res) => {
  const { athleteId, incidentId } = req.body;
  if (!athleteId || !incidentId) return res.status(400).json({ error: 'Missing required fields' });
  try {
    const { data: athlete, error: fetchError } = await supabase.from('athletes').select('manual_controversy_incidents').eq('id', athleteId).single();
    if (fetchError) throw fetchError;
    const updated = (athlete?.manual_controversy_incidents || []).filter(i => i.id !== incidentId);
    if (updated.length === (athlete?.manual_controversy_incidents || []).length) return res.status(404).json({ error: 'Incident not found' });
    const { error: updateError } = await supabase.from('athletes').update({ manual_controversy_incidents: updated }).eq('id', athleteId);
    if (updateError) throw updateError;
    res.json({ success: true, removed_id: incidentId, remaining_incidents: updated.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/athlete/controversy/list/:athleteId', async (req, res) => {
  try {
    const { data: athlete, error } = await supabase.from('athletes').select('manual_controversy_incidents, name').eq('id', req.params.athleteId).single();
    if (error) throw error;
    const incidents = athlete?.manual_controversy_incidents || [];
    res.json({ athlete_id: req.params.athleteId, athlete_name: athlete?.name, incidents, total_incidents: incidents.length, total_points: incidents.reduce((s, i) => s + i.points, 0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== DAILY UPDATE ====================

async function runDailyUpdate() {
  console.log('\n🔄 DAILY UPDATE');
  try {
    const { data: athletes, error } = await supabase.from('athletes').select('*').eq('active', true);
    if (error) throw error;
    for (const a of athletes || []) {
      await collectAthleteData(a.id, a.name, a.twitter_handle, a.instagram_business_id, a.country, a.sport || 'football');
      await new Promise(r => setTimeout(r, 5000));
    }
    console.log('✅ Daily update done');
    return { success: true, updated: (athletes || []).length };
  } catch (e) {
    console.error('❌ Daily update failed:', e);
    throw e;
  }
}

cron.schedule('0 6 * * *', runDailyUpdate);

app.get('/api/cron/daily', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.query.secret !== secret) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const result = await runDailyUpdate();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== START ====================

app.listen(PORT, () => {
  console.log('\n🚀 Blue & Lintell Backend v2.0 on port', PORT);
  console.log('   Endpoints:');
  console.log('   GET  /api/health');
  console.log('   GET  /api/athletes/list');
  console.log('   POST /api/athletes');
  console.log('   POST /api/athlete/onboard          ← NEW: creates athlete + career profile');
  console.log('   GET  /api/athlete/:id');
  console.log('   GET  /api/athlete/:id/history/:days');
  console.log('   GET  /api/athlete/:id/rolling/:days');
  console.log('   PUT  /api/athlete/:id/career        ← NEW: update career profile');
  console.log('   POST /api/athlete/:id/controversy   ← NEW: classified incident logging');
  console.log('   GET  /api/athlete/:id/controversy   ← NEW: incidents with decay info');
  console.log('   POST /api/athlete/refresh');
  console.log('   GET  /api/athletes');
  console.log('   GET  /api/cron/daily\n');
});

module.exports = app;

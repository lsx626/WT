const express = require('express');
const path = require('path');
const fsSync = require('fs');
const fs = require('fs/promises');
const { nanoid } = require('nanoid');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_CONTENT_PATH = path.join(__dirname, 'data', 'content.json');
const DB_RUNTIME_PATH = path.join(__dirname, 'data', 'runtime.json');
const JUDGE_PASSWORD = process.env.JUDGE_PASSWORD || '777777';
const JUDGE_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TEAMS = 4;
const MAX_TEAM_MEMBERS = 4;
const RUNTIME_SCHEMA_VERSION = 2;
const TEAM_STATION_CODE_SEQUENCES = {
  1: ['A', 'B', 'C', 'D'],
  2: ['B', 'C', 'A', 'D'],
  3: ['C', 'A', 'B', 'D'],
  4: ['D', 'C', 'B', 'A']
};
const STATION_CODE_TO_ID = {
  A: 's4',
  B: 's2',
  C: 's3',
  D: 's1',
  X: 's5'
};
const FINAL_POEM_CLUES = [
  '谁家庭院落残红，\n红雨三千湿缃缥。\n缥缈难招长恨魄，\n魄归碧落路迢迢。',
  '迢迢云海化烟灰，\n灰冷难回望帝心。\n心事终随马嵬血，\n血污泥埋旧铃音。',
  '音沉独对海棠残，\n棠棣难寻连理枝。\n枝冷孤灯人不寐，\n寐中唯见月如钩。'
];
const TEAM_POEM_ORDERS = {
  1: [2, 0, 1],
  2: [1, 2, 0],
  3: [0, 2, 1],
  4: [1, 0, 2]
};
const FINAL_IMAGE_CLUE_TEXT = '终极线索如下图：';
const FINAL_IMAGE_CLUE_URL = '/route-images/final-clue.png';
const FINAL_IMAGE_CLUE_PATH = path.join(__dirname, 'public', 'route-images', 'final-clue.png');
const FINAL_DESTINATION_ANSWER = '相辉堂';
const judgeSessions = new Map();
const teamSwitchTokens = new Map();
const TEAM_SWITCH_TOKEN_TTL_MS = 10 * 60 * 1000;

function generateTeamSwitchToken() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function cleanupExpiredTeamSwitchTokens() {
  const now = Date.now();
  for (const [token, expiresAt] of teamSwitchTokens.entries()) {
    if (now >= expiresAt) {
      teamSwitchTokens.delete(token);
    }
  }
}

function sanitizeTeamMembers(members) {
  if (!Array.isArray(members)) {
    return [];
  }

  return members
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, MAX_TEAM_MEMBERS);
}

function sanitizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function sanitizeBoughtHints(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.entries(value).reduce((acc, [stationId, count]) => {
    const key = String(stationId || '').trim();
    if (!key) {
      return acc;
    }

    const safeCount = Math.max(0, Number(count || 0));
    if (!Number.isFinite(safeCount)) {
      return acc;
    }

    acc[key] = Math.floor(safeCount);
    return acc;
  }, {});
}

function sanitizeClues(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const stationId = String(item?.stationId || '').trim();
      const routeQuestionId = String(item?.routeQuestionId || '').trim();
      const clue = String(item?.clue || '').trim();
      const clueImageUrl = String(item?.clueImageUrl || '').trim();
      if ((!stationId && !routeQuestionId) || (!clue && !clueImageUrl)) {
        return null;
      }

      const rawAt = String(item?.at || '').trim();
      const at = rawAt || new Date().toISOString();
      return {
        stationId: stationId || null,
        routeQuestionId: routeQuestionId || null,
        clue: clue || '（图片线索）',
        clueImageUrl: clueImageUrl || null,
        at
      };
    })
    .filter(Boolean);
}

function sanitizeTeamRecord(team, fallbackIndex = 0) {
  const safeTeam = team && typeof team === 'object' ? team : {};
  const safeNumber = Number.isInteger(safeTeam.number) && safeTeam.number > 0 ? safeTeam.number : fallbackIndex + 1;
  return {
    id: String(safeTeam.id || '').trim() || `team-${safeNumber}`,
    number: safeNumber,
    name: String(safeTeam.name || '').trim() || `第${safeNumber}组`,
    members: sanitizeTeamMembers(safeTeam.members),
    points: Number.isFinite(Number(safeTeam.points)) ? Number(safeTeam.points) : 0,
    solvedStations: sanitizeStringArray(safeTeam.solvedStations),
    solvedRouteQuestions: sanitizeStringArray(safeTeam.solvedRouteQuestions),
    clues: sanitizeClues(safeTeam.clues),
    boughtHints: sanitizeBoughtHints(safeTeam.boughtHints),
    finalAnswerVerified: safeTeam.finalAnswerVerified === true,
    releasedStationOrder: Number.isInteger(safeTeam.releasedStationOrder) && safeTeam.releasedStationOrder > 0
      ? safeTeam.releasedStationOrder
      : 1,
    createdAt: String(safeTeam.createdAt || '').trim() || new Date().toISOString()
  };
}

function sanitizeSubmissionRecord(submission) {
  const safeSubmission = submission && typeof submission === 'object' ? submission : {};
  return {
    id: String(safeSubmission.id || '').trim() || nanoid(10),
    teamId: String(safeSubmission.teamId || '').trim() || '',
    stationId: safeSubmission.stationId == null ? null : String(safeSubmission.stationId || '').trim() || null,
    routeQuestionId: safeSubmission.routeQuestionId == null ? null : String(safeSubmission.routeQuestionId || '').trim() || null,
    answer: safeSubmission.answer == null ? null : String(safeSubmission.answer || ''),
    result: String(safeSubmission.result || '').trim() || 'unknown',
    delta: Number.isFinite(Number(safeSubmission.delta)) ? Number(safeSubmission.delta) : 0,
    reason: safeSubmission.reason == null ? undefined : String(safeSubmission.reason || ''),
    at: String(safeSubmission.at || '').trim() || new Date().toISOString()
  };
}

app.set('trust proxy', 1);
app.use(express.json());
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const acceptHeader = String(req.headers.accept || '');
    const isHtmlEntry = acceptHeader.includes('text/html') || req.path === '/' || req.path === '/judge' || req.path === '/player';
    if (isHtmlEntry) {
      // Ask supported browsers to clear cached resources for this origin immediately.
      res.setHeader('Clear-Site-Data', '"cache"');
    }
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (_, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeContentDb(contentDb) {
  return {
    stations: Array.isArray(contentDb?.stations) ? contentDb.stations : [],
    routeQuestions: contentDb?.routeQuestions && typeof contentDb.routeQuestions === 'object'
      ? contentDb.routeQuestions
      : {}
  };
}

function sanitizeRuntimeDb(runtimeDb) {
  const teams = Array.isArray(runtimeDb?.teams)
    ? runtimeDb.teams.map((team, index) => sanitizeTeamRecord(team, index))
    : [];

  const submissions = Array.isArray(runtimeDb?.submissions)
    ? runtimeDb.submissions.map((item) => sanitizeSubmissionRecord(item))
    : [];

  const settings = {
    teamSwitchEnabled: runtimeDb?.settings?.teamSwitchEnabled !== false
  };

  return {
    version: RUNTIME_SCHEMA_VERSION,
    teams,
    submissions,
    settings
  };
}

async function ensureSplitDbFiles() {
  const [hasContent, hasRuntime] = await Promise.all([
    fileExists(DB_CONTENT_PATH),
    fileExists(DB_RUNTIME_PATH)
  ]);

  if (hasContent && hasRuntime) {
    return;
  }

  const contentDb = sanitizeContentDb({});
  const runtimeDb = sanitizeRuntimeDb({});
  if (!hasContent) {
    await fs.writeFile(DB_CONTENT_PATH, `${JSON.stringify(contentDb, null, 2)}\n`, 'utf8');
  }
  if (!hasRuntime) {
    await fs.writeFile(DB_RUNTIME_PATH, `${JSON.stringify(runtimeDb, null, 2)}\n`, 'utf8');
  }
}

async function readDb() {
  await ensureSplitDbFiles();
  const [rawContent, rawRuntime] = await Promise.all([
    fs.readFile(DB_CONTENT_PATH, 'utf8'),
    fs.readFile(DB_RUNTIME_PATH, 'utf8')
  ]);

  const contentDb = sanitizeContentDb(JSON.parse(rawContent));
  const runtimeDb = sanitizeRuntimeDb(JSON.parse(rawRuntime));
  return {
    ...contentDb,
    ...runtimeDb
  };
}

let writeQueue = Promise.resolve();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

async function mutateDb(mutator) {
  let result;
  writeQueue = writeQueue.then(async () => {
    const db = await readDb();
    result = await mutator(db);
    const contentDb = sanitizeContentDb(db);
    const runtimeDb = sanitizeRuntimeDb(db);
    await Promise.all([
      fs.writeFile(DB_CONTENT_PATH, `${JSON.stringify(contentDb, null, 2)}\n`, 'utf8'),
      fs.writeFile(DB_RUNTIME_PATH, `${JSON.stringify(runtimeDb, null, 2)}\n`, 'utf8')
    ]);
  });
  await writeQueue;
  return result;
}

function normalizeAnswer(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function roundScore(value) {
  return Math.round(value * 2) / 2;
}

function isValidHalfStepNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return false;
  }
  return Number.isInteger(value * 2);
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(';').reduce((acc, pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (!key) {
      return acc;
    }
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function isJudgeAuthed(req) {
  const token = parseCookies(req).judge_session;
  if (!token) {
    return false;
  }

  const expiresAt = judgeSessions.get(token);
  if (!expiresAt) {
    return false;
  }

  if (Date.now() >= expiresAt) {
    judgeSessions.delete(token);
    return false;
  }

  return true;
}

function requireJudgeAuth(req, res, next) {
  if (!isJudgeAuthed(req)) {
    return res.status(401).json({ message: '裁判端未登录。' });
  }
  return next();
}

function getRouteKeyByTeamNumber(routeQuestions, teamNumber) {
  const routeKeys = Object.keys(routeQuestions || {}).sort();
  if (!routeKeys.length) {
    return null;
  }

  const normalizedTeamNumber = Number.isInteger(teamNumber) && teamNumber > 0 ? teamNumber : 1;
  const routeIndex = (normalizedTeamNumber - 1) % routeKeys.length;
  return routeKeys[routeIndex];
}

function getRouteLetter(routeQuestions, routeKey) {
  const fixedMap = {
    route1: 'A',
    route2: 'B',
    route3: 'C',
    route4: 'D'
  };

  if (routeKey && fixedMap[routeKey]) {
    return fixedMap[routeKey];
  }

  if (!routeKey) {
    return 'A';
  }

  const routeKeys = Object.keys(routeQuestions || {}).sort();
  const routeIndex = routeKeys.indexOf(routeKey);
  if (routeIndex < 0) {
    return 'A';
  }

  return String.fromCharCode('A'.charCodeAt(0) + routeIndex);
}

function getTeamDisplayName(teamNumber, fallbackNumber = 1) {
  const normalizedNumber = Number.isInteger(teamNumber) && teamNumber > 0 ? teamNumber : fallbackNumber;
  return `第${normalizedNumber}组`;
}

function getTeamStationCodeSequence(teamNumber) {
  const normalizedTeamNumber = Number.isInteger(teamNumber) && teamNumber > 0 ? teamNumber : 1;
  return TEAM_STATION_CODE_SEQUENCES[normalizedTeamNumber] || TEAM_STATION_CODE_SEQUENCES[1];
}

function getTeamStationIdSequence(stations, teamNumber) {
  const stationList = Array.isArray(stations) ? stations : [];
  const stationMap = new Map(stationList.map((station) => [station.id, station]));
  const sequence = [];
  const usedIds = new Set();
  const routeCodes = getTeamStationCodeSequence(teamNumber);

  routeCodes.forEach((code) => {
    const stationId = STATION_CODE_TO_ID[code];
    if (!stationId || !stationMap.has(stationId) || usedIds.has(stationId)) {
      return;
    }

    usedIds.add(stationId);
    sequence.push({ id: stationId, code });
  });

  const finishId = STATION_CODE_TO_ID.X;
  if (finishId && stationMap.has(finishId) && !usedIds.has(finishId)) {
    usedIds.add(finishId);
    sequence.push({ id: finishId, code: 'X' });
  }

  const remainingStations = stationList
    .filter((station) => !usedIds.has(station.id))
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

  remainingStations.forEach((station) => {
    usedIds.add(station.id);
    sequence.push({ id: station.id, code: String(station.order || '') });
  });

  return sequence;
}

function getStationProgressIndexForTeam(stations, teamNumber, stationId) {
  const sequence = getTeamStationIdSequence(stations, teamNumber);
  return sequence.findIndex((item) => item.id === stationId);
}

function getReleasedStationIdSet(stations, team) {
  const releasedOrder = Number(team?.releasedStationOrder || 1);
  return new Set(
    getTeamStationIdSequence(stations, team?.number)
      .slice(0, releasedOrder)
      .map((item) => item.id)
  );
}

function getTeamPoemOrder(teamNumber) {
  const normalizedTeamNumber = Number.isInteger(teamNumber) && teamNumber > 0 ? teamNumber : 1;
  return TEAM_POEM_ORDERS[normalizedTeamNumber] || TEAM_POEM_ORDERS[1];
}

function getStationClueForTeam(stations, team, station) {
  const progressIndex = getStationProgressIndexForTeam(stations, team?.number, station?.id);

  if (progressIndex >= 0 && progressIndex < 3) {
    const poemOrder = getTeamPoemOrder(team?.number);
    const poemIndex = poemOrder[progressIndex];
    return {
      clue: FINAL_POEM_CLUES[poemIndex],
      clueImageUrl: null
    };
  }

  if (progressIndex === 3) {
    const hasFinalImageClue = fsSync.existsSync(FINAL_IMAGE_CLUE_PATH);
    return {
      clue: hasFinalImageClue ? FINAL_IMAGE_CLUE_TEXT : '终极线索截图暂未配置，请联系裁判。',
      clueImageUrl: hasFinalImageClue ? FINAL_IMAGE_CLUE_URL : null
    };
  }

  return {
    clue: null,
    clueImageUrl: null
  };
}

function getTeamRouteQuestionByOrder(db, team, order) {
  const routeKey = getRouteKeyByTeamNumber(db.routeQuestions, team?.number);
  if (!routeKey) {
    return null;
  }

  const routeQuestions = db.routeQuestions?.[routeKey] || [];
  if (!Array.isArray(routeQuestions) || order <= 0) {
    return null;
  }

  return routeQuestions[order - 1] || null;
}

function ensureTeamProgressStructure(team, stations) {
  team.members = sanitizeTeamMembers(team.members);
  if (!Array.isArray(team.solvedStations)) {
    team.solvedStations = [];
  }
  if (!Array.isArray(team.clues)) {
    team.clues = [];
  }
  if (!Array.isArray(team.solvedRouteQuestions)) {
    team.solvedRouteQuestions = [];
  }
  if (!team.boughtHints || typeof team.boughtHints !== 'object') {
    team.boughtHints = {};
  }
  if (team.finalAnswerVerified !== true) {
    team.finalAnswerVerified = false;
  }
  if (!Number.isInteger(team.releasedStationOrder) || team.releasedStationOrder < 1) {
    team.releasedStationOrder = 1;
  }

  const stationSequence = getTeamStationIdSequence(stations, team.number);
  const maxReleasedOrder = Math.max(1, stationSequence.length || 1);
  if (team.releasedStationOrder > maxReleasedOrder) {
    team.releasedStationOrder = maxReleasedOrder;
  }
}

app.get('/api/judge/session', (req, res) => {
  res.json({ authed: isJudgeAuthed(req) });
});

app.get('/api/settings', async (_, res) => {
  const db = await readDb();
  const teamSwitchEnabled = db?.settings?.teamSwitchEnabled !== false;
  res.json({ teamSwitchEnabled });
});

app.get('/api/judge/settings', requireJudgeAuth, async (_, res) => {
  const db = await readDb();
  const teamSwitchEnabled = db?.settings?.teamSwitchEnabled !== false;
  res.json({ teamSwitchEnabled });
});

app.patch('/api/judge/settings', requireJudgeAuth, asyncHandler(async (req, res) => {
  const nextTeamSwitchEnabled = req.body?.teamSwitchEnabled;
  if (typeof nextTeamSwitchEnabled !== 'boolean') {
    throw new HttpError(400, 'teamSwitchEnabled 必须是布尔值。');
  }

  const payload = await mutateDb((db) => {
    db.settings = db.settings && typeof db.settings === 'object' ? db.settings : {};
    db.settings.teamSwitchEnabled = nextTeamSwitchEnabled;

    if (!nextTeamSwitchEnabled) {
      teamSwitchTokens.clear();
    }

    return { teamSwitchEnabled: db.settings.teamSwitchEnabled };
  });

  res.json(payload);
}));

app.post('/api/judge/login', (req, res) => {
  const { password } = req.body || {};
  if (String(password || '') !== JUDGE_PASSWORD) {
    return res.status(401).json({ message: '密码错误。' });
  }

  const sessionToken = crypto.randomBytes(24).toString('hex');
  judgeSessions.set(sessionToken, Date.now() + JUDGE_SESSION_TTL_MS);
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const secureAttr = isHttps ? '; Secure' : '';

  res.setHeader(
    'Set-Cookie',
    `judge_session=${sessionToken}; Path=/; Max-Age=86400; SameSite=Lax; HttpOnly${secureAttr}`
  );
  return res.json({ ok: true });
});

app.post('/api/judge/logout', (req, res) => {
  const token = parseCookies(req).judge_session;
  if (token) {
    judgeSessions.delete(token);
  }

  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const secureAttr = isHttps ? '; Secure' : '';
  res.setHeader('Set-Cookie', `judge_session=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly${secureAttr}`);
  res.json({ ok: true });
});

app.post('/api/judge/team-switch-token', requireJudgeAuth, (_, res) => {
  cleanupExpiredTeamSwitchTokens();

  readDb().then((db) => {
    const teamSwitchEnabled = db?.settings?.teamSwitchEnabled !== false;
    if (!teamSwitchEnabled) {
      return res.status(400).json({ message: '重选功能已关闭，请先在裁判端开启。' });
    }

    let token = generateTeamSwitchToken();
    while (teamSwitchTokens.has(token)) {
      token = generateTeamSwitchToken();
    }

    const expiresAt = Date.now() + TEAM_SWITCH_TOKEN_TTL_MS;
    teamSwitchTokens.set(token, expiresAt);

    return res.json({
      token,
      expiresAt,
      ttlSeconds: Math.floor(TEAM_SWITCH_TOKEN_TTL_MS / 1000)
    });
  }).catch(() => {
    res.status(500).json({ message: '服务器内部错误。' });
  });
});

app.post('/api/team-switch/unlock', (req, res) => {
  cleanupExpiredTeamSwitchTokens();
  readDb().then((db) => {
    const teamSwitchEnabled = db?.settings?.teamSwitchEnabled !== false;
    if (!teamSwitchEnabled) {
      return res.status(403).json({ message: '当前活动阶段已关闭重选功能，请联系裁判。' });
    }

    const token = String(req.body?.token || '').trim().toUpperCase();
    if (!token) {
      return res.status(400).json({ message: '请填写裁判提供的重选码。' });
    }

    const expiresAt = teamSwitchTokens.get(token);
    if (!expiresAt || Date.now() >= expiresAt) {
      teamSwitchTokens.delete(token);
      return res.status(400).json({ message: '重选码无效或已过期，请联系裁判重新生成。' });
    }

    teamSwitchTokens.delete(token);
    return res.json({ ok: true, message: '已验证通过，可重新选择组别。' });
  }).catch(() => {
    res.status(500).json({ message: '服务器内部错误。' });
  });
});

app.get('/api/teams', async (_, res) => {
  const db = await readDb();
  const solvedAnswerMapByTeam = new Map();

  for (const submission of db.submissions || []) {
    const teamId = String(submission?.teamId || '').trim();
    if (!teamId) {
      continue;
    }

    let bag = solvedAnswerMapByTeam.get(teamId);
    if (!bag) {
      bag = { stations: {}, routes: {} };
      solvedAnswerMapByTeam.set(teamId, bag);
    }

    if (submission?.result === 'correct' && submission?.stationId) {
      const stationId = String(submission.stationId || '').trim();
      const answer = String(submission.answer || '').trim();
      if (stationId && answer) {
        bag.stations[stationId] = answer;
      }
    }

    if (submission?.result === 'route-correct' && submission?.routeQuestionId) {
      const routeQuestionId = String(submission.routeQuestionId || '').trim();
      const answer = String(submission.answer || '').trim();
      if (routeQuestionId && answer) {
        bag.routes[routeQuestionId] = answer;
      }
    }
  }

  res.json(
    db.teams.map((team, index) => {
      const normalizedNumber = Number.isInteger(team.number) ? team.number : index + 1;
      team.number = normalizedNumber;
      ensureTeamProgressStructure(team, db.stations);

      const routeKey = getRouteKeyByTeamNumber(db.routeQuestions, normalizedNumber);
      const routeLetter = getRouteLetter(db.routeQuestions, routeKey);
      const routeQuestions = routeKey ? (db.routeQuestions?.[routeKey] || []) : [];
      const firstQuestion = routeQuestions[0] || null;
      const stationSequence = getTeamStationIdSequence(db.stations, normalizedNumber);
      const releasedIndex = Math.max(0, Math.min(stationSequence.length - 1, (team.releasedStationOrder || 1) - 1));
      const releasedStation = stationSequence[releasedIndex] || null;
      const purchasedHints = Object.entries(team.boughtHints && typeof team.boughtHints === 'object' ? team.boughtHints : {})
        .reduce((acc, [stationId, count]) => {
          const station = db.stations.find((item) => item.id === stationId);
          const hints = Array.isArray(station?.hints) ? station.hints : [];
          const boughtCount = Math.max(0, Number(count || 0));
          if (!hints.length || !boughtCount) {
            return acc;
          }

          acc[stationId] = hints.slice(0, boughtCount);
          return acc;
        }, {});
      const solvedAnswerBag = solvedAnswerMapByTeam.get(team.id) || { stations: {}, routes: {} };

      return {
        ...team,
        number: normalizedNumber,
        name: getTeamDisplayName(normalizedNumber, index + 1),
        solvedRouteQuestions: Array.isArray(team.solvedRouteQuestions) ? team.solvedRouteQuestions : [],
        solvedStations: Array.isArray(team.solvedStations) ? team.solvedStations : [],
        clues: Array.isArray(team.clues) ? team.clues : [],
        solvedStationAnswers: solvedAnswerBag.stations,
        solvedRouteAnswers: solvedAnswerBag.routes,
        boughtHints: team.boughtHints && typeof team.boughtHints === 'object' ? team.boughtHints : {},
        finalAnswerVerified: team.finalAnswerVerified === true,
        purchasedHints,
        releasedStationOrder: Number.isInteger(team.releasedStationOrder) && team.releasedStationOrder > 0
          ? team.releasedStationOrder
          : 1,
        stationSequence,
        routeUnlockStationId: stationSequence[0]?.id || 's1',
        releasedStationCode: releasedStation?.code || '',
        releasedStationId: releasedStation?.id || '',
        routeRiddles: (() => {
          return routeQuestions.map((item, itemIndex) => ({
            id: item.id,
            order: itemIndex + 1,
            code: `${routeLetter}${itemIndex + 1}`,
            question: item.question,
            questionImageUrl: item.questionImageUrl || '',
            clue: item.clue || null,
            clueImageUrl: item.clueImageUrl || null,
            formatHint: item.formatHint || '',
            points: Number(item.points || 0)
          }));
        })(),
        firstRiddle: (() => {
          if (!firstQuestion) {
            return null;
          }

          return {
            routeKey,
            routeLetter,
            id: firstQuestion.id,
            code: `${routeLetter}1`,
            question: firstQuestion.question,
            questionImageUrl: firstQuestion.questionImageUrl || '',
            clue: firstQuestion.clue || null,
            clueImageUrl: firstQuestion.clueImageUrl || null,
            formatHint: firstQuestion.formatHint || '',
            points: Number(firstQuestion.points || 0)
          };
        })()
      };
    })
  );
});

app.post(
  '/api/teams',
  requireJudgeAuth,
  asyncHandler(async (_, res) => {
    const team = await mutateDb((db) => {
      if (db.teams.length >= MAX_TEAMS) {
        throw new HttpError(400, `最多只能创建 ${MAX_TEAMS} 组。`);
      }

      const nextNumber = db.teams.length + 1;
      const nextTeam = {
        id: nanoid(8),
        number: nextNumber,
        name: getTeamDisplayName(nextNumber),
        members: [],
        points: 3,
        solvedStations: [],
        solvedRouteQuestions: [],
        clues: [],
        boughtHints: {},
        finalAnswerVerified: false,
        releasedStationOrder: 1,
        createdAt: new Date().toISOString()
      };

      db.teams.push(nextTeam);
      return nextTeam;
    });

    res.status(201).json(team);
  })
);

app.patch('/api/teams/:teamId/points', requireJudgeAuth, asyncHandler(async (req, res) => {
  const { teamId } = req.params;
  const { delta, reason = '地点体育活动加分' } = req.body || {};
  const parsedDelta = Number(delta);
  const allowedDeltas = new Set([1, 2, 3, 4]);

  if (!allowedDeltas.has(parsedDelta)) {
    throw new HttpError(400, '裁判加分仅允许 +1、+2、+3、+4。');
  }

  const team = await mutateDb((db) => {
    const targetTeam = db.teams.find((item) => item.id === teamId);
    if (!targetTeam) {
      throw new HttpError(404, '队伍不存在。');
    }

    targetTeam.points = Math.max(0, roundScore(targetTeam.points + parsedDelta));
    db.submissions.push({
      id: nanoid(10),
      teamId,
      stationId: null,
      answer: null,
      result: 'judge-points',
      delta: parsedDelta,
      reason: String(reason),
      at: new Date().toISOString()
    });

    return targetTeam;
  });

  res.json(team);
}));

app.post('/api/teams/:teamId/release-next', requireJudgeAuth, asyncHandler(async (req, res) => {
  const { teamId } = req.params;
  const rawPoints = Number(req.body?.activityPoints);
  if (![1, 2, 3, 4].includes(rawPoints)) {
    throw new HttpError(400, 'activityPoints 仅允许 1、2、3、4。');
  }

  const payload = await mutateDb((db) => {
    const team = db.teams.find((item) => item.id === teamId);
    if (!team) {
      throw new HttpError(404, '队伍不存在。');
    }
    ensureTeamProgressStructure(team, db.stations);

    const stationSequence = getTeamStationIdSequence(db.stations, team.number);
    const maxOrder = Math.max(1, stationSequence.length || 1);
    const addedPoints = rawPoints;
    team.points = Math.max(0, roundScore(team.points + addedPoints));

    const currentIndex = Math.max(0, Math.min(maxOrder - 1, (team.releasedStationOrder || 1) - 1));
    const completedStation = stationSequence[currentIndex] || null;
    if (completedStation) {
      if (!team.solvedStations.includes(completedStation.id)) {
        team.solvedStations.push(completedStation.id);
      }

      const hasStationClue = team.clues.some((item) => item.stationId === completedStation.id);
      if (!hasStationClue) {
        const clueData = getStationClueForTeam(db.stations, team, completedStation);
        if (clueData.clue || clueData.clueImageUrl) {
          team.clues.push({
            stationId: completedStation.id,
            routeQuestionId: null,
            clue: clueData.clue || '（图片线索）',
            clueImageUrl: clueData.clueImageUrl || null,
            at: new Date().toISOString()
          });
        }
      }
    }

    if (team.releasedStationOrder >= maxOrder) {
      const releasedStation = stationSequence[Math.max(0, maxOrder - 1)] || null;
      db.submissions.push({
        id: nanoid(10),
        teamId,
        stationId: null,
        answer: null,
        result: 'judge-points',
        delta: addedPoints,
        reason: '地点体育活动加分（末站）',
        at: new Date().toISOString()
      });

      return {
        points: team.points,
        addedPoints,
        releasedStationOrder: team.releasedStationOrder,
        releasedStationCode: releasedStation?.code || '',
        releasedStationId: releasedStation?.id || '',
        isMax: true
      };
    }

    team.releasedStationOrder += 1;
    const releasedStation = stationSequence[Math.max(0, team.releasedStationOrder - 1)] || null;
    db.submissions.push({
      id: nanoid(10),
      teamId,
      stationId: null,
      answer: null,
      result: 'release-next',
      delta: addedPoints,
      reason: `裁判放行 ${releasedStation?.code || `${team.releasedStationOrder}号地点`}`,
      at: new Date().toISOString()
    });

    return {
      points: team.points,
      addedPoints,
      releasedStationOrder: team.releasedStationOrder,
      releasedStationCode: releasedStation?.code || '',
      releasedStationId: releasedStation?.id || '',
      isMax: false
    };
  });

  res.json(payload);
}));

app.post('/api/stations/:stationId/hint', asyncHandler(async (req, res) => {
  const { stationId } = req.params;
  const { teamId } = req.body || {};

  const result = await mutateDb((db) => {
    const team = db.teams.find((item) => item.id === teamId);
    if (!team) {
      throw new HttpError(404, '队伍不存在。');
    }
    ensureTeamProgressStructure(team, db.stations);

    const station = db.stations.find((item) => item.id === stationId);
    if (!station) {
      throw new HttpError(404, '关卡不存在。');
    }

    const releasedStationIds = getReleasedStationIdSet(db.stations, team);
    if (!releasedStationIds.has(stationId)) {
      throw new HttpError(400, '该地点尚未由裁判放行，暂不能购买线索。');
    }

    const hints = Array.isArray(station.hints) ? station.hints : [];
    if (!hints.length) {
      throw new HttpError(400, '该题暂无线索可购买。');
    }

    if (team.points < 1) {
      throw new HttpError(400, '分数不足，无法购买线索。');
    }

    const boughtCount = Number(team.boughtHints?.[stationId] || 0);
    if (boughtCount >= hints.length) {
      throw new HttpError(400, '该题线索已全部购买。');
    }

    team.boughtHints = team.boughtHints || {};
    team.boughtHints[stationId] = boughtCount + 1;
    team.points = roundScore(Math.max(0, team.points - 1));

    const purchasedHint = hints[boughtCount];
    db.submissions.push({
      id: nanoid(10),
      teamId,
      stationId,
      answer: null,
      result: 'buy-hint',
      delta: -1,
      reason: `购买线索 #${boughtCount + 1}`,
      at: new Date().toISOString()
    });

    return {
      hint: purchasedHint,
      points: team.points,
      boughtCount: team.boughtHints[stationId],
      leftCount: hints.length - team.boughtHints[stationId]
    };
  });

  return res.status(200).json(result);
}));

app.get('/api/stations', async (_, res) => {
  const db = await readDb();
  const stations = db.stations.map(({ answer, hints, ...safe }) => ({
    ...safe,
    hintCount: Array.isArray(hints) ? hints.length : 0
  }));
  res.json(stations);
});

app.get('/api/teams/:teamId/first-riddle', asyncHandler(async (req, res) => {
  const { teamId } = req.params;
  const db = await readDb();
  const team = db.teams.find((item) => item.id === teamId);
  if (!team) {
    throw new HttpError(404, '队伍不存在。');
  }

  const routeKey = getRouteKeyByTeamNumber(db.routeQuestions, team.number);
  if (!routeKey) {
    throw new HttpError(404, '未配置路线题。');
  }

  const firstQuestion = (db.routeQuestions[routeKey] || [])[0];
  if (!firstQuestion) {
    throw new HttpError(404, '该组路线暂无第一题。');
  }

  res.json({
    routeKey,
    question: {
      id: firstQuestion.id,
      question: firstQuestion.question,
      formatHint: firstQuestion.formatHint || '',
      points: Number(firstQuestion.points || 0)
    }
  });
}));

app.get('/api/leaderboard', async (_, res) => {
  const db = await readDb();
  const ranked = [...db.teams]
    .sort((a, b) => b.points - a.points || a.createdAt.localeCompare(b.createdAt))
    .map((team, index) => ({
      rank: index + 1,
      id: team.id,
      name: getTeamDisplayName(team.number, index + 1),
      points: team.points,
      solvedCount: team.solvedStations.length
    }));

  res.json(ranked);
});

app.post('/api/answer', asyncHandler(async (req, res) => {
  const { teamId, stationId, routeQuestionId, answer } = req.body || {};

  const result = await mutateDb((db) => {
    const team = db.teams.find((item) => item.id === teamId);
    if (!team) {
      throw new HttpError(404, '队伍不存在。');
    }
    ensureTeamProgressStructure(team, db.stations);

    if (!stationId && !routeQuestionId) {
      throw new HttpError(400, '缺少题目标识。');
    }

    if (routeQuestionId) {
      const routeKey = getRouteKeyByTeamNumber(db.routeQuestions, team.number);
      const routeQuestions = routeKey ? (db.routeQuestions?.[routeKey] || []) : [];
      const routeQuestion = routeQuestions.find((item) => item.id === routeQuestionId) || null;
      if (!routeQuestion) {
        throw new HttpError(404, '路线小谜题不存在。');
      }

      const resolvedRouteClue = String(routeQuestion.clue || '').trim() || null;
      const resolvedRouteClueImageUrl = String(routeQuestion.clueImageUrl || '').trim() || null;
      const solvedRouteClue = team.clues.find((item) => item.routeQuestionId === routeQuestionId);

      if (team.solvedRouteQuestions.includes(routeQuestionId)) {
        return {
          correct: true,
          alreadySolved: true,
          clue: solvedRouteClue?.clue || resolvedRouteClue,
          clueImageUrl: solvedRouteClue?.clueImageUrl || resolvedRouteClueImageUrl,
          points: team.points,
          message: '该小谜题已通过，重复提交不加分。'
        };
      }

      const isRouteCorrect = normalizeAnswer(answer) === normalizeAnswer(routeQuestion.answer);
      db.submissions.push({
        id: nanoid(10),
        teamId,
        stationId: null,
        routeQuestionId,
        answer: String(answer || ''),
        result: isRouteCorrect ? 'route-correct' : 'route-wrong',
        delta: isRouteCorrect ? Number(routeQuestion.points || 0) : 0,
        at: new Date().toISOString()
      });

      if (!isRouteCorrect) {
        return {
          correct: false,
          message: '小谜题答案不正确，请再检查现场线索。'
        };
      }

      team.solvedRouteQuestions.push(routeQuestionId);
      team.points = roundScore(team.points + Number(routeQuestion.points || 0));
      if (resolvedRouteClue || resolvedRouteClueImageUrl) {
        team.clues.push({
          stationId: null,
          routeQuestionId,
          clue: resolvedRouteClue || '路线线索已解锁。',
          clueImageUrl: resolvedRouteClueImageUrl,
          at: new Date().toISOString()
        });
      }

      return {
        correct: true,
        alreadySolved: false,
        clue: resolvedRouteClue,
        clueImageUrl: resolvedRouteClueImageUrl,
        points: team.points,
        gained: Number(routeQuestion.points || 0),
        message: Number(routeQuestion.points || 0) > 0
          ? `小谜题回答正确，+${routeQuestion.points} 分！`
          : '小谜题回答正确。'
      };
    }

    const station = db.stations.find((item) => item.id === stationId);
    if (!station) {
      throw new HttpError(404, '关卡不存在。');
    }

    const stationSequence = getTeamStationIdSequence(db.stations, team.number);
    const releasedStationIds = getReleasedStationIdSet(db.stations, team);
    if (!releasedStationIds.has(stationId)) {
      throw new HttpError(400, '该地点尚未由裁判放行。');
    }

    if (team.solvedStations.includes(stationId)) {
      const clueData = getStationClueForTeam(db.stations, team, station);
      return {
        correct: true,
        alreadySolved: true,
        clue: team.clues.find((item) => item.stationId === stationId)?.clue || clueData.clue || null,
        clueImageUrl: team.clues.find((item) => item.stationId === stationId)?.clueImageUrl || clueData.clueImageUrl || null,
        points: team.points,
        message: '该关卡已通过，重复提交不加分。'
      };
    }

    const expectedAnswer = station.answer;
    const clueData = getStationClueForTeam(db.stations, team, station);
    const resolvedClue = clueData.clue;
    const resolvedClueImageUrl = clueData.clueImageUrl;
    const isCorrect = normalizeAnswer(answer) === normalizeAnswer(expectedAnswer);
    db.submissions.push({
      id: nanoid(10),
      teamId,
      stationId,
      answer: String(answer || ''),
      result: isCorrect ? 'correct' : 'wrong',
      delta: 0,
      at: new Date().toISOString()
    });

    if (!isCorrect) {
      return {
        correct: false,
        message: '答案不正确，请再观察一下现场线索。'
      };
    }

    team.solvedStations.push(stationId);
    team.clues.push({
      stationId,
      clue: resolvedClue,
      clueImageUrl: resolvedClueImageUrl || null,
      at: new Date().toISOString()
    });

    return {
      correct: true,
      alreadySolved: false,
      clue: resolvedClue,
      clueImageUrl: resolvedClueImageUrl || null,
      points: team.points,
      gained: 0,
      message: '谜题验证通过。地点体育活动加分由裁判手动记录，并由裁判放行下一地点。'
    };
  });

  return res.status(200).json(result);
}));

async function handleFinalAnswerSubmission(teamId, answer) {
  return mutateDb((db) => {
    const team = db.teams.find((item) => item.id === teamId);
    if (!team) {
      throw new HttpError(404, '队伍不存在。');
    }
    ensureTeamProgressStructure(team, db.stations);

    if (team.finalAnswerVerified) {
      return {
        correct: true,
        alreadyVerified: true,
        message: '终点答案已验证通过。'
      };
    }

    const isCorrect = normalizeAnswer(answer) === normalizeAnswer(FINAL_DESTINATION_ANSWER);
    db.submissions.push({
      id: nanoid(10),
      teamId,
      stationId: null,
      routeQuestionId: null,
      answer: String(answer || ''),
      result: isCorrect ? 'final-correct' : 'final-wrong',
      delta: 0,
      at: new Date().toISOString()
    });

    if (!isCorrect) {
      return {
        correct: false,
        message: '终点答案不正确，请结合终极线索再确认。'
      };
    }

    team.finalAnswerVerified = true;
    return {
      correct: true,
      alreadyVerified: false,
      message: '终点答案验证通过，请前往终点打卡。'
    };
  });
}

app.post('/api/final-answer', asyncHandler(async (req, res) => {
  const { teamId, answer } = req.body || {};
  const result = await handleFinalAnswerSubmission(teamId, answer);
  return res.status(200).json(result);
}));

app.post('/api/teams/:teamId/final-answer', asyncHandler(async (req, res) => {
  const { teamId } = req.params;
  const result = await handleFinalAnswerSubmission(teamId, req.body?.answer);
  return res.status(200).json(result);
}));

app.use('/api', (_, res) => {
  res.status(404).json({ message: '接口不存在。' });
});

app.get('/judge', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'judge.html'));
});

app.get('/player', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, _, res, __) => {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ message: error.message });
  }

  return res.status(500).json({ message: '服务器内部错误。' });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`此间循迹已启动: http://localhost:${PORT}`);
});

const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const { nanoid } = require('nanoid');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_LEGACY_PATH = path.join(__dirname, 'data', 'db.json');
const DB_CONTENT_PATH = path.join(__dirname, 'data', 'content.json');
const DB_RUNTIME_PATH = path.join(__dirname, 'data', 'runtime.json');
const JUDGE_PASSWORD = process.env.JUDGE_PASSWORD || '777777';
const JUDGE_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const judgeSessions = new Map();

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
  return {
    teams: Array.isArray(runtimeDb?.teams) ? runtimeDb.teams : [],
    submissions: Array.isArray(runtimeDb?.submissions) ? runtimeDb.submissions : []
  };
}

function splitLegacyDb(legacyDb) {
  const contentDb = sanitizeContentDb({
    stations: legacyDb?.stations,
    routeQuestions: legacyDb?.routeQuestions
  });

  const runtimeDb = sanitizeRuntimeDb({
    teams: legacyDb?.teams,
    submissions: legacyDb?.submissions
  });

  return { contentDb, runtimeDb };
}

async function ensureSplitDbFiles() {
  const [hasContent, hasRuntime] = await Promise.all([
    fileExists(DB_CONTENT_PATH),
    fileExists(DB_RUNTIME_PATH)
  ]);

  if (hasContent && hasRuntime) {
    return;
  }

  let legacyDb = {};
  if (await fileExists(DB_LEGACY_PATH)) {
    const raw = await fs.readFile(DB_LEGACY_PATH, 'utf8');
    legacyDb = JSON.parse(raw);
  }

  const { contentDb, runtimeDb } = splitLegacyDb(legacyDb);
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

function ensureTeamProgressStructure(team) {
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
}

app.get('/api/judge/session', (req, res) => {
  res.json({ authed: isJudgeAuthed(req) });
});

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

app.get('/api/teams', async (_, res) => {
  const db = await readDb();
  res.json(
    db.teams.map((team, index) => {
      const normalizedNumber = Number.isInteger(team.number) ? team.number : index + 1;
      const routeKey = getRouteKeyByTeamNumber(db.routeQuestions, normalizedNumber);
      const routeLetter = getRouteLetter(db.routeQuestions, routeKey);
      const routeQuestions = routeKey ? (db.routeQuestions?.[routeKey] || []) : [];
      const firstQuestion = routeQuestions[0] || null;

      return {
        ...team,
        number: normalizedNumber,
        name: team.name || `${normalizedNumber}号组`,
        solvedRouteQuestions: Array.isArray(team.solvedRouteQuestions) ? team.solvedRouteQuestions : [],
        solvedStations: Array.isArray(team.solvedStations) ? team.solvedStations : [],
        clues: Array.isArray(team.clues) ? team.clues : [],
        boughtHints: team.boughtHints && typeof team.boughtHints === 'object' ? team.boughtHints : {},
        routeRiddles: (() => {
          return routeQuestions.map((item, itemIndex) => ({
            id: item.id,
            order: itemIndex + 1,
            code: `${routeLetter}${itemIndex + 1}`,
            question: item.question,
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
      const nextNumber = db.teams.length + 1;
      const nextTeam = {
        id: nanoid(8),
        number: nextNumber,
        name: `${nextNumber}号组`,
        members: [],
        points: 3,
        solvedStations: [],
        solvedRouteQuestions: [],
        clues: [],
        boughtHints: {},
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
  const { delta, reason = '人工调整' } = req.body || {};
  const parsedDelta = Number(delta);

  if (!isValidHalfStepNumber(parsedDelta)) {
    throw new HttpError(400, 'delta 必须是 0.5 的倍数。');
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
      result: 'manual',
      delta: parsedDelta,
      reason: String(reason),
      at: new Date().toISOString()
    });

    return targetTeam;
  });

  res.json(team);
}));

app.post('/api/stations/:stationId/hint', asyncHandler(async (req, res) => {
  const { stationId } = req.params;
  const { teamId } = req.body || {};

  const result = await mutateDb((db) => {
    const team = db.teams.find((item) => item.id === teamId);
    if (!team) {
      throw new HttpError(404, '队伍不存在。');
    }

    const station = db.stations.find((item) => item.id === stationId);
    if (!station) {
      throw new HttpError(404, '关卡不存在。');
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
      name: team.name || `${team.number || index + 1}号组`,
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
    ensureTeamProgressStructure(team);

    if (!stationId && !routeQuestionId) {
      throw new HttpError(400, '缺少题目标识。');
    }

    if (routeQuestionId) {
      const routeKey = getRouteKeyByTeamNumber(db.routeQuestions, team.number);
      const routeQuestions = routeKey ? (db.routeQuestions?.[routeKey] || []) : [];
      const routeQuestion = routeQuestions.find((item) => item.id === routeQuestionId);
      if (!routeQuestion) {
        throw new HttpError(404, '路线小谜题不存在。');
      }

      if (team.solvedRouteQuestions.includes(routeQuestionId)) {
        return {
          correct: true,
          alreadySolved: true,
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

      return {
        correct: true,
        alreadySolved: false,
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

    if (team.solvedStations.includes(stationId)) {
      return {
        correct: true,
        alreadySolved: true,
        clue: team.clues.find((item) => item.stationId === stationId)?.clue || station.clue,
        points: team.points,
        message: '该关卡已通过，重复提交不加分。'
      };
    }

    const expectedAnswer = station.answer;
    const resolvedClue = station.clue;
    const isCorrect = normalizeAnswer(answer) === normalizeAnswer(expectedAnswer);
    db.submissions.push({
      id: nanoid(10),
      teamId,
      stationId,
      answer: String(answer || ''),
      result: isCorrect ? 'correct' : 'wrong',
      delta: isCorrect ? station.points : 0,
      at: new Date().toISOString()
    });

    if (!isCorrect) {
      return {
        correct: false,
        message: '答案不正确，请再观察一下现场线索。'
      };
    }

    team.solvedStations.push(stationId);
    team.points = roundScore(team.points + Number(station.points || 0));
    team.clues.push({ stationId, clue: resolvedClue, at: new Date().toISOString() });

    return {
      correct: true,
      alreadySolved: false,
      clue: resolvedClue,
      points: team.points,
      gained: station.points,
      message: station.points > 0 ? `回答正确，+${station.points} 分！` : '谜题验证通过，请前往对应点位完成挑战。'
    };
  });

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

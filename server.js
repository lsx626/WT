const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const { nanoid } = require('nanoid');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const JUDGE_PASSWORD = '777777';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function readDb() {
  const raw = await fs.readFile(DB_PATH, 'utf8');
  return JSON.parse(raw);
}

let writeQueue = Promise.resolve();

function writeDb(nextDb) {
  writeQueue = writeQueue.then(() =>
    fs.writeFile(DB_PATH, `${JSON.stringify(nextDb, null, 2)}\n`, 'utf8')
  );
  return writeQueue;
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
  return parseCookies(req).judge_auth === '1';
}

function requireJudgeAuth(req, res, next) {
  if (!isJudgeAuthed(req)) {
    return res.status(401).json({ message: '裁判端未登录。' });
  }
  return next();
}

app.get('/api/judge/session', (req, res) => {
  res.json({ authed: isJudgeAuthed(req) });
});

app.post('/api/judge/login', (req, res) => {
  const { password } = req.body || {};
  if (String(password || '') !== JUDGE_PASSWORD) {
    return res.status(401).json({ message: '密码错误。' });
  }

  res.setHeader('Set-Cookie', 'judge_auth=1; Path=/; Max-Age=86400; SameSite=Lax; HttpOnly');
  return res.json({ ok: true });
});

app.post('/api/judge/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'judge_auth=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly');
  res.json({ ok: true });
});

app.get('/api/teams', async (_, res) => {
  const db = await readDb();
  res.json(
    db.teams.map((team, index) => ({
      ...team,
      number: Number.isInteger(team.number) ? team.number : index + 1,
      name: team.name || `${Number.isInteger(team.number) ? team.number : index + 1}号组`
    }))
  );
});

app.post('/api/teams', async (req, res) => {
  const db = await readDb();
  const nextNumber = db.teams.length + 1;
  const team = {
    id: nanoid(8),
    number: nextNumber,
    name: `${nextNumber}号组`,
    members: [],
    points: 3,
    solvedStations: [],
    clues: [],
    boughtHints: {},
    createdAt: new Date().toISOString()
  };

  db.teams.push(team);
  await writeDb(db);

  res.status(201).json(team);
});

app.patch('/api/teams/:teamId/points', requireJudgeAuth, async (req, res) => {
  const { teamId } = req.params;
  const { delta, reason = '人工调整' } = req.body || {};
  const parsedDelta = Number(delta);

  if (!isValidHalfStepNumber(parsedDelta)) {
    return res.status(400).json({ message: 'delta 必须是 0.5 的倍数。' });
  }

  const db = await readDb();
  const team = db.teams.find((item) => item.id === teamId);

  if (!team) {
    return res.status(404).json({ message: '队伍不存在。' });
  }

  team.points = Math.max(0, roundScore(team.points + parsedDelta));
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

  await writeDb(db);
  res.json(team);
});

app.post('/api/stations/:stationId/hint', async (req, res) => {
  const { stationId } = req.params;
  const { teamId } = req.body || {};

  const db = await readDb();
  const team = db.teams.find((item) => item.id === teamId);
  if (!team) {
    return res.status(404).json({ message: '队伍不存在。' });
  }

  const station = db.stations.find((item) => item.id === stationId);
  if (!station) {
    return res.status(404).json({ message: '关卡不存在。' });
  }

  const hints = Array.isArray(station.hints) ? station.hints : [];
  if (!hints.length) {
    return res.status(400).json({ message: '该题暂无线索可购买。' });
  }

  if (team.points < 1) {
    return res.status(400).json({ message: '分数不足，无法购买线索。' });
  }

  const boughtCount = Number(team.boughtHints?.[stationId] || 0);
  if (boughtCount >= hints.length) {
    return res.status(400).json({ message: '该题线索已全部购买。' });
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

  await writeDb(db);

  return res.status(200).json({
    hint: purchasedHint,
    points: team.points,
    boughtCount: team.boughtHints[stationId],
    leftCount: hints.length - team.boughtHints[stationId]
  });
});

app.get('/api/stations', async (_, res) => {
  const db = await readDb();
  const stations = db.stations.map(({ answer, hints, ...safe }) => ({
    ...safe,
    hintCount: Array.isArray(hints) ? hints.length : 0
  }));
  res.json(stations);
});

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

app.post('/api/answer', async (req, res) => {
  const { teamId, stationId, answer } = req.body || {};
  const db = await readDb();

  const team = db.teams.find((item) => item.id === teamId);
  if (!team) {
    return res.status(404).json({ message: '队伍不存在。' });
  }

  const station = db.stations.find((item) => item.id === stationId);
  if (!station) {
    return res.status(404).json({ message: '关卡不存在。' });
  }

  if (team.solvedStations.includes(stationId)) {
    return res.status(200).json({
      correct: true,
      alreadySolved: true,
      clue: team.clues.find((item) => item.stationId === stationId)?.clue || station.clue,
      points: team.points,
      message: '该关卡已通过，重复提交不加分。'
    });
  }

  const isCorrect = normalizeAnswer(answer) === normalizeAnswer(station.answer);

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
    await writeDb(db);
    return res.status(200).json({
      correct: false,
      message: '答案不正确，请再观察一下现场线索。'
    });
  }

  team.solvedStations.push(stationId);
  team.points = roundScore(team.points + Number(station.points || 0));
  team.clues.push({ stationId, clue: station.clue, at: new Date().toISOString() });

  await writeDb(db);

  return res.status(200).json({
    correct: true,
    alreadySolved: false,
    clue: station.clue,
    points: team.points,
    gained: station.points,
    message: station.points > 0 ? `回答正确，+${station.points} 分！` : '谜题验证通过，请前往对应点位完成挑战。'
  });
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

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`校园定向网站已启动: http://localhost:${PORT}`);
});

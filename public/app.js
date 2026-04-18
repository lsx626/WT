const elements = {
  teamSetupCard: document.querySelector('#team-setup-card'),
  activeTeamCard: document.querySelector('#active-team-card'),
  activeTeamDisplay: document.querySelector('#active-team-display'),
  setupExistingTeam: document.querySelector('#setup-existing-team'),
  chooseTeamForm: document.querySelector('#choose-team-form'),
  bigRiddlesList: document.querySelector('#big-riddles-list'),
  firstRiddleBox: document.querySelector('#first-riddle-box'),
  routeRiddlesList: document.querySelector('#route-riddles-list'),
  answerResult: document.querySelector('#answer-result'),
  buyHintForm: document.querySelector('#buy-hint-form'),
  hintStation: document.querySelector('#hint-station'),
  hintResult: document.querySelector('#hint-result')
};

const ACTIVE_TEAM_STORAGE_KEY = 'campus-orienteering-active-team-id';
const ACTIVE_TEAM_COOKIE_KEY = 'campus_orienteering_active_team_id';

const state = {
  activeTeamId: getSavedActiveTeamId(),
  teams: [],
  stations: []
};

function getCookie(name) {
  const pairs = document.cookie ? document.cookie.split('; ') : [];
  const entry = pairs.find((item) => item.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

function setCookie(name, value, maxAgeSeconds) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; samesite=lax`;
}

function removeCookie(name) {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

function getSavedActiveTeamId() {
  return localStorage.getItem(ACTIVE_TEAM_STORAGE_KEY) || getCookie(ACTIVE_TEAM_COOKIE_KEY) || '';
}

async function request(url, options) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  });

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const isJson = contentType.includes('application/json');
  const data = isJson ? await response.json().catch(() => ({})) : {};
  if (!response.ok) {
    throw new Error(data.message || '请求失败');
  }

  if (!isJson) {
    throw new Error('接口返回格式异常，请刷新页面后重试。');
  }

  return data;
}

function setResult(message, resultState) {
  elements.answerResult.textContent = message;
  elements.answerResult.classList.remove('ok', 'bad');
  if (resultState) {
    elements.answerResult.classList.add(resultState);
  }
}

function setHintResult(message, resultState) {
  elements.hintResult.textContent = message;
  elements.hintResult.classList.remove('ok', 'bad');
  if (resultState) {
    elements.hintResult.classList.add(resultState);
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getStationCode(stationOrder) {
  if (stationOrder >= 1 && stationOrder <= 4) {
    return String.fromCharCode('A'.charCodeAt(0) + stationOrder - 1);
  }
  if (stationOrder === 5) {
    return 'X';
  }
  return String(stationOrder || '');
}

function getTeamLabel(team, fallbackNumber = 0) {
  if (Number.isInteger(team?.number)) {
    return `${team.number}号组`;
  }

  const derivedNumber = fallbackNumber || 0;
  return `${derivedNumber}号组`;
}

function getActiveTeam() {
  return state.teams.find((team) => team.id === state.activeTeamId) || null;
}

function setActiveTeam(teamId) {
  state.activeTeamId = teamId;
  localStorage.setItem(ACTIVE_TEAM_STORAGE_KEY, teamId);
  setCookie(ACTIVE_TEAM_COOKIE_KEY, teamId, 60 * 60 * 24 * 365);
  renderActiveTeamState();
}

function clearActiveTeam() {
  state.activeTeamId = '';
  localStorage.removeItem(ACTIVE_TEAM_STORAGE_KEY);
  removeCookie(ACTIVE_TEAM_COOKIE_KEY);
  renderActiveTeamState();
}

function fillTeamSelects(teams) {
  const html = teams
    .map((team, index) => `<option value="${team.id}">${getTeamLabel(team, index + 1)}（${team.points} 分）</option>`)
    .join('');

  elements.setupExistingTeam.innerHTML = html || '<option value="">暂无组别，请联系裁判</option>';
}

function renderActiveTeamState() {
  const activeTeam = getActiveTeam();

  if (!activeTeam) {
    elements.teamSetupCard.hidden = false;
    elements.activeTeamCard.hidden = false;
    elements.activeTeamDisplay.textContent = '尚未设置组别';
    elements.bigRiddlesList.textContent = '请先选择组别后开始作答。';
    elements.routeRiddlesList.textContent = '请先选择组别后查看整条路线谜题。';
    return;
  }

  elements.teamSetupCard.hidden = true;
  elements.activeTeamCard.hidden = false;
  elements.activeTeamDisplay.textContent = `${activeTeam.points} 分`;

  const solvedStations = Array.isArray(activeTeam.solvedStations) ? activeTeam.solvedStations : [];
  const solvedRouteQuestions = Array.isArray(activeTeam.solvedRouteQuestions) ? activeTeam.solvedRouteQuestions : [];
  const releasedStationOrder = Number(activeTeam.releasedStationOrder || 1);

  const bigRiddles = state.stations;
  if (!Array.isArray(bigRiddles) || !bigRiddles.length) {
    elements.bigRiddlesList.textContent = '地点谜题暂未配置，请联系裁判。';
  } else {
    elements.bigRiddlesList.innerHTML = bigRiddles
      .map((station) => {
        const solved = solvedStations.includes(station.id);
        const lockedByJudge = Number(station.order || 0) > releasedStationOrder;
        const disabled = solved || lockedByJudge;
        const lockTip = solved ? ' | 已答对并锁定' : lockedByJudge ? ' | 待裁判放行' : '';
        return `
          <article class="route-riddle-item ${solved ? 'riddle-solved' : ''} ${lockedByJudge ? 'riddle-locked' : ''}">
            <p class="route-riddle-question">${escapeHtml(station.title)}</p>
            <p class="route-riddle-question">${escapeHtml(station.question)}</p>
            <p class="route-riddle-meta">分值：${Number(station.points || 0)} 分${lockTip}</p>
            <form class="riddle-answer-form" data-type="station" data-id="${station.id}">
              <input class="riddle-answer-input" name="answer" placeholder="请输入答案" ${disabled ? 'disabled' : ''} required />
              <button type="submit" ${disabled ? 'disabled' : ''}>${solved ? '已锁定' : lockedByJudge ? '待放行' : '提交答案'}</button>
            </form>
          </article>
        `;
      })
      .join('');
  }

  const routeRiddles = Array.isArray(activeTeam.routeRiddles) ? activeTeam.routeRiddles : [];
  const routeUnlocked = solvedStations.includes('s1');
  if (!routeUnlocked) {
    elements.routeRiddlesList.textContent = '先解出A地点，再解这段路上的小谜题。';
    return;
  }

  if (!routeRiddles.length) {
    elements.routeRiddlesList.textContent = '该组路线谜题暂未配置，请联系裁判。';
    return;
  }

  elements.routeRiddlesList.innerHTML = routeRiddles
    .map((riddle) => {
      const solved = solvedRouteQuestions.includes(riddle.id);
      const formatHint = String(riddle.formatHint || '').trim();
      const points = Number(riddle.points || 0);
      const metaText = [formatHint ? `作答格式：${formatHint}` : '', `分值：${points} 分`]
        .filter(Boolean)
        .join(' | ');

      return `
        <article class="route-riddle-item ${solved ? 'riddle-solved' : ''}">
          <p class="route-riddle-question">${escapeHtml(riddle.question)}</p>
          <p class="route-riddle-meta">${escapeHtml(metaText)}${solved ? ' | 已答对并锁定' : ''}</p>
          <form class="riddle-answer-form" data-type="route" data-id="${riddle.id}">
            <input class="riddle-answer-input" name="answer" placeholder="请输入答案" ${solved ? 'disabled' : ''} required />
            <button type="submit" ${solved ? 'disabled' : ''}>${solved ? '已锁定' : '提交答案'}</button>
          </form>
        </article>
      `;
    })
    .join('');
}

function renderStations(stations) {
  elements.hintStation.innerHTML = stations
    .map((station) => `<option value="${station.id}">${station.order}. ${station.title}（可购线索 ${station.hintCount} 条）</option>`)
    .join('');
}

async function refreshAll() {
  const [teams, stations] = await Promise.all([request('/api/teams'), request('/api/stations')]);

  state.teams = teams;
  state.stations = stations;
  if (!state.activeTeamId) {
    state.activeTeamId = getSavedActiveTeamId();
  }

  fillTeamSelects(teams);
  renderStations(stations);

  if (state.activeTeamId && !getActiveTeam()) {
    clearActiveTeam();
  } else {
    renderActiveTeamState();
  }
}

elements.chooseTeamForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const selectedTeamId = elements.setupExistingTeam.value;
  if (!selectedTeamId) {
    alert('请先选择一个组别。');
    return;
  }

  try {
    setActiveTeam(selectedTeamId);
    await refreshAll();
  } catch (error) {
    setResult(error.message, 'bad');
  }
});

function requireActiveTeam() {
  const activeTeam = getActiveTeam();
  if (!activeTeam) {
    throw new Error('请先完成首次组别设置。');
  }
  return activeTeam;
}

async function submitRiddleAnswer(answerType, itemId, answerText) {
  const activeTeam = requireActiveTeam();
  const body = {
    teamId: activeTeam.id,
    answer: answerText
  };

  if (answerType === 'station') {
    body.stationId = itemId;
  } else {
    body.routeQuestionId = itemId;
  }

  const result = await request('/api/answer', {
    method: 'POST',
    body: JSON.stringify(body)
  });

  const status = result.correct ? 'ok' : 'bad';
  const message = result.correct
    ? `${result.message} 当前总分 ${result.points}。${result.clue ? `\n线索：${result.clue}` : ''}`
    : result.message;

  setResult(message, status);
  await refreshAll();
}

elements.bigRiddlesList.addEventListener('submit', async (event) => {
  const form = event.target.closest('.riddle-answer-form');
  if (!form) {
    return;
  }

  event.preventDefault();

  try {
    const answerInput = form.querySelector('input[name="answer"]');
    const answerText = String(answerInput?.value || '').trim();
    if (!answerText) {
      throw new Error('请输入答案后再提交。');
    }

    await submitRiddleAnswer('station', form.dataset.id, answerText);
  } catch (error) {
    setResult(error.message, 'bad');
  }
});

elements.routeRiddlesList.addEventListener('submit', async (event) => {
  const form = event.target.closest('.riddle-answer-form');
  if (!form) {
    return;
  }

  event.preventDefault();

  try {
    const answerInput = form.querySelector('input[name="answer"]');
    const answerText = String(answerInput?.value || '').trim();
    if (!answerText) {
      throw new Error('请输入答案后再提交。');
    }

    await submitRiddleAnswer('route', form.dataset.id, answerText);
  } catch (error) {
    setResult(error.message, 'bad');
  }
});

elements.buyHintForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const activeTeam = requireActiveTeam();
    const result = await request(`/api/stations/${elements.hintStation.value}/hint`, {
      method: 'POST',
      body: JSON.stringify({ teamId: activeTeam.id })
    });

    setHintResult(
      `购买成功。线索：${result.hint}\n当前积分：${result.points}，剩余可购线索：${result.leftCount}`,
      'ok'
    );
    await refreshAll();
  } catch (error) {
    setHintResult(error.message, 'bad');
  }
});

refreshAll()
  .then(() => {
    setInterval(() => {
      refreshAll().catch(() => {});
    }, 5000);
  })
  .catch((error) => {
    setResult(`初始化失败：${error.message}`, 'bad');
  });

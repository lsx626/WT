const elements = {
  teamSetupCard: document.querySelector('#team-setup-card'),
  activeTeamCard: document.querySelector('#active-team-card'),
  activeTeamDisplay: document.querySelector('#active-team-display'),
  setupExistingTeam: document.querySelector('#setup-existing-team'),
  chooseTeamForm: document.querySelector('#choose-team-form'),
  answerForm: document.querySelector('#answer-form'),
  answerTeamName: document.querySelector('#answer-team-name'),
  answerStation: document.querySelector('#answer-station'),
  answerInput: document.querySelector('#answer-input'),
  answerResult: document.querySelector('#answer-result'),
  buyHintForm: document.querySelector('#buy-hint-form'),
  hintTeamName: document.querySelector('#hint-team-name'),
  hintStation: document.querySelector('#hint-station'),
  hintResult: document.querySelector('#hint-result'),
  manualScoreForm: document.querySelector('#manual-score-form'),
  manualTeam: document.querySelector('#manual-team'),
  manualDelta: document.querySelector('#manual-delta'),
  manualReason: document.querySelector('#manual-reason'),
  leaderboard: document.querySelector('#leaderboard'),
  stationsList: document.querySelector('#stations-list')
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

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || '请求失败');
  }
  return data;
}

function setResult(message, state) {
  elements.answerResult.textContent = message;
  elements.answerResult.classList.remove('ok', 'bad');
  if (state) {
    elements.answerResult.classList.add(state);
  }
}

function setHintResult(message, state) {
  elements.hintResult.textContent = message;
  elements.hintResult.classList.remove('ok', 'bad');
  if (state) {
    elements.hintResult.classList.add(state);
  }
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

  elements.setupExistingTeam.innerHTML = html || '<option value="">暂无组别，请联系管理员预置</option>';
  elements.manualTeam.innerHTML = html || '<option value="">暂无小组，请先创建</option>';
}

function renderActiveTeamState() {
  const activeTeam = getActiveTeam();

  if (!activeTeam) {
    elements.teamSetupCard.hidden = false;
    elements.activeTeamCard.hidden = false;
    elements.activeTeamDisplay.textContent = '尚未设置，请先完成首次组别设置。';
    elements.answerTeamName.textContent = '未锁定';
    elements.hintTeamName.textContent = '未锁定';
    return;
  }

  elements.teamSetupCard.hidden = true;
  elements.activeTeamCard.hidden = false;
  const label = getTeamLabel(activeTeam, state.teams.findIndex((team) => team.id === activeTeam.id) + 1);
  elements.activeTeamDisplay.textContent = `${label}（${activeTeam.points} 分）已锁定`;
  elements.answerTeamName.textContent = `${label}（${activeTeam.points} 分）`;
  elements.hintTeamName.textContent = `${label}（${activeTeam.points} 分）`;
}

function renderLeaderboard(items) {
  if (!items.length) {
    elements.leaderboard.innerHTML = '<p>还没有队伍，先创建一支吧。</p>';
    return;
  }

  elements.leaderboard.innerHTML = items
    .map(
      (item) => `
      <div class="rank-item">
        <div class="rank">#${item.rank}</div>
        <div>
          <div class="name">${item.name}</div>
          <div class="meta">完成关卡 ${item.solvedCount} 个</div>
        </div>
        <div class="point">${item.points} 分</div>
      </div>
    `
    )
    .join('');
}

function renderStations(stations) {
  elements.answerStation.innerHTML = stations
    .map((station) => `<option value="${station.id}">${station.order}. ${station.title}（${station.points} 分）</option>`)
    .join('');

  elements.hintStation.innerHTML = stations
    .map((station) => `<option value="${station.id}">${station.order}. ${station.title}（可购线索 ${station.hintCount} 条）</option>`)
    .join('');

  elements.stationsList.innerHTML = stations
    .map(
      (station) => `
      <article class="station-item">
        <h3>${station.order}. ${station.title}</h3>
        <p><strong>问题：</strong>${station.question}</p>
        <p><strong>分值：</strong>${station.points} 分</p>
        <p><strong>可购线索：</strong>${station.hintCount} 条</p>
      </article>
    `
    )
    .join('');
}

async function refreshAll() {
  const [teams, stations, leaderboard] = await Promise.all([
    request('/api/teams'),
    request('/api/stations'),
    request('/api/leaderboard')
  ]);

  state.teams = teams;
  state.stations = stations;
  if (!state.activeTeamId) {
    state.activeTeamId = getSavedActiveTeamId();
  }
  fillTeamSelects(teams);
  renderStations(stations);
  renderLeaderboard(leaderboard);
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

  const selectedTeam = state.teams.find((team) => team.id === selectedTeamId);
  if (!selectedTeam) {
    alert('所选组别不存在，请刷新后重试。');
    return;
  }

  setActiveTeam(selectedTeamId);
  await refreshAll();
});

function requireActiveTeam() {
  const activeTeam = getActiveTeam();
  if (!activeTeam) {
    throw new Error('请先完成首次组别设置。');
  }
  return activeTeam;
}

elements.answerForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const activeTeam = requireActiveTeam();
    const result = await request('/api/answer', {
      method: 'POST',
      body: JSON.stringify({
        teamId: activeTeam.id,
        stationId: elements.answerStation.value,
        answer: elements.answerInput.value
      })
    });

    const status = result.correct ? 'ok' : 'bad';
    const message = result.correct
      ? `${result.message} 当前总分 ${result.points}。${result.clue ? `\n线索：${result.clue}` : ''}`
      : result.message;

    setResult(message, status);
    elements.answerInput.value = '';
    await refreshAll();
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

elements.manualScoreForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    await request(`/api/teams/${elements.manualTeam.value}/points`, {
      method: 'PATCH',
      body: JSON.stringify({
        delta: Number(elements.manualDelta.value),
        reason: elements.manualReason.value || '人工调整'
      })
    });

    elements.manualReason.value = '';
    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
});

refreshAll().catch((error) => {
  setResult(`初始化失败：${error.message}`, 'bad');
});

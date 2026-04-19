const elements = {
  teamSetupCard: document.querySelector('#team-setup-card'),
  activeTeamCard: document.querySelector('#active-team-card'),
  activeTeamDisplay: document.querySelector('#active-team-display'),
  teamSwitchToggle: document.querySelector('#team-switch-toggle'),
  teamSwitchForm: document.querySelector('#team-switch-form'),
  teamSwitchCode: document.querySelector('#team-switch-code'),
  teamSwitchResult: document.querySelector('#team-switch-result'),
  setupExistingTeam: document.querySelector('#setup-existing-team'),
  chooseTeamForm: document.querySelector('#choose-team-form'),
  bigRiddlesList: document.querySelector('#big-riddles-list'),
  firstRiddleBox: document.querySelector('#first-riddle-box'),
  routeRiddlesList: document.querySelector('#route-riddles-list'),
  answerResult: document.querySelector('#answer-result'),
  answerClueImage: document.querySelector('#answer-clue-image')
};

const ACTIVE_TEAM_STORAGE_KEY = 'campus-orienteering-active-team-id';
const ACTIVE_TEAM_COOKIE_KEY = 'campus_orienteering_active_team_id';

const state = {
  activeTeamId: getSavedActiveTeamId(),
  teams: [],
  stations: [],
  nonogramDrafts: {},
  teamSwitchEnabled: true
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

function setResult(message, resultState, clueImageUrl = '') {
  elements.answerResult.textContent = message;
  elements.answerResult.classList.remove('ok', 'bad');
  if (resultState) {
    elements.answerResult.classList.add(resultState);
  }

  if (!elements.answerClueImage) {
    return;
  }

  if (!clueImageUrl) {
    elements.answerClueImage.hidden = true;
    elements.answerClueImage.innerHTML = '';
    return;
  }

  elements.answerClueImage.hidden = false;
  elements.answerClueImage.innerHTML = `<img src="${encodeURI(clueImageUrl)}" alt="终点线索截图" loading="lazy" />`;
}

function setTeamSwitchResult(message, resultState) {
  if (!elements.teamSwitchResult) {
    return;
  }

  elements.teamSwitchResult.hidden = false;
  elements.teamSwitchResult.textContent = message;
  elements.teamSwitchResult.classList.remove('ok', 'bad');
  if (resultState) {
    elements.teamSwitchResult.classList.add(resultState);
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

function createZeroMatrix(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
}

function getNonogramDraftStorageKey(teamId, stationId) {
  return `nonogram_draft_${teamId}_${stationId}`;
}

function normalizeMatrix(matrix, rows, cols) {
  if (!Array.isArray(matrix) || matrix.length !== rows) {
    return createZeroMatrix(rows, cols);
  }

  return matrix.map((row) => {
    if (!Array.isArray(row) || row.length !== cols) {
      return Array.from({ length: cols }, () => 0);
    }
    return row.map((cell) => (Number(cell) ? 1 : 0));
  });
}

function getNonogramDraft(teamId, station) {
  const puzzle = station?.nonogram;
  const rows = Number(puzzle?.rows || 0);
  const cols = Number(puzzle?.cols || 0);
  if (!teamId || !rows || !cols) {
    return createZeroMatrix(rows, cols);
  }

  const cacheKey = `${teamId}:${station.id}`;
  if (state.nonogramDrafts[cacheKey]) {
    return state.nonogramDrafts[cacheKey];
  }

  const storageKey = getNonogramDraftStorageKey(teamId, station.id);
  let draft = createZeroMatrix(rows, cols);

  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      draft = normalizeMatrix(JSON.parse(raw), rows, cols);
    }
  } catch (_) {
    draft = createZeroMatrix(rows, cols);
  }

  state.nonogramDrafts[cacheKey] = draft;
  return draft;
}

function setNonogramDraft(teamId, station, matrix) {
  const cacheKey = `${teamId}:${station.id}`;
  state.nonogramDrafts[cacheKey] = matrix;
  try {
    localStorage.setItem(getNonogramDraftStorageKey(teamId, station.id), JSON.stringify(matrix));
  } catch (_) {
    // Ignore localStorage failures.
  }
}

function renderNonogram(station, teamId, solved) {
  const puzzle = station?.nonogram;
  if (!puzzle) {
    return '';
  }

  const rows = Number(puzzle.rows || 0);
  const cols = Number(puzzle.cols || 0);
  const rowClues = Array.isArray(puzzle.rowClues) ? puzzle.rowClues : [];
  const colClues = Array.isArray(puzzle.colClues) ? puzzle.colClues : [];
  const solution = normalizeMatrix(puzzle.solution, rows, cols);
  const draft = solved ? solution : getNonogramDraft(teamId, station);

  const maxRowClueLen = rowClues.reduce((max, clues) => Math.max(max, Array.isArray(clues) ? clues.length : 0), 0);
  const maxColClueLen = colClues.reduce((max, clues) => Math.max(max, Array.isArray(clues) ? clues.length : 0), 0);

  let html = '<div class="nonogram-wrap"><table class="nonogram-table"><tbody>';

  for (let clueRow = 0; clueRow < maxColClueLen; clueRow += 1) {
    html += '<tr>';
    for (let i = 0; i < maxRowClueLen; i += 1) {
      html += '<td class="nonogram-clue-empty"></td>';
    }
    for (let col = 0; col < cols; col += 1) {
      const clues = Array.isArray(colClues[col]) ? colClues[col] : [];
      const value = clues[clueRow - (maxColClueLen - clues.length)] || '';
      html += `<td class="nonogram-clue-cell">${value ? escapeHtml(value) : ''}</td>`;
    }
    html += '</tr>';
  }

  for (let row = 0; row < rows; row += 1) {
    html += '<tr>';
    const clues = Array.isArray(rowClues[row]) ? rowClues[row] : [];
    for (let i = 0; i < maxRowClueLen; i += 1) {
      const value = clues[i - (maxRowClueLen - clues.length)] || '';
      html += `<td class="nonogram-clue-cell">${value ? escapeHtml(value) : ''}</td>`;
    }

    for (let col = 0; col < cols; col += 1) {
      const filled = Number(draft[row]?.[col] || 0) === 1;
      html += `
        <td class="nonogram-cell-box">
          <button
            type="button"
            class="nonogram-cell ${filled ? 'filled' : ''}"
            data-station-id="${station.id}"
            data-row="${row}"
            data-col="${col}"
            ${solved ? 'disabled' : ''}
            aria-label="数织方格"
          ></button>
        </td>
      `;
    }
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  return html;
}

function getTeamLabel(team, fallbackNumber = 0) {
  if (Number.isInteger(team?.number)) {
    return `第${team.number}组`;
  }

  const derivedNumber = fallbackNumber || 0;
  return `第${derivedNumber}组`;
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
    if (elements.teamSwitchToggle) {
      elements.teamSwitchToggle.hidden = true;
    }
    if (elements.teamSwitchForm) {
      elements.teamSwitchForm.hidden = true;
    }
    if (elements.teamSwitchResult) {
      elements.teamSwitchResult.hidden = true;
      elements.teamSwitchResult.textContent = '';
      elements.teamSwitchResult.classList.remove('ok', 'bad');
    }
    elements.bigRiddlesList.textContent = '请先选择组别后开始作答。';
    elements.routeRiddlesList.textContent = '请先选择组别后查看整条路线谜题。';
    return;
  }

  elements.teamSetupCard.hidden = true;
  elements.activeTeamCard.hidden = false;
  elements.activeTeamDisplay.textContent = `${activeTeam.points} 分`;
  if (elements.teamSwitchToggle) {
    elements.teamSwitchToggle.hidden = !state.teamSwitchEnabled;
  }
  if (!state.teamSwitchEnabled) {
    if (elements.teamSwitchForm) {
      elements.teamSwitchForm.hidden = true;
    }
    if (elements.teamSwitchResult) {
      elements.teamSwitchResult.hidden = true;
      elements.teamSwitchResult.textContent = '';
      elements.teamSwitchResult.classList.remove('ok', 'bad');
    }
  }

  const solvedStations = Array.isArray(activeTeam.solvedStations) ? activeTeam.solvedStations : [];
  const solvedRouteQuestions = Array.isArray(activeTeam.solvedRouteQuestions) ? activeTeam.solvedRouteQuestions : [];
  const releasedStationOrder = Number(activeTeam.releasedStationOrder || 1);
  const stationSequence = Array.isArray(activeTeam.stationSequence) ? activeTeam.stationSequence : [];
  const stationIndexMap = new Map(stationSequence.map((item, index) => [item.id, index]));
  const releasedStationIds = new Set(stationSequence.slice(0, releasedStationOrder).map((item) => item.id));

  const bigRiddles = state.stations;
  if (!Array.isArray(bigRiddles) || !bigRiddles.length) {
    elements.bigRiddlesList.textContent = '地点谜题暂未配置，请联系裁判。';
  } else {
    const visibleBigRiddles = bigRiddles
      .filter((station) => releasedStationIds.has(station.id))
      .sort((a, b) => {
        const indexA = stationIndexMap.has(a.id) ? stationIndexMap.get(a.id) : Number.MAX_SAFE_INTEGER;
        const indexB = stationIndexMap.has(b.id) ? stationIndexMap.get(b.id) : Number.MAX_SAFE_INTEGER;
        return indexA - indexB;
      });

    if (!visibleBigRiddles.length) {
      elements.bigRiddlesList.textContent = '当前暂无已放行地点，请等待裁判放行。';
      return;
    }

    elements.bigRiddlesList.innerHTML = visibleBigRiddles
      .map((station) => {
        const solved = solvedStations.includes(station.id);
        const disabled = solved;
        const purchasedHints = Array.isArray(activeTeam.purchasedHints?.[station.id])
          ? activeTeam.purchasedHints[station.id]
          : [];
        const boughtCount = purchasedHints.length;
        const hintCount = Number(station.hintCount || 0);
        const leftHints = Math.max(0, hintCount - boughtCount);
        const lockTip = solved ? ' | 已答对并锁定' : '';
        const nonogramHtml = renderNonogram(station, activeTeam.id, solved);
        const purchasedHintsHtml = purchasedHints.length
          ? `<div class="purchased-hints">${purchasedHints
            .map((hint, idx) => `<p class="purchased-hint-item">提示 ${idx + 1}：${escapeHtml(hint)}</p>`)
            .join('')}</div>`
          : '';
        return `
          <article class="route-riddle-item ${solved ? 'riddle-solved' : ''}">
            <p class="route-riddle-question">${escapeHtml(station.title)}</p>
            <p class="route-riddle-question">${escapeHtml(station.question)}</p>
            ${nonogramHtml}
            <p class="route-riddle-meta">分值：${Number(station.points || 0)} 分 | 已购提示：${boughtCount}/${hintCount}${lockTip}</p>
            ${purchasedHintsHtml}
            <form class="riddle-answer-form" data-type="station" data-id="${station.id}">
              <input class="riddle-answer-input" name="answer" placeholder="请输入答案" ${disabled ? 'disabled' : ''} required />
              <div class="riddle-actions">
                <button type="submit" ${disabled ? 'disabled' : ''}>${solved ? '已锁定' : '提交答案'}</button>
                <button
                  type="button"
                  class="secondary-btn hint-buy-btn"
                  data-action="buy-hint"
                  data-station-id="${station.id}"
                  ${disabled || leftHints <= 0 ? 'disabled' : ''}
                >提示</button>
              </div>
            </form>
          </article>
        `;
      })
      .join('');
  }

  const routeRiddles = Array.isArray(activeTeam.routeRiddles) ? activeTeam.routeRiddles : [];
  const routeUnlockStationId = activeTeam.routeUnlockStationId || stationSequence[0]?.id || 's1';
  const routeUnlocked = solvedStations.includes(routeUnlockStationId);
  if (!routeUnlocked) {
    elements.routeRiddlesList.textContent = '先解出本组首个地点，再解这段路上的小谜题。';
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

elements.bigRiddlesList.addEventListener('click', (event) => {
  const hintButton = event.target.closest('[data-action="buy-hint"]');
  if (hintButton) {
    const stationId = hintButton.dataset.stationId;
    if (!stationId || hintButton.disabled) {
      return;
    }

    buyStationHint(stationId).catch((error) => {
      setResult(error.message, 'bad');
    });
    return;
  }

  const cell = event.target.closest('.nonogram-cell');
  if (!cell || cell.disabled) {
    return;
  }

  const stationId = cell.dataset.stationId;
  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  const activeTeam = getActiveTeam();
  if (!activeTeam || !stationId || Number.isNaN(row) || Number.isNaN(col)) {
    return;
  }

  const station = state.stations.find((item) => item.id === stationId);
  if (!station?.nonogram) {
    return;
  }

  const draft = getNonogramDraft(activeTeam.id, station);
  const nextValue = Number(draft[row]?.[col] || 0) ? 0 : 1;
  draft[row][col] = nextValue;
  setNonogramDraft(activeTeam.id, station, draft);
  cell.classList.toggle('filled', nextValue === 1);
});

async function refreshAll() {
  const [teams, stations, settings] = await Promise.all([
    request('/api/teams'),
    request('/api/stations'),
    request('/api/settings')
  ]);

  state.teams = teams;
  state.stations = stations;
  state.teamSwitchEnabled = settings?.teamSwitchEnabled !== false;
  if (!state.activeTeamId) {
    state.activeTeamId = getSavedActiveTeamId();
  }

  fillTeamSelects(teams);
  const activeTeam = getActiveTeam();

  if (state.activeTeamId && !activeTeam) {
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

elements.teamSwitchToggle?.addEventListener('click', () => {
  if (!state.teamSwitchEnabled) {
    return;
  }

  if (!elements.teamSwitchForm) {
    return;
  }

  const nextHidden = !elements.teamSwitchForm.hidden;
  elements.teamSwitchForm.hidden = nextHidden;
  if (!nextHidden) {
    elements.teamSwitchCode?.focus();
  }
});

elements.teamSwitchForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    if (!state.teamSwitchEnabled) {
      throw new Error('当前活动阶段已关闭重选功能，请联系裁判。');
    }

    const token = String(elements.teamSwitchCode?.value || '').trim();
    if (!token) {
      throw new Error('请输入裁判提供的重选码。');
    }

    await request('/api/team-switch/unlock', {
      method: 'POST',
      body: JSON.stringify({ token })
    });

    if (elements.teamSwitchCode) {
      elements.teamSwitchCode.value = '';
    }
    clearActiveTeam();
    setTeamSwitchResult('验证通过，请重新选择正确组别。', 'ok');
  } catch (error) {
    setTeamSwitchResult(error.message, 'bad');
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

  setResult(message, status, result.correct ? (result.clueImageUrl || '') : '');
  await refreshAll();
}

async function buyStationHint(stationId) {
  const activeTeam = requireActiveTeam();
  const result = await request(`/api/stations/${stationId}/hint`, {
    method: 'POST',
    body: JSON.stringify({ teamId: activeTeam.id })
  });

  setResult(`购买成功。\n提示：${result.hint}\n当前积分：${result.points}，剩余可购提示：${result.leftCount}`, 'ok');
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

refreshAll()
  .then(() => {
    setInterval(() => {
      refreshAll().catch(() => {});
    }, 5000);
  })
  .catch((error) => {
    setResult(`初始化失败：${error.message}`, 'bad');
  });

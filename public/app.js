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
  teamRouteSummary: document.querySelector('#team-route-summary'),
  answerResult: document.querySelector('#answer-result'),
  answerClueImage: document.querySelector('#answer-clue-image'),
  clueHistoryList: document.querySelector('#clue-history-list'),
  finalAnswerBox: document.querySelector('#final-answer-box'),
  finalAnswerForm: document.querySelector('#final-answer-form'),
  finalAnswerInput: document.querySelector('#final-answer-input'),
  finalAnswerSubmit: document.querySelector('#final-answer-submit'),
  finalHintBtn: document.querySelector('#final-hint-btn')
};

const ACTIVE_TEAM_STORAGE_KEY = 'campus-orienteering-active-team-id';
const ACTIVE_TEAM_COOKIE_KEY = 'campus_orienteering_active_team_id';
const APP_DATA_VERSION_KEY = 'campus-orienteering-app-version';
const APP_DATA_VERSION = '20260425_2';

function clearStaleClientState() {
  try {
    const keysToRemove = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) {
        continue;
      }

      if (key === ACTIVE_TEAM_STORAGE_KEY || key === APP_DATA_VERSION_KEY || key.startsWith('nonogram_draft_')) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => localStorage.removeItem(key));
    localStorage.setItem(APP_DATA_VERSION_KEY, APP_DATA_VERSION);
    document.cookie = `${ACTIVE_TEAM_COOKIE_KEY}=; path=/; max-age=0; samesite=lax`;
  } catch (_) {
    // Ignore storage failures and continue booting.
  }
}

try {
  if (localStorage.getItem(APP_DATA_VERSION_KEY) !== APP_DATA_VERSION) {
    clearStaleClientState();
  }
} catch (_) {
  // Ignore storage failures and continue booting.
}

const state = {
  activeTeamId: getSavedActiveTeamId(),
  teams: [],
  stations: [],
  nonogramDrafts: {},
  nonogramInteractingUntil: 0,
  lastNonogramToggle: null,
  nonogramPointerSession: null,
  answerDrafts: {},
  teamSwitchEnabled: true,
  expandedSolvedItems: new Set(),
  lastRenderSignature: ''
};

function getAnswerDraftKey(teamId, type, itemId) {
  return `${teamId || ''}:${type || ''}:${itemId || ''}`;
}

function getAnswerDraft(teamId, type, itemId) {
  return state.answerDrafts[getAnswerDraftKey(teamId, type, itemId)] || '';
}

function setAnswerDraft(teamId, type, itemId, value) {
  const key = getAnswerDraftKey(teamId, type, itemId);
  if (!key) {
    return;
  }
  state.answerDrafts[key] = String(value || '');
}

function clearAnswerDraft(teamId, type, itemId) {
  delete state.answerDrafts[getAnswerDraftKey(teamId, type, itemId)];
}

function isTypingInAnswerInput() {
  const active = document.activeElement;
  return Boolean(active && active.classList && (
    active.classList.contains('riddle-answer-input') || active.classList.contains('final-answer-input')
  ));
}

function isInteractingWithSelect() {
  const active = document.activeElement;
  return Boolean(active && active.tagName === 'SELECT');
}

function markNonogramInteracting() {
  state.nonogramInteractingUntil = Date.now() + 7000;
}

function isNonogramInteracting() {
  return Date.now() < Number(state.nonogramInteractingUntil || 0);
}

function getSolvedItemKey(kind, id) {
  return `${kind}:${id}`;
}

function isSolvedItemExpanded(kind, id) {
  return state.expandedSolvedItems.has(getSolvedItemKey(kind, id));
}

function toggleSolvedItemExpanded(kind, id) {
  const key = getSolvedItemKey(kind, id);
  if (state.expandedSolvedItems.has(key)) {
    state.expandedSolvedItems.delete(key);
    return;
  }

  state.expandedSolvedItems.add(key);
}

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
  const method = String(options?.method || 'GET').toUpperCase();
  const shouldBypassCache = method === 'GET';
  const requestUrl = shouldBypassCache
    ? `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`
    : url;

  const response = await fetch(requestUrl, {
    headers: {
      'Content-Type': 'application/json'
    },
    cache: 'no-store',
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

function setAnswerInputError(input, show, message = '答案错误') {
  if (!input) {
    return;
  }

  const wrap = input.closest('.answer-input-wrap');
  const hint = wrap ? wrap.querySelector('.answer-error-msg') : null;
  input.classList.toggle('input-error', Boolean(show));

  if (!hint) {
    return;
  }

  hint.textContent = message;
  hint.hidden = !show;
  wrap.classList.toggle('show-error', Boolean(show));
}

function renderClueHistory(activeTeam, stations) {
  if (!elements.clueHistoryList) {
    return;
  }

  if (!activeTeam) {
    elements.clueHistoryList.textContent = '请先选择组别后查看已获得线索。';
    return;
  }

  const clues = Array.isArray(activeTeam?.clues) ? activeTeam.clues : [];
  if (!clues.length) {
    elements.clueHistoryList.textContent = '尚未获得线索。';
    return;
  }

  // Remove exact duplicates first to prevent repeated history noise.
  const dedupedClues = [];
  const clueKeys = new Set();
  for (const item of clues) {
    const key = [
      String(item?.stationId || '').trim(),
      String(item?.routeQuestionId || '').trim(),
      String(item?.clue || '').trim(),
      String(item?.clueImageUrl || '').trim()
    ].join('|');
    if (clueKeys.has(key)) {
      continue;
    }
    clueKeys.add(key);
    dedupedClues.push(item);
  }

  const stationMap = new Map((Array.isArray(stations) ? stations : []).map((item) => [item.id, item]));
  const routeMap = new Map((Array.isArray(activeTeam?.routeRiddles) ? activeTeam.routeRiddles : []).map((item) => [item.id, item]));
  const finalClueGroup = {
    texts: [],
    imageUrl: ''
  };
  const normalClues = [];

  dedupedClues.forEach((item) => {
    const clueText = String(item?.clue || '').trim();
    const clueImageUrl = String(item?.clueImageUrl || '').trim();
    const isFinalImage = clueImageUrl.includes('final-clue.png');
    const isFinalText = /终极线索|终点线索/.test(clueText);
    if (isFinalImage || isFinalText) {
      if (clueText && !finalClueGroup.texts.includes(clueText)) {
        finalClueGroup.texts.push(clueText);
      }
      if (!finalClueGroup.imageUrl && clueImageUrl) {
        finalClueGroup.imageUrl = clueImageUrl;
      }
      return;
    }

    normalClues.push(item);
  });

  const normalHtml = normalClues
    .map((item, index) => {
      const station = item.stationId ? stationMap.get(item.stationId) : null;
      const route = item.routeQuestionId ? routeMap.get(item.routeQuestionId) : null;
      const stationTitle = String(station?.title || '').replace(/（[^）]*->[\s\S]*?）/g, '').trim();
      const title = stationTitle
        || (route ? `路线小谜题 ${route.code || route.id}` : '')
        || item.stationId
        || item.routeQuestionId
        || `线索 ${index + 1}`;
      const clueImageUrl = String(item.clueImageUrl || '').trim();
      return `
        <article class="station-item">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(item.clue || '（无文字线索）')}</p>
          ${clueImageUrl ? `<img class="route-question-image" src="${encodeURI(clueImageUrl)}" alt="线索截图" loading="lazy" />` : ''}
        </article>
      `;
    })
    .join('');

  const finalText = finalClueGroup.texts.join('\n');
  const finalHtml = (finalText || finalClueGroup.imageUrl)
    ? `
      <article class="station-item">
        <h3>终点线索</h3>
        <p>${escapeHtml(finalText || '终点线索已解锁。')}</p>
        ${finalClueGroup.imageUrl ? `<img class="route-question-image" src="${encodeURI(finalClueGroup.imageUrl)}" alt="终点线索截图" loading="lazy" />` : ''}
      </article>
    `
    : '';

  elements.clueHistoryList.innerHTML = `${normalHtml}${finalHtml}`;
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

function syncTeamSwitchVisibility() {
  const shouldShow = Boolean(state.activeTeamId && state.teamSwitchEnabled);

  if (elements.teamSwitchToggle) {
    elements.teamSwitchToggle.hidden = !shouldShow;
  }

  if (elements.teamSwitchForm && !shouldShow) {
    elements.teamSwitchForm.hidden = true;
  }

  if (elements.teamSwitchResult && !shouldShow) {
    elements.teamSwitchResult.hidden = true;
    elements.teamSwitchResult.textContent = '';
    elements.teamSwitchResult.classList.remove('ok', 'bad');
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

function lockNonogramToSolution(teamId, stationId) {
  const station = state.stations.find((item) => item.id === stationId);
  const puzzle = station?.nonogram;
  if (!teamId || !station || !puzzle) {
    return;
  }

  const rows = Number(puzzle.rows || 0);
  const cols = Number(puzzle.cols || 0);
  const solution = normalizeMatrix(puzzle.solution, rows, cols);
  setNonogramDraft(teamId, station, solution);
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

function getTeamMemberCount(team) {
  return Array.isArray(team?.members) ? team.members.length : 0;
}

function isTeamFull(team) {
  return getTeamMemberCount(team) >= 4;
}

function getCleanStationTitle(station, stationCode = '') {
  const rawTitle = String(station?.title || '').trim();
  const titleWithoutRoute = rawTitle.replace(/（[^）]*->[\s\S]*?）/g, '').trim();
  if (stationCode === 'X') {
    return 'Final';
  }
  if (stationCode) {
    return stationCode;
  }
  return titleWithoutRoute || rawTitle || '地点';
}

function isFinalAnswerAvailable(activeTeam) {
  if (!activeTeam) {
    return false;
  }

  const stationSequence = Array.isArray(activeTeam.stationSequence) ? activeTeam.stationSequence : [];
  if (!stationSequence.length) {
    return false;
  }

  const releasedStationOrder = Number(activeTeam.releasedStationOrder || 1);
  return releasedStationOrder >= stationSequence.length;
}

function getStationAnswerPoints(team, station) {
  if (!station || station.id === 's5') {
    return 0;
  }

  const boughtCount = Number(team?.boughtHints?.[station.id] || 0);
  return Math.max(0, 2 - boughtCount);
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
  state.lastRenderSignature = '';
  renderActiveTeamState();
}

function buildRenderSignature(teams, stations, teamSwitchEnabled, activeTeamId) {
  return JSON.stringify({
    activeTeamId: activeTeamId || '',
    teamSwitchEnabled: Boolean(teamSwitchEnabled),
    teams,
    stations
  });
}

function fillTeamSelects(teams) {
  const previousValue = elements.setupExistingTeam.value;
  const html = teams
    .map((team, index) => `<option value="${team.id}">${getTeamLabel(team, index + 1)}</option>`)
    .join('');

  elements.setupExistingTeam.innerHTML = html || '<option value="">暂无组别，请联系裁判</option>';

  if (previousValue && teams.some((team) => team.id === previousValue)) {
    elements.setupExistingTeam.value = previousValue;
    return;
  }

  if (state.activeTeamId && teams.some((team) => team.id === state.activeTeamId)) {
    elements.setupExistingTeam.value = state.activeTeamId;
    return;
  }

  if (!elements.setupExistingTeam.value && teams.length) {
    elements.setupExistingTeam.value = teams[0].id;
  }
}

function renderActiveTeamState() {
  const activeTeam = getActiveTeam();

  if (!activeTeam) {
    elements.teamSetupCard.hidden = false;
    elements.activeTeamCard.hidden = false;
    elements.activeTeamDisplay.textContent = '尚未设置组别';
    if (elements.firstRiddleBox) {
      elements.firstRiddleBox.hidden = false;
    }
    syncTeamSwitchVisibility();
    elements.bigRiddlesList.textContent = '请先选择组别后开始作答。';
    elements.routeRiddlesList.textContent = '请先选择组别后查看整条路线谜题。';
    if (elements.teamRouteSummary) {
      elements.teamRouteSummary.textContent = '你组的线路为······';
    }
    if (elements.finalAnswerInput) {
      elements.finalAnswerInput.value = '';
      elements.finalAnswerInput.disabled = true;
      setAnswerInputError(elements.finalAnswerInput, false);
    }
    if (elements.finalAnswerSubmit) {
      elements.finalAnswerSubmit.disabled = true;
      elements.finalAnswerSubmit.textContent = '验证终点';
    }
    if (elements.finalAnswerBox) {
      elements.finalAnswerBox.hidden = true;
    }
    renderClueHistory(null, state.stations);
    return;
  }

  elements.teamSetupCard.hidden = true;
  elements.activeTeamCard.hidden = false;
  elements.activeTeamDisplay.textContent = `${getTeamLabel(activeTeam)} | ${activeTeam.points} 分`;
  syncTeamSwitchVisibility();

  if (elements.finalAnswerBox) {
    elements.finalAnswerBox.hidden = !isFinalAnswerAvailable(activeTeam);
  }

  renderClueHistory(activeTeam, state.stations);

  if (elements.finalAnswerInput) {
    const finalSolved = activeTeam.finalAnswerVerified === true;
    const finalDraft = getAnswerDraft(activeTeam.id, 'final', 'destination');
    elements.finalAnswerInput.value = finalSolved ? '相辉堂' : finalDraft;
    elements.finalAnswerInput.disabled = finalSolved;
    if (finalSolved) {
      setAnswerInputError(elements.finalAnswerInput, false);
    }
  }
  if (elements.finalAnswerSubmit) {
    const finalSolved = activeTeam.finalAnswerVerified === true;
    elements.finalAnswerSubmit.disabled = finalSolved;
    elements.finalAnswerSubmit.textContent = finalSolved ? '已验证通过' : '验证终点';
  }
  if (elements.finalHintBtn) {
    const finalSolved = activeTeam.finalAnswerVerified === true;
    elements.finalHintBtn.disabled = finalSolved;
  }

  const solvedStations = Array.isArray(activeTeam.solvedStations) ? activeTeam.solvedStations : [];
  const solvedRouteQuestions = Array.isArray(activeTeam.solvedRouteQuestions) ? activeTeam.solvedRouteQuestions : [];
  const releasedStationOrder = Number(activeTeam.releasedStationOrder || 1);
  const stationSequence = Array.isArray(activeTeam.stationSequence) ? activeTeam.stationSequence : [];
  const firstStationId = stationSequence[0]?.id || '';
  const routeRiddlesUnlocked = Boolean(firstStationId && solvedStations.includes(firstStationId));
  const stationIndexMap = new Map(stationSequence.map((item, index) => [item.id, index]));
  const stationCodeMap = new Map(stationSequence.map((item) => [item.id, item.code]));
  const releasedStationIds = new Set(stationSequence.slice(0, releasedStationOrder).map((item) => item.id));

  if (elements.firstRiddleBox) {
    elements.firstRiddleBox.hidden = !routeRiddlesUnlocked;
  }

  if (elements.teamRouteSummary) {
    const routeText = stationSequence.length
      ? stationSequence
        .map((item) => (item.code === 'X' ? 'Final' : String(item.code || '').trim()))
        .join(' -> ')
      : '······';
    elements.teamRouteSummary.textContent = `你组的线路为 ${routeText}`;
  }

  const bigRiddles = state.stations;
  if (!Array.isArray(bigRiddles) || !bigRiddles.length) {
    elements.bigRiddlesList.textContent = '地点谜题暂未配置，请联系裁判。';
  } else {
    const visibleBigRiddles = bigRiddles
      .filter((station) => releasedStationIds.has(station.id) && station.id !== 's5')
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
        const expanded = solved && isSolvedItemExpanded('station', station.id);
        const compactSolved = solved && !expanded;
        const disabled = solved;
        const purchasedHints = Array.isArray(activeTeam.purchasedHints?.[station.id])
          ? activeTeam.purchasedHints[station.id]
          : [];
        const solvedAnswer = String(activeTeam.solvedStationAnswers?.[station.id] || '').trim();
        const inputValue = escapeHtml(solved ? solvedAnswer : getAnswerDraft(activeTeam.id, 'station', station.id));
        const boughtCount = purchasedHints.length;
        const hintCount = Number(station.hintCount || 0);
        const leftHints = Math.max(0, hintCount - boughtCount);
        const answerPoints = getStationAnswerPoints(activeTeam, station);
        const lockTip = solved ? ' | 已答对并锁定' : '';
        const nonogramHtml = renderNonogram(station, activeTeam.id, solved);
        const purchasedHintsHtml = purchasedHints.length
          ? `<div class="purchased-hints">${purchasedHints
            .map((hint, idx) => `<p class="purchased-hint-item">提示 ${idx + 1}：${escapeHtml(hint)}</p>`)
            .join('')}</div>`
          : '';
        return `
          <article class="route-riddle-item ${solved ? 'riddle-solved' : ''} ${compactSolved ? 'compact-solved' : ''}">
            <div class="riddle-item-head">
              <p class="route-riddle-question">${escapeHtml(getCleanStationTitle(station, stationCodeMap.get(station.id) || ''))}</p>
              ${solved ? `<button type="button" class="secondary-btn compact-toggle-btn" data-action="toggle-solved" data-kind="station" data-id="${station.id}" aria-label="${compactSolved ? '展开已完成题目' : '收起已完成题目'}">${compactSolved ? '▾' : '▴'}</button>` : ''}
            </div>
            <div class="solved-details">
              <p class="route-riddle-question">${escapeHtml(station.question)}</p>
              ${nonogramHtml}
              <p class="route-riddle-meta">答对可得：${answerPoints} 分 | 已购提示：${boughtCount}/${hintCount}${lockTip}</p>
              ${purchasedHintsHtml}
              <form class="riddle-answer-form" data-type="station" data-id="${station.id}">
                <div class="answer-input-wrap">
                  <p class="answer-error-msg" hidden>答案错误</p>
                  <input class="riddle-answer-input" name="answer" value="${inputValue}" placeholder="请输入答案" ${disabled ? 'disabled' : ''} required />
                </div>
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
            </div>
          </article>
        `;
      })
      .join('');
  }

  const routeRiddles = Array.isArray(activeTeam.routeRiddles) ? activeTeam.routeRiddles : [];
  if (!routeRiddlesUnlocked) {
    elements.routeRiddlesList.textContent = '请先答对第一道地点谜题。';
    return;
  }

  if (!routeRiddles.length) {
    elements.routeRiddlesList.textContent = '该组起点到首点的小任务暂未配置，请联系裁判。';
    return;
  }

  elements.routeRiddlesList.innerHTML = routeRiddles
    .map((riddle) => {
      const solved = solvedRouteQuestions.includes(riddle.id);
      const expanded = solved && isSolvedItemExpanded('route', riddle.id);
      const compactSolved = solved && !expanded;
      const formatHint = String(riddle.formatHint || '').trim();
      const points = Number(riddle.points || 0);
      const questionImageUrl = String(riddle.questionImageUrl || '').trim();
      const solvedAnswer = String(activeTeam.solvedRouteAnswers?.[riddle.id] || '').trim();
      const inputValue = escapeHtml(solved ? solvedAnswer : getAnswerDraft(activeTeam.id, 'route', riddle.id));
      const metaText = [
        formatHint ? `作答格式：${formatHint}` : '',
        `分值：${points} 分`
      ]
        .filter(Boolean)
        .join(' | ');

      return `
        <article class="route-riddle-item ${solved ? 'riddle-solved' : ''} ${compactSolved ? 'compact-solved' : ''}">
          <div class="riddle-item-head">
            <p class="route-riddle-question">${escapeHtml(riddle.question)}</p>
            ${solved ? `<button type="button" class="secondary-btn compact-toggle-btn" data-action="toggle-solved" data-kind="route" data-id="${riddle.id}" aria-label="${compactSolved ? '展开已完成题目' : '收起已完成题目'}">${compactSolved ? '▾' : '▴'}</button>` : ''}
          </div>
          <div class="solved-details">
            ${questionImageUrl ? `<img class="route-question-image" src="${encodeURI(questionImageUrl)}" alt="路线题配图" loading="lazy" />` : ''}
            <p class="route-riddle-meta">${escapeHtml(metaText)}${solved ? ' | 已答对并锁定' : ''}</p>
            <form class="riddle-answer-form" data-type="route" data-id="${riddle.id}">
              <div class="answer-input-wrap">
                <p class="answer-error-msg" hidden>答案错误</p>
                <input class="riddle-answer-input" name="answer" value="${inputValue}" placeholder="请输入答案" ${solved ? 'disabled' : ''} required />
              </div>
              <button type="submit" ${solved ? 'disabled' : ''}>${solved ? '已锁定' : '提交答案'}</button>
            </form>
          </div>
        </article>
      `;
    })
    .join('');
}

function toggleNonogramCell(cell) {
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

  const dedupeKey = `${activeTeam.id}:${stationId}:${row}:${col}`;
  const now = Date.now();
  if (state.lastNonogramToggle?.key === dedupeKey && (now - Number(state.lastNonogramToggle.time || 0)) < 320) {
    return;
  }
  state.lastNonogramToggle = { key: dedupeKey, time: now };

  const station = state.stations.find((item) => item.id === stationId);
  if (!station?.nonogram) {
    return;
  }

  markNonogramInteracting();

  const draft = getNonogramDraft(activeTeam.id, station);
  const nextValue = Number(draft[row]?.[col] || 0) ? 0 : 1;
  draft[row][col] = nextValue;
  setNonogramDraft(activeTeam.id, station, draft);
  cell.classList.toggle('filled', nextValue === 1);
}

elements.bigRiddlesList.addEventListener('pointerdown', (event) => {
  const cell = event.target.closest('.nonogram-cell');
  if (!cell || cell.disabled) {
    return;
  }

  state.nonogramPointerSession = {
    pointerId: event.pointerId,
    startX: Number(event.clientX || 0),
    startY: Number(event.clientY || 0),
    moved: false,
    cell
  };
});

elements.bigRiddlesList.addEventListener('pointermove', (event) => {
  const session = state.nonogramPointerSession;
  if (!session || session.pointerId !== event.pointerId || session.moved) {
    return;
  }

  const dx = Math.abs(Number(event.clientX || 0) - session.startX);
  const dy = Math.abs(Number(event.clientY || 0) - session.startY);
  if (dx + dy >= 8) {
    session.moved = true;
  }
});

elements.bigRiddlesList.addEventListener('pointerup', (event) => {
  const session = state.nonogramPointerSession;
  if (!session || session.pointerId !== event.pointerId) {
    return;
  }

  const targetCell = event.target.closest('.nonogram-cell');
  const shouldToggle = !session.moved && targetCell && targetCell === session.cell;
  state.nonogramPointerSession = null;
  if (shouldToggle) {
    toggleNonogramCell(targetCell);
  }
});

elements.bigRiddlesList.addEventListener('pointercancel', () => {
  state.nonogramPointerSession = null;
});

elements.bigRiddlesList.addEventListener('click', (event) => {
  const toggleButton = event.target.closest('[data-action="toggle-solved"]');
  if (toggleButton) {
    const kind = toggleButton.dataset.kind;
    const id = toggleButton.dataset.id;
    if (kind && id) {
      toggleSolvedItemExpanded(kind, id);
      renderActiveTeamState();
    }
    return;
  }

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

  toggleNonogramCell(cell);
});

elements.routeRiddlesList.addEventListener('click', (event) => {
  const toggleButton = event.target.closest('[data-action="toggle-solved"]');
  if (!toggleButton) {
    return;
  }

  const kind = toggleButton.dataset.kind;
  const id = toggleButton.dataset.id;
  if (kind && id) {
    toggleSolvedItemExpanded(kind, id);
    renderActiveTeamState();
  }
});

async function refreshAll(options = {}) {
  const skipRenderWhileTyping = options.skipRenderWhileTyping === true;
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

  syncTeamSwitchVisibility();

  if (skipRenderWhileTyping && (isTypingInAnswerInput() || isNonogramInteracting() || isInteractingWithSelect())) {
    return;
  }

  const currentSignature = buildRenderSignature(
    teams,
    stations,
    state.teamSwitchEnabled,
    state.activeTeamId
  );
  if (currentSignature === state.lastRenderSignature) {
    return;
  }

  fillTeamSelects(teams);
  const activeTeam = getActiveTeam();

  if (state.activeTeamId && !activeTeam) {
    clearActiveTeam();
  } else {
    renderActiveTeamState();
  }

  renderClueHistory(getActiveTeam(), stations);
  state.lastRenderSignature = buildRenderSignature(
    state.teams,
    state.stations,
    state.teamSwitchEnabled,
    state.activeTeamId
  );
}

elements.chooseTeamForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const selectedTeamId = elements.setupExistingTeam.value;
  if (!selectedTeamId) {
    alert('请先选择一个组别。');
    return;
  }

  const selectedTeam = state.teams.find((team) => team.id === selectedTeamId);
  if (isTeamFull(selectedTeam)) {
    setResult('该组人数已满', 'bad');
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
  const message = result.message;

  setResult(message, status, '');
  if (result.correct) {
    if (answerType === 'station') {
      lockNonogramToSolution(activeTeam.id, itemId);
    }
    clearAnswerDraft(activeTeam.id, answerType, itemId);
    await refreshAll();
  }
  return result;
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

async function submitFinalAnswer(answerText) {
  const activeTeam = requireActiveTeam();
  const result = await request('/api/final-answer', {
    method: 'POST',
    body: JSON.stringify({
      teamId: activeTeam.id,
      answer: answerText
    })
  });

  setResult(result.message, result.correct ? 'ok' : 'bad');
  if (result.correct) {
    clearAnswerDraft(activeTeam.id, 'final', 'destination');
    await refreshAll();
  }
  return result;
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

    setAnswerInputError(answerInput, false);
    const result = await submitRiddleAnswer('station', form.dataset.id, answerText);
    if (!result.correct) {
      setAnswerInputError(answerInput, true, '答案错误');
    }
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

    setAnswerInputError(answerInput, false);
    const result = await submitRiddleAnswer('route', form.dataset.id, answerText);
    if (!result.correct) {
      setAnswerInputError(answerInput, true, '答案错误');
    }
  } catch (error) {
    setResult(error.message, 'bad');
  }
});

elements.bigRiddlesList.addEventListener('input', (event) => {
  const input = event.target.closest('.riddle-answer-input');
  if (!input) {
    return;
  }

  const form = input.closest('.riddle-answer-form');
  const activeTeam = getActiveTeam();
  if (!form || !activeTeam || !form.dataset.id) {
    return;
  }

  setAnswerInputError(input, false);

  setAnswerDraft(activeTeam.id, 'station', form.dataset.id, input.value);
});

elements.routeRiddlesList.addEventListener('input', (event) => {
  const input = event.target.closest('.riddle-answer-input');
  if (!input) {
    return;
  }

  const form = input.closest('.riddle-answer-form');
  const activeTeam = getActiveTeam();
  if (!form || !activeTeam || !form.dataset.id) {
    return;
  }

  setAnswerInputError(input, false);

  setAnswerDraft(activeTeam.id, 'route', form.dataset.id, input.value);
});

elements.finalAnswerForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const answerText = String(elements.finalAnswerInput?.value || '').trim();
    if (!answerText) {
      throw new Error('请输入终点答案后再提交。');
    }

    setAnswerInputError(elements.finalAnswerInput, false);
    const result = await submitFinalAnswer(answerText);
    if (!result.correct) {
      setAnswerInputError(elements.finalAnswerInput, true, '答案错误');
    }
  } catch (error) {
    setResult(error.message, 'bad');
  }
});

elements.finalAnswerInput?.addEventListener('input', (event) => {
  const activeTeam = getActiveTeam();
  const input = event.target;
  if (!activeTeam || !input) {
    return;
  }

  setAnswerInputError(input, false);
  setAnswerDraft(activeTeam.id, 'final', 'destination', input.value);
});

elements.finalHintBtn?.addEventListener('click', async () => {
  try {
    await buyStationHint('s5');
  } catch (error) {
    setResult(error.message, 'bad');
  }
});

refreshAll()
  .then(() => {
    setInterval(() => {
      refreshAll({ skipRenderWhileTyping: true }).catch(() => {});
    }, 5000);
  })
  .catch((error) => {
    setResult(`初始化失败：${error.message}`, 'bad');
  });

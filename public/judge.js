const elements = {
  judgeLoginCard: document.querySelector('#judge-login-card'),
  judgeLoginForm: document.querySelector('#judge-login-form'),
  judgePassword: document.querySelector('#judge-password'),
  judgeLoginResult: document.querySelector('#judge-login-result'),
  judgeLogoutBtn: document.querySelector('#judge-logout-btn'),
  releaseControlCard: document.querySelector('#release-control-card'),
  releaseNextForm: document.querySelector('#release-next-form'),
  releaseTeam: document.querySelector('#release-team'),
  releasePoints: document.querySelector('#release-points'),
  releaseResult: document.querySelector('#release-result'),
  teamSwitchSettingForm: document.querySelector('#team-switch-setting-form'),
  teamSwitchSettingBtn: document.querySelector('#team-switch-setting-btn'),
  teamSwitchSettingResult: document.querySelector('#team-switch-setting-result'),
  teamSwitchCodeForm: document.querySelector('#team-switch-code-form'),
  teamSwitchCodeResult: document.querySelector('#team-switch-code-result'),
  teamStatusCard: document.querySelector('#team-status-card'),
  teamStatusList: document.querySelector('#team-status-list')
};

const state = {
  teams: [],
  teamSwitchEnabled: true
};

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

function getTeamLabel(team, fallbackNumber = 0) {
  if (Number.isInteger(team?.number)) {
    return `第${team.number}组`;
  }
  return `第${fallbackNumber || 0}组`;
}

function setJudgeLoginResult(message, resultState) {
  elements.judgeLoginResult.textContent = message;
  elements.judgeLoginResult.classList.remove('ok', 'bad');
  if (resultState) {
    elements.judgeLoginResult.classList.add(resultState);
  }
}

function setReleaseResult(message, resultState) {
  elements.releaseResult.textContent = message;
  elements.releaseResult.classList.remove('ok', 'bad');
  if (resultState) {
    elements.releaseResult.classList.add(resultState);
  }
}

function setTeamSwitchCodeResult(message, resultState) {
  elements.teamSwitchCodeResult.textContent = message;
  elements.teamSwitchCodeResult.classList.remove('ok', 'bad');
  if (resultState) {
    elements.teamSwitchCodeResult.classList.add(resultState);
  }
}

function setTeamSwitchSettingResult(message, resultState) {
  elements.teamSwitchSettingResult.textContent = message;
  elements.teamSwitchSettingResult.classList.remove('ok', 'bad');
  if (resultState) {
    elements.teamSwitchSettingResult.classList.add(resultState);
  }
}

function renderTeamSwitchSetting() {
  const enabled = Boolean(state.teamSwitchEnabled);
  elements.teamSwitchSettingBtn.textContent = enabled ? '关闭玩家重选入口' : '开启玩家重选入口';
  elements.teamSwitchCodeForm.querySelector('button').disabled = !enabled;
}

function setJudgeAuthed(authed) {
  elements.judgeLoginCard.hidden = authed;
  elements.releaseControlCard.hidden = !authed;
  elements.teamStatusCard.hidden = !authed;
}

function fillTeamSelect(teams) {
  const html = teams
    .map((team, index) => `<option value="${team.id}">${getTeamLabel(team, index + 1)}（${team.points} 分）</option>`)
    .join('');

  elements.releaseTeam.innerHTML = html || '<option value="">暂无小组</option>';
}

function isStationSolvedByAnswer(team, stationId) {
  const rawAnswer = team?.solvedStationAnswers?.[stationId];
  return String(rawAnswer || '').trim().length > 0;
}

function getReleasedStationProgress(team) {
  const sequence = Array.isArray(team?.stationSequence) ? team.stationSequence : [];
  const releasedOrder = Number(team?.releasedStationOrder || 1);
  const maxCount = Math.max(0, Math.min(sequence.length, releasedOrder));

  return sequence.slice(0, maxCount).map((item) => ({
    id: item.id,
    code: String(item.code || '-').trim() || '-',
    solved: isStationSolvedByAnswer(team, item.id)
  }));
}

function renderTeamStatus(teams) {
  elements.teamStatusList.innerHTML = teams
    .map((team, index) => {
      const releasedProgress = getReleasedStationProgress(team);
      const solvedReleasedCount = releasedProgress.filter((item) => item.solved).length;
      const progressText = releasedProgress.length
        ? releasedProgress
          .map((item) => `${item.code}${item.solved ? ' 已解' : ' 未解'}`)
          .join(' | ')
        : '暂无';

      return `
      <article class="station-item">
        <h3>${getTeamLabel(team, index + 1)} · ${team.points} 分</h3>
        <p><strong>当前放行到：</strong>${team.releasedStationCode || '-'} 点</p>
        <p><strong>已完成地点：</strong>${team.solvedStations?.length || 0} 个</p>
        <p><strong>已放行题目解出：</strong>${solvedReleasedCount}/${releasedProgress.length} 个</p>
        <p><strong>已放行站点状态：</strong>${progressText}</p>
        <p><strong>已购线索：</strong>${Object.values(team.boughtHints || {}).reduce((sum, item) => sum + Number(item || 0), 0)} 条</p>
      </article>
    `;
    })
    .join('');
}

async function refreshJudge() {
  const [teams, settings] = await Promise.all([
    request('/api/teams'),
    request('/api/judge/settings')
  ]);
  state.teams = teams;
  state.teamSwitchEnabled = settings.teamSwitchEnabled !== false;
  fillTeamSelect(teams);
  renderTeamStatus(teams);
  renderTeamSwitchSetting();
}

elements.judgeLoginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    await request('/api/judge/login', {
      method: 'POST',
      body: JSON.stringify({
        password: elements.judgePassword.value.trim()
      })
    });
    elements.judgePassword.value = '';
    setJudgeLoginResult('登录成功。', 'ok');
    setJudgeAuthed(true);
    await refreshJudge();
  } catch (error) {
    setJudgeLoginResult(error.message, 'bad');
  }
});

elements.judgeLogoutBtn.addEventListener('click', async () => {
  try {
    await request('/api/judge/logout', {
      method: 'POST'
    });
  } catch (_) {
    // Ignore logout failures and force UI reset.
  }

  setJudgeAuthed(false);
  setJudgeLoginResult('已退出裁判端。', 'ok');
});

elements.releaseNextForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const teamId = elements.releaseTeam.value;
    const points = Number(elements.releasePoints.value);
    if (![1, 2, 3, 4].includes(points)) {
      throw new Error('仅支持 +1、+2、+3、+4 分。');
    }

    const result = await request(`/api/teams/${teamId}/release-next`, {
      method: 'POST',
      body: JSON.stringify({ activityPoints: points })
    });

    if (result.isMax) {
      setReleaseResult(`该组已是最后一个地点，本次仅记录 +${result.addedPoints || points} 分。`, 'ok');
    } else {
      setReleaseResult(`已记录 +${result.addedPoints || points} 分，并放行到 ${result.releasedStationCode || '-'} 点。`, 'ok');
    }
    await refreshJudge();
  } catch (error) {
    setReleaseResult(error.message, 'bad');
  }
});

elements.teamSwitchCodeForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const result = await request('/api/judge/team-switch-token', {
      method: 'POST'
    });

    const expiresAt = new Date(Number(result.expiresAt || 0));
    const hh = String(expiresAt.getHours()).padStart(2, '0');
    const mm = String(expiresAt.getMinutes()).padStart(2, '0');
    const ss = String(expiresAt.getSeconds()).padStart(2, '0');
    setTeamSwitchCodeResult(`重选码：${result.token}（${hh}:${mm}:${ss} 前有效，仅可使用一次）`, 'ok');
  } catch (error) {
    setTeamSwitchCodeResult(error.message, 'bad');
  }
});

elements.teamSwitchSettingForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const nextValue = !Boolean(state.teamSwitchEnabled);
    const result = await request('/api/judge/settings', {
      method: 'PATCH',
      body: JSON.stringify({ teamSwitchEnabled: nextValue })
    });

    state.teamSwitchEnabled = result.teamSwitchEnabled !== false;
    renderTeamSwitchSetting();
    setTeamSwitchSettingResult(
      state.teamSwitchEnabled ? '已开启玩家重选入口。' : '已关闭玩家重选入口，玩家端将不再显示该选项。',
      'ok'
    );
    if (!state.teamSwitchEnabled) {
      setTeamSwitchCodeResult('重选功能已关闭，当前不生成重选码。', '');
    }
  } catch (error) {
    setTeamSwitchSettingResult(error.message, 'bad');
  }
});

async function bootstrapJudge() {
  try {
    const session = await request('/api/judge/session');
    setJudgeAuthed(Boolean(session.authed));

    if (session.authed) {
      await refreshJudge();
    } else {
      setJudgeLoginResult('请输入密码进入裁判端。', '');
    }
  } catch (error) {
    setJudgeLoginResult(`初始化失败：${error.message}`, 'bad');
  }

  setInterval(async () => {
    try {
      const session = await request('/api/judge/session');
      if (!session.authed) {
        setJudgeAuthed(false);
        return;
      }

      setJudgeAuthed(true);
      await refreshJudge();
    } catch (_) {
      // Ignore periodic sync failures.
    }
  }, 5000);
}

bootstrapJudge();

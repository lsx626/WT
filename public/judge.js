const elements = {
  judgeLoginCard: document.querySelector('#judge-login-card'),
  judgeLoginForm: document.querySelector('#judge-login-form'),
  judgePassword: document.querySelector('#judge-password'),
  judgeLoginResult: document.querySelector('#judge-login-result'),
  judgeLogoutBtn: document.querySelector('#judge-logout-btn'),
  manualScoreForm: document.querySelector('#manual-score-form'),
  manualScoreCard: document.querySelector('#manual-score-card'),
  manualTeam: document.querySelector('#manual-team'),
  manualDelta: document.querySelector('#manual-delta'),
  manualReason: document.querySelector('#manual-reason'),
  judgeResult: document.querySelector('#judge-result'),
  teamStatusCard: document.querySelector('#team-status-card'),
  teamStatusList: document.querySelector('#team-status-list')
};

const state = {
  teams: []
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
    return `${team.number}号组`;
  }
  return `${fallbackNumber || 0}号组`;
}

function setJudgeResult(message, resultState) {
  elements.judgeResult.textContent = message;
  elements.judgeResult.classList.remove('ok', 'bad');
  if (resultState) {
    elements.judgeResult.classList.add(resultState);
  }
}

function setJudgeLoginResult(message, resultState) {
  elements.judgeLoginResult.textContent = message;
  elements.judgeLoginResult.classList.remove('ok', 'bad');
  if (resultState) {
    elements.judgeLoginResult.classList.add(resultState);
  }
}

function setJudgeAuthed(authed) {
  elements.judgeLoginCard.hidden = authed;
  elements.manualScoreCard.hidden = !authed;
  elements.teamStatusCard.hidden = !authed;
}

function fillTeamSelect(teams) {
  const html = teams
    .map((team, index) => `<option value="${team.id}">${getTeamLabel(team, index + 1)}（${team.points} 分）</option>`)
    .join('');

  elements.manualTeam.innerHTML = html || '<option value="">暂无小组</option>';
}

function renderTeamStatus(teams) {
  elements.teamStatusList.innerHTML = teams
    .map(
      (team, index) => `
      <article class="station-item">
        <h3>${getTeamLabel(team, index + 1)} · ${team.points} 分</h3>
        <p><strong>已解锁关卡：</strong>${team.solvedStations?.length || 0} 个</p>
        <p><strong>已购线索：</strong>${Object.values(team.boughtHints || {}).reduce((sum, item) => sum + Number(item || 0), 0)} 条</p>
      </article>
    `
    )
    .join('');
}

async function refreshJudge() {
  const teams = await request('/api/teams');
  state.teams = teams;
  fillTeamSelect(teams);
  renderTeamStatus(teams);
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

elements.manualScoreForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const teamId = elements.manualTeam.value;
    const delta = Number(elements.manualDelta.value);
    const reason = elements.manualReason.value || '人工调整';

    await request(`/api/teams/${teamId}/points`, {
      method: 'PATCH',
      body: JSON.stringify({ delta, reason })
    });

    elements.manualReason.value = '';
    setJudgeResult('调分成功，数据已同步。', 'ok');
    await refreshJudge();
  } catch (error) {
    setJudgeResult(error.message, 'bad');
  }
});

async function bootstrapJudge() {
  try {
    const session = await request('/api/judge/session');
    setJudgeAuthed(Boolean(session.authed));

    if (session.authed) {
      await refreshJudge();
    } else {
      setJudgeLoginResult('请输入六位密码 777777 进入裁判端。', '');
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

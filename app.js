/* =========================================================
   1. Configuração padrão e estado da aplicação
   ========================================================= */
const DEFAULT_HABITS = [
  ['Provérbio', '#5eb0ff'],
  ['Oração', '#2563eb'],
  ['Treino', '#c7ccd1'],
  ['Leitura', '#6b7280']
].map((habit, index) => ({
  id: `h${index}`,
  name: habit[0],
  color: habit[1]
}));

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MONTHS = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez'
];

const PALETTE = [
  '#5eb0ff', '#2563eb', '#c7ccd1', '#6b7280',
  '#39ff14', '#94a3b8', '#38bdf8', '#1e3a8a'
];

let db = null;
let user = null;
let canEdit = false;
let ready = false;

let config = {
  start: '',
  badge: 'Nosso desafio',
  title: 'Desafio de 31 dias',
  days: 31,
  habits: DEFAULT_HABITS,
  members: []
};

let checks = {};
let selectedDay = 1;
let activeTab = 1;
let pendingRemoval = null;
let pendingRemovalTimer = null;

/* =========================================================
   2. Utilitários
   ========================================================= */
const $ = selector => document.querySelector(selector);

const getDayCount = () => config.days;

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  })[character]);
}

function textColorForBackground(color) {
  const red = parseInt(color.slice(1, 3), 16);
  const green = parseInt(color.slice(3, 5), 16);
  const blue = parseInt(color.slice(5, 7), 16);
  const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;

  return luminance > 150 ? '#0a0a0b' : '#fff';
}

function habitIds() {
  return config.habits.map(habit => habit.id);
}

function normalizeChecks(data) {
  const normalized = {};

  for (const key in data) {
    let value = data[key];

    if (
      Array.isArray(value) &&
      value.length === 4 &&
      value.every(item => item === 0 || item === 1)
    ) {
      value = value
        .map((item, index) => item ? `h${index}` : null)
        .filter(Boolean);
    }

    normalized[key] = value;
  }

  return normalized;
}

function showToast(message) {
  let toastElement = $('#toast');

  if (!toastElement) {
    toastElement = document.createElement('div');
    toastElement.id = 'toast';
    toastElement.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:24px',
      'transform:translateX(-50%)',
      'background:var(--ink)',
      'color:#0a0a0b',
      'padding:12px 18px',
      'border-radius:99px',
      'z-index:9',
      'font-weight:700',
      'max-width:90%'
    ].join(';');

    document.body.appendChild(toastElement);
  }

  toastElement.textContent = message;
  toastElement.style.display = 'block';

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toastElement.style.display = 'none';
  }, 4000);
}

function requestRemovalConfirmation(id) {
  pendingRemoval = id;
  clearTimeout(pendingRemovalTimer);

  pendingRemovalTimer = setTimeout(() => {
    pendingRemoval = null;
    render();
  }, 4000);

  render();
}

/* =========================================================
   3. Datas e cálculos
   ========================================================= */
function dateForDay(dayNumber) {
  const [year, month, day] = config.start.split('-').map(Number);
  return new Date(year, month - 1, day + dayNumber - 1);
}

function getCurrentChallengeDay() {
  if (!config.start) return 1;

  const [year, month, day] = config.start.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDate = new Date(year, month - 1, day);

  return Math.round((today - startDate) / 864e5) + 1;
}

function completedHabits(memberId, dayNumber) {
  const completed = (checks[memberId] && checks[memberId][dayNumber]) || [];
  const validIds = habitIds();

  return completed.filter(id => validIds.includes(id));
}

function dayCompletionPercentage(dayNumber) {
  const memberCount = config.members.length;
  const habitCount = config.habits.length;

  if (!memberCount || !habitCount) return 0;

  let completedCount = 0;

  config.members.forEach(member => {
    completedCount += completedHabits(member.id, dayNumber).length;
  });

  return Math.round(
    completedCount / (memberCount * habitCount) * 100
  );
}

/* =========================================================
   4. Persistência
   Mantém a integração com a API do ambiente original.
   ========================================================= */
async function toggleHabit(memberId, dayNumber, habitId) {
  if (!db) return;

  const memberChecks = checks[memberId] || {};
  let completed = [...(memberChecks[dayNumber] || [])];

  completed = completed.includes(habitId)
    ? completed.filter(id => id !== habitId)
    : [...completed, habitId];

  checks[memberId] = {
    ...memberChecks,
    [dayNumber]: completed
  };

  render();

  try {
    await db.doc(`checks/${memberId}`).set({
      d: JSON.stringify(checks[memberId])
    });
  } catch (error) {
    showToast('Não foi possível salvar. Você precisa estar logada e com permissão para editar.');
  }
}

async function saveConfig() {
  if (document.activeElement) {
    document.activeElement.blur();
  }

  render();

  try {
    await db.doc('config/main').set({
      start: config.start,
      badge: config.badge,
      title: config.title,
      days: config.days,
      habits: JSON.stringify(config.habits),
      members: JSON.stringify(config.members)
    });
  } catch (error) {
    showToast('Não foi possível salvar a configuração.');
  }
}

/* =========================================================
   5. Cabeçalho
   ========================================================= */
function renderHeader() {
  $('#badge').textContent = config.badge;
  $('#title').textContent = config.title;

  $('#pills').innerHTML = config.habits.map(habit => (
    `<span class="pill" style="--c:${escapeHtml(habit.color)}">` +
      `${escapeHtml(habit.name)}` +
    '</span>'
  )).join('');

  if (config.start) {
    const startDate = dateForDay(1);
    const endDate = dateForDay(getDayCount());

    $('#range').textContent =
      `De ${startDate.getDate()} de ${MONTHS[startDate.getMonth()]}` +
      ` a ${endDate.getDate()} de ${MONTHS[endDate.getMonth()]}. ` +
      'Um dia de cada vez, juntas.';
  }
}

/* =========================================================
   6. Renderização da visualização diária
   ========================================================= */
function renderDaySelector() {
  let html = '';
  const currentDay = getCurrentChallengeDay();

  html += '<div class="card strip">';
  html += '<button class="arrow" data-s="-1" type="button" aria-label="Dias anteriores">‹</button>';
  html += '<div class="days" id="days">';

  for (let dayNumber = 1; dayNumber <= getDayCount(); dayNumber++) {
    const date = dateForDay(dayNumber);
    const selectedClass = dayNumber === selectedDay ? ' on' : '';
    const todayClass = dayNumber === currentDay ? ' today' : '';

    html +=
      `<button class="day${selectedClass}${todayClass}" data-n="${dayNumber}" type="button">` +
        `<small>${WEEKDAYS[date.getDay()]}</small>` +
        `<b>${date.getDate()}</b>` +
      '</button>';
  }

  html += '</div>';
  html += '<button class="arrow" data-s="1" type="button" aria-label="Próximos dias">›</button>';
  html += '</div>';

  return html;
}

function renderDaySummary() {
  const date = dateForDay(selectedDay);

  return (
    '<div class="card dayhead">' +
      '<div>' +
        `<h2>Dia ${selectedDay} · ${date.getDate()} de ${MONTHS[date.getMonth()]}</h2>` +
        '<p>Marque o que você fez hoje!</p>' +
      '</div>' +
      `<div class="pct">${dayCompletionPercentage(selectedDay)}%<small>DO GRUPO</small></div>` +
    '</div>'
  );
}

function renderMemberCards() {
  const habitCount = config.habits.length;

  return config.members.map(member => {
    const completed = completedHabits(member.id, selectedDay);
    const initial = escapeHtml((member.name[0] || '?').toUpperCase());

    const habitButtons = config.habits.map(habit => {
      const isCompleted = completed.includes(habit.id);

      return (
        `<button class="chip${isCompleted ? ' on' : ''}" ` +
          `style="--c:${escapeHtml(habit.color)};--tc:${textColorForBackground(habit.color)}" ` +
          `data-m="${escapeHtml(member.id)}" data-h="${escapeHtml(habit.id)}" type="button">` +
          `${escapeHtml(habit.name)}` +
        '</button>'
      );
    }).join('');

    return (
      '<div class="card row">' +
        `<div class="av">${initial}</div>` +
        '<div class="who">' +
          `<b>${escapeHtml(member.name)}</b>` +
          `<span>${completed.length}/${habitCount} concluídos</span>` +
        '</div>' +
        `<div class="chips">${habitButtons}</div>` +
      '</div>'
    );
  }).join('');
}

function renderDailyView() {
  return renderDaySelector() + renderDaySummary() + renderMemberCards();
}

/* =========================================================
   7. Renderização da visão geral
   ========================================================= */
function renderOverviewTable() {
  const dayCount = getDayCount();
  const habitCount = config.habits.length;
  let html = '<div class="card scroll"><table><tr><th></th>';

  for (let dayNumber = 1; dayNumber <= dayCount; dayNumber++) {
    html += `<th>${dateForDay(dayNumber).getDate()}</th>`;
  }

  html += '<th>%</th></tr>';

  config.members.forEach(member => {
    let totalCompleted = 0;
    html += `<tr><td>${escapeHtml(member.name)}</td>`;

    for (let dayNumber = 1; dayNumber <= dayCount; dayNumber++) {
      const completedCount = completedHabits(member.id, dayNumber).length;
      totalCompleted += completedCount;

      const cellClass = completedCount === habitCount
        ? 'f'
        : completedCount > 0
          ? 'h'
          : '';

      html += `<td><i class="${cellClass}"></i></td>`;
    }

    const denominator = dayCount * habitCount;
    const percentage = denominator
      ? Math.round(totalCompleted / denominator * 100)
      : 0;

    html += `<td class="p">${percentage}%</td></tr>`;
  });

  html += '</table></div>';
  return html;
}

function renderGroupSummary() {
  let totalDailyPercentages = 0;

  for (let dayNumber = 1; dayNumber <= getDayCount(); dayNumber++) {
    totalDailyPercentages += dayCompletionPercentage(dayNumber);
  }

  const average = getDayCount()
    ? Math.round(totalDailyPercentages / getDayCount())
    : 0;

  return (
    '<div class="card dayhead">' +
      '<div>' +
        '<h2>Grupo</h2>' +
        `<p>Média dos ${getDayCount()} dias</p>` +
      '</div>' +
      `<div class="pct">${average}%<small>CONCLUÍDO</small></div>` +
    '</div>'
  );
}

function renderOverview() {
  return renderOverviewTable() + renderGroupSummary();
}

/* =========================================================
   8. Painel de administração
   ========================================================= */
function renderAdminPanel() {
  if (!canEdit) return '';

  const habits = config.habits.map(habit => {
    const awaitingConfirmation = pendingRemoval === habit.id;

    return (
      '<div class="hrow">' +
        `<input type="color" data-hc="${escapeHtml(habit.id)}" value="${escapeHtml(habit.color)}" aria-label="Cor de ${escapeHtml(habit.name)}">` +
        `<input type="text" data-hn="${escapeHtml(habit.id)}" maxlength="24" value="${escapeHtml(habit.name)}" aria-label="Nome do hábito">` +
        `<button class="x${awaitingConfirmation ? ' ask' : ''}" data-hd="${escapeHtml(habit.id)}" title="Remover" type="button">` +
          `${awaitingConfirmation ? 'Remover?' : '✕'}` +
        '</button>' +
      '</div>'
    );
  }).join('');

  const members = config.members.map(member => {
    const awaitingConfirmation = pendingRemoval === member.id;

    return (
      '<div class="mem">' +
        `<span>${escapeHtml(member.name)}</span>` +
        `<button class="x${awaitingConfirmation ? ' ask' : ''}" data-del="${escapeHtml(member.id)}" title="Remover" type="button">` +
          `${awaitingConfirmation ? 'Remover?' : '✕'}` +
        '</button>' +
      '</div>'
    );
  }).join('');

  return (
    `<div class="card" id="adm"><details${!config.start ? ' open' : ''}>` +
      '<summary>⚙️ Configurar desafio</summary>' +
      '<div class="adm">' +
        `<label>Título grande<input type="text" id="ttl" maxlength="50" value="${escapeHtml(config.title)}"></label>` +
        `<label>Etiqueta do topo<input type="text" id="bdg" maxlength="40" value="${escapeHtml(config.badge)}"></label>` +
        `<label>Data de início (dia 1)<input type="date" id="start" value="${escapeHtml(config.start)}"></label>` +
        `<label>Duração (dias)<input type="number" id="dias" min="1" max="90" value="${config.days}"></label>` +
        '<h3>Checks (nome e cor)</h3>' +
        habits +
        '<div><button class="btn" id="addh" type="button">+ Novo check</button></div>' +
        '<h3>Participantes</h3>' +
        '<div class="add">' +
          '<input type="text" id="nm" placeholder="Nome da participante">' +
          '<button class="btn" id="add" type="button">Adicionar</button>' +
        '</div>' +
        members +
      '</div>' +
    '</details></div>'
  );
}

/* =========================================================
   9. Renderização principal
   ========================================================= */
function render() {
  if (!ready) return;

  const activeElement = document.activeElement;
  if (
    activeElement &&
    activeElement.tagName === 'INPUT' &&
    activeElement.closest('#adm')
  ) {
    return;
  }

  renderHeader();
  const app = $('#app');

  if (!db) {
    app.innerHTML =
      '<div class="card msg">Entre com sua conta do Claude para ver e marcar o desafio.</div>';
    return;
  }

  if (!config.start || !config.members.length || !config.habits.length) {
    const message = canEdit
      ? 'Configure a data de início, os checks e as participantes abaixo para começar.'
      : 'A líder ainda está configurando o desafio. Volte em breve!';

    app.innerHTML =
      `<div class="card msg">${message}</div>` +
      renderAdminPanel();

    bindEvents();
    return;
  }

  const content = activeTab === 1
    ? renderDailyView()
    : renderOverview();

  app.innerHTML = content + renderAdminPanel();
  bindEvents();

  const selectedButton = document.querySelector('.day.on');

  if (selectedButton && activeTab === 1 && !render.hasScrolledToSelection) {
    selectedButton.scrollIntoView({
      inline: 'center',
      block: 'nearest'
    });
    render.hasScrolledToSelection = true;
  }
}

/* =========================================================
   10. Eventos da interface
   ========================================================= */
function bindEvents() {
  document.querySelectorAll('.day').forEach(button => {
    button.onclick = () => {
      selectedDay = Number(button.dataset.n);
      render();
    };
  });

  document.querySelectorAll('.arrow').forEach(button => {
    button.onclick = () => {
      const daysElement = $('#days');

      if (daysElement) {
        daysElement.scrollBy({
          left: Number(button.dataset.s) * 300,
          behavior: 'smooth'
        });
      }
    };
  });

  document.querySelectorAll('.chip').forEach(button => {
    button.onclick = () => {
      toggleHabit(button.dataset.m, selectedDay, button.dataset.h);
    };
  });

  const onChange = (selector, callback) => {
    const element = $(selector);
    if (element) element.onchange = () => callback(element);
  };

  onChange('#ttl', element => {
    config.title = element.value.trim() || 'Desafio';
    saveConfig();
  });

  onChange('#bdg', element => {
    config.badge = element.value.trim() || 'Nosso desafio';
    saveConfig();
  });

  onChange('#start', element => {
    config.start = element.value;
    saveConfig();
  });

  onChange('#dias', element => {
    config.days = Math.min(90, Math.max(1, parseInt(element.value, 10) || 31));

    if (selectedDay > config.days) {
      selectedDay = config.days;
    }

    saveConfig();
  });

  document.querySelectorAll('[data-hc]').forEach(element => {
    element.onchange = () => {
      const habit = config.habits.find(item => item.id === element.dataset.hc);
      if (!habit) return;

      habit.color = element.value;
      saveConfig();
    };
  });

  document.querySelectorAll('[data-hn]').forEach(element => {
    element.onchange = () => {
      const habit = config.habits.find(item => item.id === element.dataset.hn);
      if (!habit) return;

      habit.name = element.value.trim() || 'Check';
      saveConfig();
    };
  });

  document.querySelectorAll('[data-hd]').forEach(button => {
    button.onclick = () => {
      const habitId = button.dataset.hd;

      if (pendingRemoval === habitId) {
        pendingRemoval = null;
        config.habits = config.habits.filter(habit => habit.id !== habitId);
        saveConfig();
      } else {
        requestRemovalConfirmation(habitId);
      }
    };
  });

  const addHabitButton = $('#addh');
  if (addHabitButton) {
    addHabitButton.onclick = () => {
      config.habits.push({
        id: `h${Date.now().toString(36)}`,
        name: 'Novo check',
        color: PALETTE[config.habits.length % PALETTE.length]
      });

      saveConfig();
    };
  }

  const addMemberButton = $('#add');
  if (addMemberButton) {
    addMemberButton.onclick = () => {
      const nameInput = $('#nm');
      const name = nameInput.value.trim();

      if (!name) return;

      config.members.push({
        id: `m${Date.now().toString(36)}`,
        name
      });

      saveConfig();
    };
  }

  document.querySelectorAll('[data-del]').forEach(button => {
    button.onclick = () => {
      const memberId = button.dataset.del;

      if (pendingRemoval === memberId) {
        pendingRemoval = null;
        config.members = config.members.filter(member => member.id !== memberId);
        saveConfig();
      } else {
        requestRemovalConfirmation(memberId);
      }
    };
  });
}

function setActiveTab(tabNumber) {
  activeTab = tabNumber;
  $('#t1').className = tabNumber === 1 ? 'on' : '';
  $('#t2').className = tabNumber === 2 ? 'on' : '';
  render();
}

$('#t1').onclick = () => setActiveTab(1);
$('#t2').onclick = () => setActiveTab(2);

/* =========================================================
   11. Inicialização e sincronização com o banco
   ========================================================= */
async function initializeApp() {
  try {
    user = await claude.use('user');
    canEdit = user ? user.canEdit() : false;
    db = await claude.use('db');
  } catch (error) {
    db = null;
  }

  ready = true;

  if (!db) {
    render();
    return;
  }

  db.doc('config/main').onSnapshot(snapshot => {
    const data = snapshot.exists ? snapshot.data() : null;

    if (data) {
      config.start = data.start || '';
      config.badge = data.badge || 'Nosso desafio';
      config.title = data.title || 'Desafio de 31 dias';
      config.days = data.days || 31;

      try {
        const habits = JSON.parse(data.habits || 'null');
        config.habits = Array.isArray(habits) ? habits : DEFAULT_HABITS;
      } catch (error) {
        config.habits = DEFAULT_HABITS;
      }

      try {
        config.members = JSON.parse(data.members || '[]');
      } catch (error) {
        config.members = [];
      }
    }

    if (!render.hasInitializedSelection && config.start) {
      selectedDay = Math.min(
        getDayCount(),
        Math.max(1, getCurrentChallengeDay())
      );
      render.hasInitializedSelection = true;
    }

    render();
  });

  db.collection('checks').onSnapshot(snapshot => {
    snapshot.docs.forEach(document => {
      try {
        checks[document.id] = normalizeChecks(
          JSON.parse(document.data().d || '{}')
        );
      } catch (error) {
        // Mantém os outros registros mesmo se um documento estiver inválido.
      }
    });

    render();
  });
}

initializeApp();

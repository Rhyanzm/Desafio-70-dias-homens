import { createClient } from
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

/*
 * CONFIGURAÇÃO DO SUPABASE
 *
 * Crie um projeto gratuito em https://supabase.com/
 * Depois copie a Project URL e a chave publicável do projeto.
 */
const SUPABASE_URL = 'COLE_AQUI_A_PROJECT_URL';
const SUPABASE_KEY = 'COLE_AQUI_A_CHAVE_PUBLICAVEL';

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

const $ = selector => document.querySelector(selector);

let db = null;
let ready = false;

let config = {
  start: '',
  badge: 'Nosso desafio',
  title: 'Desafio de 31 dias',
  days: 31,
  habits: DEFAULT_HABITS,
  members: []
};

/*
 * Formato:
 * checks[idDaParticipante][dia] = [idDoHabito, ...]
 */
let checks = {};

let selectedDay = 1;
let activeTab = 1;

let selectedMemberId =
  localStorage.getItem('desafio:selectedMember') || '';

let pendingRemoval = null;
let pendingRemovalTimer = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function habitIds() {
  return config.habits.map(habit => habit.id);
}

function currentMember() {
  return config.members.find(
    member => member.id === selectedMemberId
  ) || null;
}

function textColorForBackground(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    return '#fff';
  }

  const red = parseInt(color.slice(1, 3), 16);
  const green = parseInt(color.slice(3, 5), 16);
  const blue = parseInt(color.slice(5, 7), 16);

  const luminance =
    0.299 * red + 0.587 * green + 0.114 * blue;

  return luminance > 150 ? '#0a0a0b' : '#fff';
}

function showToast(message) {
  let element = $('#toast');

  if (!element) {
    element = document.createElement('div');
    element.id = 'toast';
    element.className = 'toast';
    document.body.appendChild(element);
  }

  element.textContent = message;
  element.classList.add('show');

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    element.classList.remove('show');
  }, 4000);
}

function dateForDay(dayNumber) {
  if (!config.start) {
    return new Date();
  }

  const [year, month, day] = config.start
    .split('-')
    .map(Number);

  return new Date(year, month - 1, day + dayNumber - 1);
}

function getCurrentChallengeDay() {
  if (!config.start) {
    return 1;
  }

  const [year, month, day] = config.start
    .split('-')
    .map(Number);

  const now = new Date();

  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  const startDate = new Date(year, month - 1, day);

  return Math.round((today - startDate) / 86400000) + 1;
}

function completedHabits(memberId, dayNumber) {
  const completed =
    checks[memberId]?.[dayNumber] || [];

  return completed.filter(id => habitIds().includes(id));
}

function dayCompletionPercentage(dayNumber) {
  const total = config.members.length * config.habits.length;

  if (!total) {
    return 0;
  }

  const completed = config.members.reduce(
    (sum, member) =>
      sum + completedHabits(member.id, dayNumber).length,
    0
  );

  return Math.round(completed / total * 100);
}

/* =====================================================
   BANCO DE DADOS
   ===================================================== */

async function saveConfig() {
  render();

  if (!db) {
    showToast('Configure primeiro a conexão com o Supabase.');
    return;
  }

  const { error } = await db
    .from('challenge_config')
    .upsert({
      id: 'main',
      payload: config,
      updated_at: new Date().toISOString()
    });

  if (error) {
    console.error(error);
    showToast('Não foi possível salvar a configuração.');
  }
}

async function saveMemberDay(memberId, dayNumber) {
  if (!db) {
    showToast('Banco de dados não conectado.');
    return;
  }

  const completed =
    checks[memberId]?.[dayNumber] || [];

  const { error } = await db
    .from('challenge_checks')
    .upsert({
      member_id: memberId,
      day_number: dayNumber,
      completed_habits: completed,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'member_id,day_number'
    });

  if (error) {
    console.error(error);
    showToast('Erro ao salvar. Confira sua conexão.');
  }
}

async function toggleHabit(memberId, dayNumber, habitId) {
  if (!selectedMemberId) {
    showToast('Selecione seu nome antes de marcar.');
    return;
  }

  if (memberId !== selectedMemberId) {
    showToast('Você pode marcar somente seus próprios checks.');
    return;
  }

  if (!checks[memberId]) {
    checks[memberId] = {};
  }

  const previous = [
    ...(checks[memberId][dayNumber] || [])
  ];

  checks[memberId][dayNumber] = previous.includes(habitId)
    ? previous.filter(id => id !== habitId)
    : [...previous, habitId];

  render();

  await saveMemberDay(memberId, dayNumber);
}

function applyConfig(data) {
  if (!data || typeof data !== 'object') {
    return;
  }

  config = {
    start: data.start || '',
    badge: data.badge || 'Nosso desafio',
    title: data.title || 'Desafio de 31 dias',
    days: Math.min(
      90,
      Math.max(1, Number(data.days) || 31)
    ),
    habits: Array.isArray(data.habits)
      ? data.habits
      : DEFAULT_HABITS,
    members: Array.isArray(data.members)
      ? data.members
      : []
  };

  if (
    selectedMemberId &&
    !config.members.some(
      member => member.id === selectedMemberId
    )
  ) {
    selectedMemberId = '';
    localStorage.removeItem('desafio:selectedMember');
  }
}

function applyCheckRow(row) {
  if (!row) {
    return;
  }

  if (!checks[row.member_id]) {
    checks[row.member_id] = {};
  }

  checks[row.member_id][row.day_number] =
    Array.isArray(row.completed_habits)
      ? row.completed_habits
      : [];
}

/* =====================================================
   CABEÇALHO
   ===================================================== */

function renderHeader() {
  $('#badge').textContent = config.badge;
  $('#title').textContent = config.title;

  $('#pills').innerHTML = config.habits.map(habit => `
    <span class="pill" style="--c:${escapeHtml(habit.color)}">
      ${escapeHtml(habit.name)}
    </span>
  `).join('');

  if (!config.start) {
    $('#range').textContent =
      'Um dia de cada vez, juntas.';
    return;
  }

  const startDate = dateForDay(1);
  const endDate = dateForDay(config.days);

  $('#range').textContent =
    `De ${startDate.getDate()} de ${MONTHS[startDate.getMonth()]}` +
    ` a ${endDate.getDate()} de ${MONTHS[endDate.getMonth()]}. ` +
    'Um dia de cada vez, juntas.';
}

/* =====================================================
   SELEÇÃO DE PARTICIPANTE
   ===================================================== */

function renderMemberSelector() {
  const options = config.members.map(member => `
    <option value="${escapeHtml(member.id)}"
      ${member.id === selectedMemberId ? 'selected' : ''}>
      ${escapeHtml(member.name)}
    </option>
  `).join('');

  return `
    <section class="card member-select">
      <label for="currentMember">
        Quem está fazendo o checklist?
      </label>

      <div class="select-row">
        <select id="currentMember">
          <option value="">Selecione seu nome…</option>
          ${options}
        </select>

        <span class="selection-note">
          ${currentMember()
            ? `Marcando como ${escapeHtml(currentMember().name)}`
            : 'Escolha seu nome para habilitar as marcações.'}
        </span>
      </div>
    </section>
  `;
}

/* =====================================================
   VISUALIZAÇÃO DIÁRIA
   ===================================================== */

function renderDaySelector() {
  let html = `
    <div class="card strip">
      <button class="arrow" data-s="-1" type="button"
        aria-label="Dias anteriores">‹</button>
      <div class="days" id="days">
  `;

  const currentDay = getCurrentChallengeDay();

  for (let day = 1; day <= config.days; day++) {
    const date = dateForDay(day);

    html += `
      <button class="day${day === selectedDay ? ' on' : ''}${day === currentDay ? ' today' : ''}"
        data-n="${day}" type="button">
        <small>${WEEKDAYS[date.getDay()]}</small>
        <b>${date.getDate()}</b>
      </button>
    `;
  }

  html += `
      </div>
      <button class="arrow" data-s="1" type="button"
        aria-label="Próximos dias">›</button>
    </div>
  `;

  return html;
}

function renderDaySummary() {
  const date = dateForDay(selectedDay);

  return `
    <div class="card dayhead">
      <div>
        <h2>Dia ${selectedDay} · ${date.getDate()} de ${MONTHS[date.getMonth()]}</h2>
        <p>Marque o que você fez hoje!</p>
      </div>
      <div class="pct">
        ${dayCompletionPercentage(selectedDay)}%
        <small>DO GRUPO</small>
      </div>
    </div>
  `;
}

function renderMemberCards() {
  return config.members.map(member => {
    const completed = completedHabits(member.id, selectedDay);
    const isMine = member.id === selectedMemberId;

    const habits = config.habits.map(habit => {
      const isCompleted = completed.includes(habit.id);

      return `
        <button class="chip${isCompleted ? ' on' : ''}"
          style="--c:${escapeHtml(habit.color)};--tc:${textColorForBackground(habit.color)}"
          data-m="${escapeHtml(member.id)}"
          data-h="${escapeHtml(habit.id)}"
          type="button"
          ${isMine ? '' : 'disabled'}>
          ${escapeHtml(habit.name)}
        </button>
      `;
    }).join('');

    return `
      <div class="card row${isMine ? ' mine' : ''}">
        <div class="av">
          ${escapeHtml((member.name[0] || '?').toUpperCase())}
        </div>

        <div class="who">
          <b>
            ${escapeHtml(member.name)}
            ${isMine ? '<span class="you-tag">VOCÊ</span>' : ''}
          </b>
          <span>${completed.length}/${config.habits.length} concluídos</span>
        </div>

        <div class="chips">${habits}</div>
      </div>
    `;
  }).join('');
}

function renderDailyView() {
  return renderMemberSelector()
    + renderDaySelector()
    + renderDaySummary()
    + renderMemberCards();
}

/* =====================================================
   VISÃO GERAL
   ===================================================== */

function renderOverviewTable() {
  let html = `
    <div class="card scroll">
      <table>
        <tr><th>Participante</th>
  `;

  for (let day = 1; day <= config.days; day++) {
    html += `<th>${dateForDay(day).getDate()}</th>`;
  }

  html += '<th>%</th></tr>';

  config.members.forEach(member => {
    let totalCompleted = 0;

    html += `<tr><td>${escapeHtml(member.name)}</td>`;

    for (let day = 1; day <= config.days; day++) {
      const count = completedHabits(member.id, day).length;
      totalCompleted += count;

      const cellClass =
        count === config.habits.length && count > 0
          ? 'f'
          : count > 0
            ? 'h'
            : '';

      html += `<td><i class="${cellClass}"></i></td>`;
    }

    const denominator = config.days * config.habits.length;

    const percentage = denominator
      ? Math.round(totalCompleted / denominator * 100)
      : 0;

    html += `<td class="p">${percentage}%</td></tr>`;
  });

  return html + '</table></div>';
}

function renderGroupSummary() {
  let total = 0;

  for (let day = 1; day <= config.days; day++) {
    total += dayCompletionPercentage(day);
  }

  const average = config.days
    ? Math.round(total / config.days)
    : 0;

  return `
    <div class="card dayhead">
      <div>
        <h2>Grupo</h2>
        <p>Média dos ${config.days} dias</p>
      </div>
      <div class="pct">
        ${average}%
        <small>CONCLUÍDO</small>
      </div>
    </div>
  `;
}

function renderOverview() {
  return renderOverviewTable() + renderGroupSummary();
}

/* =====================================================
   CONFIGURAÇÃO DO DESAFIO
   ===================================================== */

function renderAdminPanel() {
  const habits = config.habits.map(habit => `
    <div class="hrow">
      <input type="color"
        data-hc="${escapeHtml(habit.id)}"
        value="${escapeHtml(habit.color)}"
        aria-label="Cor do hábito">

      <input type="text"
        data-hn="${escapeHtml(habit.id)}"
        maxlength="24"
        value="${escapeHtml(habit.name)}"
        aria-label="Nome do hábito">

      <button class="x${pendingRemoval === habit.id ? ' ask' : ''}"
        data-hd="${escapeHtml(habit.id)}" type="button">
        ${pendingRemoval === habit.id ? 'Remover?' : '✕'}
      </button>
    </div>
  `).join('');

  const members = config.members.map(member => `
    <div class="mem">
      <span>${escapeHtml(member.name)}</span>

      <button class="x${pendingRemoval === member.id ? ' ask' : ''}"
        data-del="${escapeHtml(member.id)}" type="button">
        ${pendingRemoval === member.id ? 'Remover?' : '✕'}
      </button>
    </div>
  `).join('');

  return `
    <div class="card" id="adm">
      <details${!config.start || !config.members.length ? ' open' : ''}>
        <summary>⚙️ Configurar desafio</summary>

        <div class="adm">
          <label>
            Título grande
            <input type="text" id="ttl" maxlength="50"
              value="${escapeHtml(config.title)}">
          </label>

          <label>
            Etiqueta do topo
            <input type="text" id="bdg" maxlength="40"
              value="${escapeHtml(config.badge)}">
          </label>

          <label>
            Data de início (dia 1)
            <input type="date" id="start"
              value="${escapeHtml(config.start)}">
          </label>

          <label>
            Duração (dias)
            <input type="number" id="dias" min="1" max="90"
              value="${config.days}">
          </label>

          <h3>Checks (nome e cor)</h3>
          ${habits}

          <div>
            <button class="btn" id="addh" type="button">
              + Novo check
            </button>
          </div>

          <h3>Participantes</h3>

          <div class="add">
            <input type="text" id="nm" maxlength="50"
              placeholder="Nome da participante">
            <button class="btn" id="add" type="button">
              Adicionar
            </button>
          </div>

          ${members}

          <p class="admin-warning">
            Este site não usa senha. Qualquer pessoa com o link
            pode escolher um nome e alterar os dados do desafio.
          </p>
        </div>
      </details>
    </div>
  `;
}

/* =====================================================
   RENDERIZAÇÃO E EVENTOS
   ===================================================== */

function render() {
  if (!ready) return;

  renderHeader();

  const app = $('#app');

  if (!db) {
    app.innerHTML = `
      <div class="card msg">
        <strong>Banco de dados ainda não configurado.</strong>
        <p>Preencha as credenciais do Supabase no início de js/app.js
        e execute o arquivo supabase-setup.sql.</p>
      </div>
    `;
    return;
  }

  if (!config.start || !config.members.length || !config.habits.length) {
    app.innerHTML = `
      <div class="card msg">
        Configure a data de início, os checks e as participantes abaixo.
      </div>
      ${renderAdminPanel()}
    `;
    bindEvents();
    return;
  }

  app.innerHTML =
    (activeTab === 1 ? renderDailyView() : renderOverview())
    + renderAdminPanel();

  bindEvents();

  const selectedButton = document.querySelector('.day.on');

  if (selectedButton && activeTab === 1 && !render.hasScrolled) {
    selectedButton.scrollIntoView({
      inline: 'center',
      block: 'nearest'
    });

    render.hasScrolled = true;
  }
}

function scheduleRemoval(id) {
  pendingRemoval = id;

  clearTimeout(pendingRemovalTimer);

  pendingRemovalTimer = setTimeout(() => {
    pendingRemoval = null;
    render();
  }, 4000);

  render();
}

function bindEvents() {
  document.querySelectorAll('.day').forEach(button => {
    button.onclick = () => {
      selectedDay = Number(button.dataset.n);
      render();
    };
  });

  document.querySelectorAll('.arrow').forEach(button => {
    button.onclick = () => {
      const days = $('#days');

      if (days) {
        days.scrollBy({
          left: Number(button.dataset.s) * 300,
          behavior: 'smooth'
        });
      }
    };
  });

  document.querySelectorAll('.chip').forEach(button => {
    button.onclick = () => {
      toggleHabit(
        button.dataset.m,
        selectedDay,
        button.dataset.h
      );
    };
  });

  const onChange = (selector, callback) => {
    const element = $(selector);
    if (element) element.onchange = () => callback(element);
  };

  onChange('#currentMember', element => {
    selectedMemberId = element.value;

    localStorage.setItem(
      'desafio:selectedMember',
      selectedMemberId
    );

    render();
  });

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
    config.days = Math.min(
      90,
      Math.max(1, parseInt(element.value, 10) || 31)
    );

    selectedDay = Math.min(selectedDay, config.days);
    saveConfig();
  });

  document.querySelectorAll('[data-hc]').forEach(element => {
    element.onchange = () => {
      const habit = config.habits.find(
        item => item.id === element.dataset.hc
      );

      if (!habit) return;

      habit.color = element.value;
      saveConfig();
    };
  });

  document.querySelectorAll('[data-hn]').forEach(element => {
    element.onchange = () => {
      const habit = config.habits.find(
        item => item.id === element.dataset.hn
      );

      if (!habit) return;

      habit.name = element.value.trim() || 'Check';
      saveConfig();
    };
  });

  document.querySelectorAll('[data-hd]').forEach(button => {
    button.onclick = () => {
      const id = button.dataset.hd;

      if (pendingRemoval !== id) {
        scheduleRemoval(id);
        return;
      }

      pendingRemoval = null;
      config.habits = config.habits.filter(
        habit => habit.id !== id
      );

      saveConfig();
    };
  });

  const addHabit = $('#addh');

  if (addHabit) {
    addHabit.onclick = () => {
      config.habits.push({
        id: `h${Date.now().toString(36)}`,
        name: 'Novo check',
        color: PALETTE[
          config.habits.length % PALETTE.length
        ]
      });

      saveConfig();
    };
  }

  const addMember = $('#add');

  if (addMember) {
    addMember.onclick = () => {
      const input = $('#nm');
      const name = input.value.trim();

      if (!name) {
        showToast('Digite o nome da participante.');
        return;
      }

      const alreadyExists = config.members.some(
        member => member.name.toLocaleLowerCase('pt-BR') ===
          name.toLocaleLowerCase('pt-BR')
      );

      if (alreadyExists) {
        showToast('Já existe uma participante com esse nome.');
        return;
      }

      config.members.push({
        id: `m${Date.now().toString(36)}`,
        name
      });

      saveConfig();
    };
  }

  document.querySelectorAll('[data-del]').forEach(button => {
    button.onclick = async () => {
      const id = button.dataset.del;

      if (pendingRemoval !== id) {
        scheduleRemoval(id);
        return;
      }

      pendingRemoval = null;

      config.members = config.members.filter(
        member => member.id !== id
      );

      delete checks[id];

      if (selectedMemberId === id) {
        selectedMemberId = '';
        localStorage.removeItem('desafio:selectedMember');
      }

      await saveConfig();

      const { error } = await db
        .from('challenge_checks')
        .delete()
        .eq('member_id', id);

      if (error) {
        console.error(error);
        showToast('Participante removida, mas houve erro ao limpar os checks antigos.');
      }
    };
  });
}

function setActiveTab(tab) {
  activeTab = tab;

  $('#t1').className = tab === 1 ? 'on' : '';
  $('#t2').className = tab === 2 ? 'on' : '';

  render();
}

$('#t1').onclick = () => setActiveTab(1);
$('#t2').onclick = () => setActiveTab(2);

/* =====================================================
   INICIALIZAÇÃO E SINCRONIZAÇÃO
   ===================================================== */

async function initializeApp() {
  const credentialsAreConfigured =
    SUPABASE_URL.startsWith('https://') &&
    !SUPABASE_URL.includes('COLE_AQUI') &&
    SUPABASE_KEY.length > 20 &&
    !SUPABASE_KEY.includes('COLE_AQUI');

  if (!credentialsAreConfigured) {
    ready = true;
    render();
    return;
  }

  try {
    db = createClient(SUPABASE_URL, SUPABASE_KEY);

    const configResult = await db
      .from('challenge_config')
      .select('payload')
      .eq('id', 'main')
      .maybeSingle();

    if (configResult.error) throw configResult.error;

    if (configResult.data?.payload) {
      applyConfig(configResult.data.payload);
    } else {
      const { error } = await db
        .from('challenge_config')
        .insert({
          id: 'main',
          payload: config,
          updated_at: new Date().toISOString()
        });

      if (error && error.code !== '23505') throw error;
    }

    const checksResult = await db
      .from('challenge_checks')
      .select('*');

    if (checksResult.error) throw checksResult.error;

    checks = {};

    checksResult.data.forEach(applyCheckRow);

    if (config.start) {
      selectedDay = Math.min(
        config.days,
        Math.max(1, getCurrentChallengeDay())
      );
    }

    ready = true;
    render();

    db.channel('desafio-config')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'challenge_config',
          filter: 'id=eq.main'
        },
        payload => {
          if (payload.new?.payload) {
            applyConfig(payload.new.payload);
            render();
          }
        }
      )
      .subscribe();

    db.channel('desafio-checks')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'challenge_checks'
        },
        payload => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old;

            if (checks[old.member_id]) {
              delete checks[old.member_id][old.day_number];
            }
          } else if (payload.new) {
            applyCheckRow(payload.new);
          }

          render();
        }
      )
      .subscribe();

  } catch (error) {
    console.error(error);
    ready = true;
    render();

    showToast(
      'Erro de conexão. Confira as credenciais e o SQL do Supabase.'
    );
  }
}

initializeApp();
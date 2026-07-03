// ============================================================
//  УПРОЩЁННЫЙ ФРОНТЕНД — ТОЛЬКО РЕГЛАМЕНТ И ГОЛОСОВАНИЕ
// ============================================================

const BACKEND_URL = 'https://duma-backend-production.up.railway.app';
const ADMIN_PASSWORD = 'duma2026';

// ---------- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ----------
let socket = null;
let currentToken = null;
let currentUser = null;
let isAdmin = false;
let hasVoted = false;

// ---------- DOM ЭЛЕМЕНТЫ ----------
const userInfo = document.getElementById('user-info');
const adminPanel = document.getElementById('admin-panel');
const deputyInfo = document.getElementById('deputy-info');
const deputyNameDisplay = document.getElementById('deputy-name-display');
const timerDisplay = document.getElementById('timer-display');
const voteStatus = document.getElementById('vote-status');
const resultsDisplay = document.getElementById('results-display');
const breakStatus = document.getElementById('break-status');
const deputiesList = document.getElementById('deputies-list');
const speakerSelect = document.getElementById('speaker-select');
const customTime = document.getElementById('custom-time');
const deputyNameInput = document.getElementById('deputy-name');

// ============================================================
//  ТОКЕН
// ============================================================

function getToken() {
    return localStorage.getItem('duma_token_' + window.location.host);
}

function saveToken(token) {
    localStorage.setItem('duma_token_' + window.location.host, token);
}

function clearToken() {
    localStorage.removeItem('duma_token_' + window.location.host);
}

function logout() {
    clearToken();
    if (socket) socket.disconnect();
    location.reload();
}

// ============================================================
//  АВТОРИЗАЦИЯ
// ============================================================

function showLoginForm() {
    const savedToken = getToken();
    if (savedToken) {
        attemptLogin(savedToken);
        return;
    }
    
    const input = prompt('Введите пароль председателя или токен депутата:');
    if (!input) return;

    if (input === ADMIN_PASSWORD) {
        isAdmin = true;
        currentToken = 'admin';
        currentUser = { name: 'Председатель', isAdmin: true };
        userInfo.textContent = 'Председатель';
        adminPanel.style.display = 'block';
        deputyInfo.style.display = 'none';
        fetchDeputies();
        initSocket('admin');
        return;
    }
    
    saveToken(input);
    attemptLogin(input);
}

function attemptLogin(token) {
    userInfo.textContent = 'Загрузка...';
    
    fetch(`${BACKEND_URL}/api/session-state`, {
        method: 'GET',
        headers: { 'Authorization': token }
    })
    .then(res => {
        if (!res.ok) {
            if (res.status === 401) {
                clearToken();
                throw new Error('Неверный токен');
            }
            throw new Error('Ошибка сервера');
        }
        return res.json();
    })
    .then(data => {
        if (!data.success) {
            clearToken();
            alert('Неверный токен');
            showLoginForm();
            return;
        }
        
        currentUser = data.user;
        isAdmin = data.user.isAdmin;
        currentToken = token;
        hasVoted = data.voted || false;
        
        userInfo.textContent = isAdmin ? 'Председатель' : `Депутат: ${data.user.name}`;
        deputyNameDisplay.textContent = data.user.name;
        
        if (isAdmin) {
            adminPanel.style.display = 'block';
            deputyInfo.style.display = 'none';
            fetchDeputies();
        } else {
            adminPanel.style.display = 'none';
            deputyInfo.style.display = 'block';
        }
        initSocket(token);
        
        if (data.state) {
            restoreState(data.state);
        }
    })
    .catch(err => {
        alert('Ошибка: ' + err.message);
        clearToken();
        showLoginForm();
    });
}

// ============================================================
//  ВОССТАНОВЛЕНИЕ
// ============================================================

function restoreState(state) {
    timerDisplay.textContent = `⏱️ ${state.time_remaining || 0}`;
    
    if (state.is_break) {
        breakStatus.textContent = '⏸️ ПЕРЕРЫВ';
    } else {
        breakStatus.textContent = '';
    }
    
    if (state.is_voting) {
        voteStatus.textContent = '🗳️ Идёт голосование';
        if (!isAdmin && !hasVoted) {
            showVoteButtons();
        } else if (hasVoted) {
            voteStatus.textContent = '🗳️ Вы уже проголосовали';
        }
    } else {
        voteStatus.textContent = '';
        hideVoteButtons();
    }
}

// ============================================================
//  ДЕПУТАТЫ
// ============================================================

function fetchDeputies() {
    fetch(`${BACKEND_URL}/api/deputies`)
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            renderDeputies(data.deputies);
            populateSpeakerSelect(data.deputies);
        }
    })
    .catch(console.error);
}

function renderDeputies(deputies) {
    if (!deputiesList) return;
    deputiesList.innerHTML = '';
    deputies.forEach(dep => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${dep.name}</span>
            <span style="font-size:0.7rem;color:#8899bb;">${dep.token.substring(0, 12)}...</span>
            <div class="qr-code" id="qr-${dep.id}"></div>
        `;
        deputiesList.appendChild(li);
        const phoneUrl = `${window.location.origin}/phone.html?token=${dep.token}`;
        if (typeof QRCode !== 'undefined') {
            try {
                new QRCode(document.getElementById(`qr-${dep.id}`), {
                    text: phoneUrl,
                    width: 50,
                    height: 50
                });
            } catch(e) {}
        }
    });
}

function populateSpeakerSelect(deputies) {
    if (!speakerSelect) return;
    speakerSelect.innerHTML = '';
    deputies.forEach(dep => {
        const opt = document.createElement('option');
        opt.value = dep.id;
        opt.textContent = dep.name;
        speakerSelect.appendChild(opt);
    });
}

// ============================================================
//  ГОЛОСОВАНИЕ
// ============================================================

function showVoteButtons() {
    let container = document.getElementById('vote-buttons');
    if (!container) {
        container = document.createElement('div');
        container.id = 'vote-buttons';
        container.className = 'vote-buttons';
        if (deputyInfo) deputyInfo.appendChild(container);
    }
    container.innerHTML = '';
    const choices = [
        { label: 'ЗА', value: 'for', color: '#2e7d32' },
        { label: 'ПРОТИВ', value: 'against', color: '#c62828' },
        { label: 'ВОЗДЕРЖАЛСЯ', value: 'abstain', color: '#f9a825' }
    ];
    choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.textContent = choice.label;
        btn.style.cssText = `
            background: ${choice.color};
            color: ${choice.value === 'abstain' ? '#000' : '#fff'};
            padding: 12px 20px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            flex: 1;
            min-width: 80px;
        `;
        btn.onclick = () => sendVote(choice.value);
        container.appendChild(btn);
    });
}

function hideVoteButtons() {
    const container = document.getElementById('vote-buttons');
    if (container) container.innerHTML = '';
}

function sendVote(vote) {
    fetch(`${BACKEND_URL}/api/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: currentToken, vote })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            hasVoted = true;
            hideVoteButtons();
            voteStatus.textContent = '✅ Вы проголосовали!';
        } else {
            alert('❌ ' + data.message);
            showVoteButtons();
        }
    })
    .catch(err => {
        alert('❌ Ошибка отправки голоса');
        showVoteButtons();
    });
}

// ============================================================
//  СОКЕТ
// ============================================================

function initSocket(token) {
    if (socket) { socket.disconnect(); socket = null; }
    
    socket = io(BACKEND_URL, {
        transports: ['websocket', 'polling'],
        query: { token: token }
    });
    
    socket.on('connect', () => {
        console.log('✅ Сокет подключен');
        socket.emit('join', { token: token, peerId: null });
    });
    
    socket.on('connect_error', (error) => {
        console.error('❌ Ошибка сокета:', error);
    });
    
    socket.on('session-state', (data) => {
        if (data.state) restoreState(data.state);
    });
    
    socket.on('timer-update', (data) => {
        timerDisplay.textContent = `⏱️ ${data.time}`;
    });
    
    socket.on('floor-changed', (data) => {
        if (data.speakerId) {
            timerDisplay.textContent = `⏱️ ${data.time || 0}`;
        }
    });
    
    socket.on('voting-started', () => {
        voteStatus.textContent = '🗳️ Идёт голосование!';
        if (!isAdmin && !hasVoted) showVoteButtons();
    });
    
    socket.on('voting-closed', () => {
        voteStatus.textContent = '🔒 Голосование закрыто';
        hideVoteButtons();
    });
    
    socket.on('results', (data) => {
        resultsDisplay.innerHTML = `
            <strong>ЗА</strong> — ${data.for || 0} &nbsp;|&nbsp;
            <strong>ПРОТИВ</strong> — ${data.against || 0} &nbsp;|&nbsp;
            <strong>ВОЗДЕРЖАЛСЯ</strong> — ${data.abstain || 0}
        `;
    });
    
    socket.on('break-started', () => {
        breakStatus.textContent = '⏸️ ПЕРЕРЫВ';
    });
    
    socket.on('break-ended', () => {
        breakStatus.textContent = '';
    });
    
    socket.on('deputies-updated', (deputies) => {
        if (isAdmin) {
            renderDeputies(deputies);
            populateSpeakerSelect(deputies);
        }
    });
    
    socket.on('clear-all', () => {
        deputiesList.innerHTML = '';
        speakerSelect.innerHTML = '';
        resultsDisplay.innerHTML = '';
        timerDisplay.textContent = '⏱️ 0';
        voteStatus.textContent = '';
        breakStatus.textContent = '';
        hideVoteButtons();
        hasVoted = false;
        if (isAdmin) fetchDeputies();
    });
    
    socket.on('error', (msg) => {
        alert('Ошибка: ' + msg);
    });
}

// ============================================================
//  АДМИНИСТРАТИВНЫЕ ДЕЙСТВИЯ
// ============================================================

function adminAction(action, payload = {}) {
    if (!isAdmin) {
        alert('Только председатель может выполнять это действие');
        return;
    }
    if (!socket || !socket.connected) {
        alert('Нет соединения с сервером');
        return;
    }
    socket.emit('admin-action', {
        action,
        payload,
        adminPassword: ADMIN_PASSWORD
    });
}

// ============================================================
//  ЗАПУСК
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    const savedToken = getToken();
    if (savedToken) {
        attemptLogin(savedToken);
    } else {
        showLoginForm();
    }
    
    // ---------- КНОПКИ ----------
    
    document.getElementById('create-deputy-btn')?.addEventListener('click', () => {
        const name = deputyNameInput.value.trim();
        if (!name) return alert('Введите имя');
        fetch(`${BACKEND_URL}/api/create-deputy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, adminPassword: ADMIN_PASSWORD })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                deputyNameInput.value = '';
                fetchDeputies();
            } else {
                alert(data.message);
            }
        })
        .catch(console.error);
    });
    
    document.getElementById('give-floor-btn')?.addEventListener('click', () => {
        const userId = speakerSelect.value;
        if (!userId) return alert('Выберите депутата');
        let seconds = parseInt(customTime.value) || 60;
        adminAction('give-floor', { userId, seconds });
    });
    
    document.getElementById('revoke-floor-btn')?.addEventListener('click', () => {
        adminAction('revoke-floor');
    });
    
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            customTime.value = btn.dataset.seconds;
        });
    });
    
    document.getElementById('start-voting-btn')?.addEventListener('click', () => {
        adminAction('start-voting');
    });
    
    document.getElementById('close-voting-btn')?.addEventListener('click', () => {
        adminAction('close-voting');
    });
    
    document.getElementById('announce-results-btn')?.addEventListener('click', () => {
        adminAction('announce-results');
    });
    
    document.getElementById('break-btn')?.addEventListener('click', () => {
        adminAction('set-break');
    });
    
    document.getElementById('end-break-btn')?.addEventListener('click', () => {
        adminAction('end-break');
    });
    
    document.getElementById('clear-all-btn')?.addEventListener('click', () => {
        if (confirm('Вы уверены?')) {
            adminAction('clear-all');
        }
    });
});

// ============================================================
//  ВЫХОД
// ============================================================

document.getElementById('logout-btn')?.addEventListener('click', logout);

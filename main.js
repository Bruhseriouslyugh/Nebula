// Client-side: sessions via cookies, avatars, DMs, groups, and WebRTC signaling for calls
let me = null;
let socket = null;
let current = { type: null, id: null }; // {type: 'group'|'dm', id: <id>}
const $ = id => document.getElementById(id);

async function api(path, data, method='GET') {
  const opts = { method, headers: {} };
  if (data) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(data); }
  const res = await fetch('/api' + path, opts);
  return res.json();
}

async function init() {
  const meRes = await api('/me');
  if (!meRes.error) {
    me = meRes.user; showDashboard(meRes); connectSocket();
  } else {
    $('auth').classList.remove('hidden');
    $('dashboard').classList.add('hidden');
    $('chat-area').classList.add('hidden');
  }
}

// Register/login
$('btn-register').onclick = async () => {
  const username = $('reg-username').value.trim();
  const password = $('reg-password').value;
  const res = await api('/register', { username, password }, 'POST');
  if (res.user) { me = res.user; showDashboard({ user: me, friends: [] }); connectSocket(); } else { $('reg-msg').innerText = res.error || 'Error'; }
};
$('btn-login').onclick = async () => {
  const username = $('login-username').value.trim();
  const password = $('login-password').value;
  const res = await api('/login', { username, password }, 'POST');
  if (res.user) { me = res.user; showDashboard({ user: me, friends: [] }); connectSocket(); } else { $('login-msg').innerText = res.error || 'Error'; }
};

$('btn-logout').onclick = async () => {
  await api('/logout', null, 'POST');
  location.reload();
};

function showDashboard(data) {
  $('auth').classList.add('hidden');
  $('dashboard').classList.remove('hidden');
  $('chat-area').classList.remove('hidden');
  if (data.user) me = data.user;
  const avatarHtml = me.avatar ? `<img src="${me.avatar}" class="avatar" />` : `<div style="width:32px;height:32px;border-radius:50%;background:#0ea5a4"></div>`;
  $('profile').innerHTML = `${avatarHtml} <div style="margin-left:8px;display:inline-block">${me.username} — Code: ${me.code}</div>`;
  renderFriends(data.friends || []);
  fetchGroups();
  fetchDMs();
}

function renderFriends(friends) {
  const ul = $('friends-list'); ul.innerHTML = '';
  friends.forEach(f => {
    const li = document.createElement('li');
    li.innerHTML = `${f.avatar?'<img src="'+f.avatar+'" class="avatar">':''}<div>${f.username} <small style="color:#94a3b8">(${f.code})</small></div>`;
    li.onclick = () => openDMWith(f.id, f.username);
    // add call button
    const callBtn = document.createElement('button'); callBtn.innerText='Call'; callBtn.style.marginLeft='auto';
    callBtn.onclick = (e) => { e.stopPropagation(); startCallWith(f); };
    li.appendChild(callBtn);
    ul.appendChild(li);
  });
}

$('btn-add-friend').onclick = async () => {
  const code = $('friend-code').value.trim();
  if (!code) return alert('Enter code');
  const res = await api('/add-friend', { friendCode: code }, 'POST');
  if (res.success) { alert('Friend added'); const meRes = await api('/me'); renderFriends(meRes.friends || []); fetchDMs(); } else { alert(res.error || 'Error'); }
};

// avatar upload
$('btn-upload-avatar').onclick = async () => {
  const f = $('avatar-file').files[0];
  if (!f) return alert('Choose an image');
  const fd = new FormData(); fd.append('avatar', f);
  const res = await fetch('/api/upload-avatar', { method:'POST', body: fd });
  const j = await res.json();
  if (j.avatar) { me.avatar = j.avatar; showDashboard({user:me}); alert('Uploaded'); }
  else alert(j.error || 'Upload error');
};

// Groups
async function fetchGroups() {
  const res = await api('/my-groups');
  const ul = $('groups-list'); ul.innerHTML = '';
  if (!res.groups) return;
  res.groups.forEach(g => {
    const li = document.createElement('li');
    li.innerText = g.name + ' (' + g.group_code + ')';
    li.onclick = () => openGroup(g.id, g.name);
    ul.appendChild(li);
  });
}

$('btn-create-group').onclick = async () => {
  const name = $('new-group-name').value.trim();
  const res = await api('/create-group', { name }, 'POST');
  if (res.group) { fetchGroups(); alert('Group created: ' + res.group.group_code); } else { alert(res.error || 'Error'); }
};

$('btn-join-group').onclick = async () => {
  const code = $('join-group-code').value.trim();
  const res = await api('/join-group', { groupCode: code }, 'POST');
  if (res.success) { fetchGroups(); alert('Joined group'); } else { alert(res.error || 'Error'); }
};

// DMs
async function fetchDMs() {
  const res = await api('/my-dms');
  const ul = $('dms-list'); ul.innerHTML = '';
  (res.dms || []).forEach(d => {
    const li = document.createElement('li');
    li.innerHTML = `${d.avatar?'<img src="'+d.avatar+'" class="avatar">':''}<div>${d.username} <small style="color:#94a3b8">(${d.code})</small></div>`;
    li.onclick = () => openDM(d.id, d.username);
    ul.appendChild(li);
  });
}

async function openDMWith(friendId, friendName) {
  const res = await api('/dm', { friendId }, 'POST');
  if (res.dm) openDM(res.dm.id, friendName || res.dm.with);
  else alert(res.error || 'Error creating DM');
}

async function openDM(dmId, title) {
  current = { type: 'dm', id: dmId };
  $('chat-title').innerText = 'DM — ' + title;
  $('messages').innerHTML = '';
  socket.emit('join-dm', dmId, (res) => {});
  const res = await api('/dm-messages/' + dmId);
  (res.messages || []).forEach(appendMessage);
}

async function openGroup(groupId, title) {
  current = { type: 'group', id: groupId };
  $('chat-title').innerText = title;
  $('messages').innerHTML = '';
  socket.emit('join-group', groupId, (res) => { if (res && res.error) alert(res.error); });
  const res = await api('/group-messages/' + groupId);
  (res.messages || []).forEach(appendMessage);
}

function appendMessage(msg) {
  const d = document.createElement('div'); d.className='msg';
  if (msg.username || msg.sender_username) {
    const author = msg.username || msg.sender_username;
    const t = document.createElement('div'); t.className='meta'; t.innerText = author + ' • ' + new Date(msg.created_at).toLocaleString();
    d.appendChild(t);
  }
  const c = document.createElement('div'); c.innerText = msg.content;
  d.appendChild(c);
  $('messages').appendChild(d);
  $('messages').scrollTop = $('messages').scrollHeight;
}

// Socket and WebRTC setup
let localStream = null;
let pc = null;
let callTargetSocket = null;

function connectSocket() {
  socket = io();
  socket.on('connect', () => console.log('connected', socket.id));
  socket.on('group-message', (msg) => { if (current.type === 'group' && String(current.id) === String(msg.groupId)) appendMessage(msg); });
  socket.on('dm-message', (msg) => { if (current.type === 'dm' && String(current.id) === String(msg.dmId)) appendMessage({ sender_username: msg.sender_username, content: msg.content, created_at: msg.created_at }); fetchDMs(); });
  // WebRTC signaling handlers
  socket.on('incoming-call', async (data) => {
    if (!confirm('Incoming call from ' + (data.fromUser.username || data.fromUser.code) + '. Accept?')) return;
    await ensureLocalStream();
    pc = createPeerConnection();
    await pc.setRemoteDescription(data.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer-call', { toSocketId: data.fromSocketId, answer });
    showCallUI(true);
  });
  socket.on('call-accepted', async (data) => {
    if (!pc) return;
    await pc.setRemoteDescription(data.answer);
    showCallUI(true);
  });
  socket.on('ice-candidate', async (data) => {
    if (pc && data && data.candidate) {
      try { await pc.addIceCandidate(data.candidate); } catch(e) { console.warn('addIce error', e); }
    }
  });
}

async function ensureLocalStream() {
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return localStream;
  } catch(e) { alert('Could not get microphone: ' + e.message); throw e; }
}

function createPeerConnection() {
  const pc = new RTCPeerConnection();
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.ontrack = (e) => {
    let aud = document.getElementById('remote-audio');
    if (!aud) { aud = document.createElement('audio'); aud.id = 'remote-audio'; aud.autoplay = true; document.body.appendChild(aud); }
    aud.srcObject = e.streams[0];
  };
  pc.onicecandidate = (evt) => {
    if (evt.candidate) socket.emit('ice-candidate', { toSocketId: callTargetSocket, candidate: evt.candidate });
  };
  return pc;
}

async function startCallWith(friend) {
  const toSocketId = prompt('Enter the target socket.id (for testing, open another client and copy its socket.id from console):');
  if (!toSocketId) return;
  callTargetSocket = toSocketId;
  await ensureLocalStream();
  pc = createPeerConnection();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('call-user', { toSocketId, offer });
  showCallUI(false);
}

function showCallUI(inCall) {
  const el = $('call-ui'); el.innerHTML = '';
  if (inCall) {
    const hang = document.createElement('button'); hang.innerText='Hang up'; hang.onclick = () => { if (pc) pc.close(); pc=null; const aud=document.getElementById('remote-audio'); if(aud) aud.remove(); el.innerHTML=''; };
    el.appendChild(hang);
  } else {
    el.innerText = 'Calling...';
  }
}

// send messages
$('btn-send').onclick = async () => {
  const txt = $('message-input').value.trim();
  if (!txt || !current.id) return;
  if (current.type === 'group') socket.emit('group-message', { groupId: current.id, content: txt }, (res) => { if (res && res.error) alert(res.error); });
  else if (current.type === 'dm') socket.emit('dm-message', { dmId: current.id, content: txt }, (res) => { if (res && res.error) alert(res.error); });
  $('message-input').value = '';
};

init();

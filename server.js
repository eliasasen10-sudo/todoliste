require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MEMBERS = ['Marc', 'Julian', 'Elias', 'Nikola', 'Dietmar'];

// ── Schemas ───────────────────────────────────────
const todoSchema = new mongoose.Schema({
  title:          { type: String, default: '' },
  note:           { type: String, default: '' },
  status:         { type: String, enum: ['Offen', 'In Bearbeitung', 'Erledigt'], default: 'Offen' },
  owner:          { type: String, required: true },
  assignedTo:     { type: String, default: '' },
  visibleToOwner: { type: Boolean, default: false },
  createdAt:      { type: Date, default: Date.now },
  comments: [{
    author:    { type: String, required: true },
    text:      { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }]
});

const tgSchema = new mongoose.Schema({
  member: { type: String, unique: true },
  chatId: String
});

const Todo = mongoose.model('Todo', todoSchema);
const TgUser = mongoose.model('TgUser', tgSchema);

// ── DB Connection ─────────────────────────────────
let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  await mongoose.connect(process.env.MONGODB_URI);
  isConnected = true;
  console.log('MongoDB connected');
}

app.use(async (req, res, next) => {
  try { await connectDB(); next(); }
  catch (err) { res.status(500).json({ error: 'Database connection failed' }); }
});

// ── Telegram ──────────────────────────────────────
async function sendTelegram(chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
  } catch (e) { console.error('Telegram error:', e); }
}

function todoText(todo) {
  let msg = '';
  if (todo.title) msg += `*${todo.title}*`;
  if (todo.title && todo.note) msg += `\n${todo.note}`;
  if (!todo.title && todo.note) msg += `*${todo.note}*`;
  return msg;
}

async function notifyAssigned(todo) {
  if (!todo.assignedTo || todo.assignedTo === '') return;
  if (todo.assignedTo === 'Familie') {
    const users = await TgUser.find({ member: { $ne: todo.owner } });
    for (const u of users) {
      await sendTelegram(u.chatId, `🏠 *${todo.owner}* hat eine neue Familienaufgabe erstellt.`);
    }
  } else {
    const u = await TgUser.findOne({ member: todo.assignedTo });
    if (u) {
      await sendTelegram(u.chatId, `📋 *${todo.owner}* hat dir eine Aufgabe zugewiesen.`);
    }
  }
}

async function notifyDeleted(todo, deletedBy) {
  if (!todo.assignedTo || todo.assignedTo === '' || todo.assignedTo === 'Familie') return;
  if (todo.assignedTo !== deletedBy) {
    const u = await TgUser.findOne({ member: todo.assignedTo });
    if (u) await sendTelegram(u.chatId, `🗑 *${deletedBy}* hat eine dir zugewiesene Aufgabe gelöscht.`);
  } else if (todo.owner !== deletedBy) {
    const u = await TgUser.findOne({ member: todo.owner });
    if (u) await sendTelegram(u.chatId, `🗑 *${deletedBy}* hat deine zugewiesene Aufgabe gelöscht.`);
  }
}

// Telegram webhook
app.post('/api/telegram', async (req, res) => {
  const msg = req.body.message;
  if (!msg) return res.sendStatus(200);
  const text   = (msg.text || '').trim();
  const chatId = String(msg.chat.id);
  if (text.startsWith('/start')) {
    const member = text.split(' ')[1];
    if (MEMBERS.includes(member)) {
      await TgUser.findOneAndUpdate({ member }, { member, chatId }, { upsert: true });
      await sendTelegram(chatId, `✅ Hallo *${member}*\\! Du bekommst jetzt Benachrichtigungen für deine Todos.`);
    } else {
      await sendTelegram(chatId, `Bitte schreib: /start Name\n\nVerfügbare Namen:\n${MEMBERS.join(', ')}`);
    }
  }
  res.sendStatus(200);
});

// Set webhook (call once after deploy)
app.get('/api/set-webhook', async (req, res) => {
  const url = `https://${req.get('host')}/api/telegram`;
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(url)}`);
  const data = await r.json();
  res.json(data);
});

// ── Helper ────────────────────────────────────────
function getUser(req, res) {
  const user = req.headers['x-user'];
  if (!user || !MEMBERS.includes(user)) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return user;
}

// ── Auth ──────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { user, code } = req.body;
  if (!MEMBERS.includes(user)) return res.status(400).json({ ok: false });
  const expected = process.env[`CODE_${user.toUpperCase()}`];
  if (code === expected) return res.json({ ok: true, user });
  res.status(401).json({ ok: false });
});

app.get('/api/members', (req, res) => res.json(MEMBERS));

// ── Todos ─────────────────────────────────────────
app.get('/api/todos', async (req, res) => {
  const user = getUser(req, res);
  if (!user) return;
  const todos = await Todo.find({
    $or: [
      { owner: user, assignedTo: '' },
      { owner: user, assignedTo: { $nin: ['', 'Familie'] }, visibleToOwner: true },
      { assignedTo: user },
      { assignedTo: 'Familie' }
    ]
  }).sort({ createdAt: -1 });
  res.json(todos);
});

app.post('/api/todos', async (req, res) => {
  const user = getUser(req, res);
  if (!user) return;
  const { title, note, assignedTo } = req.body;
  if (!title?.trim() && !note?.trim()) return res.status(400).json({ error: 'Titel oder Notiz erforderlich' });
  const todo = await Todo.create({
    title: (title || '').trim(),
    note:  (note  || '').trim(),
    owner: user,
    assignedTo: assignedTo || '',
    visibleToOwner: req.body.visibleToOwner === true
  });
  await notifyAssigned(todo);
  res.status(201).json(todo);
});

app.patch('/api/todos/:id', async (req, res) => {
  const user = getUser(req, res);
  if (!user) return;
  const { status, assignedTo } = req.body;
  const update = {};
  if (status !== undefined) {
    const valid = ['Offen', 'In Bearbeitung', 'Erledigt'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    update.status = status;
  }
  if (assignedTo !== undefined) update.assignedTo = assignedTo;
  if (req.body.visibleToOwner !== undefined) update.visibleToOwner = req.body.visibleToOwner;
  const todo = await Todo.findOneAndUpdate(
    { _id: req.params.id, $or: [{ owner: user }, { assignedTo: user }, { assignedTo: 'Familie' }] },
    update, { new: true }
  );
  if (!todo) return res.status(404).json({ error: 'Not found' });
  res.json(todo);
});

app.delete('/api/todos/:id', async (req, res) => {
  const user = getUser(req, res);
  if (!user) return;
  const todo = await Todo.findOneAndDelete({
    _id: req.params.id,
    $or: [{ owner: user }, { assignedTo: user }, { assignedTo: 'Familie' }]
  });
  if (!todo) return res.status(404).json({ error: 'Not found' });
  await notifyDeleted(todo, user);
  res.status(204).send();
});

app.post('/api/todos/:id/comment', async (req, res) => {
  const user = getUser(req, res);
  if (!user) return;
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' });
  if (text.trim().split(/\s+/).length > 10) return res.status(400).json({ error: 'Max 10 Wörter' });
  const todo = await Todo.findOneAndUpdate(
    { _id: req.params.id, assignedTo: 'Familie' },
    { $push: { comments: { author: user, text: text.trim() } } },
    { new: true }
  );
  if (!todo) return res.status(404).json({ error: 'Not found' });
  res.json(todo);
});

// ── Start ─────────────────────────────────────────
if (process.env.VERCEL !== '1') {
  connectDB().then(() => {
    app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
  });
}

module.exports = app;

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

// ── Schema ────────────────────────────────────────
const todoSchema = new mongoose.Schema({
  title:      { type: String, required: true },
  note:       { type: String, default: '' },
  status:     { type: String, enum: ['Offen', 'In Bearbeitung', 'Erledigt'], default: 'Offen' },
  owner:      { type: String, required: true },
  // assignedTo: person name | 'Familie' | '' (= personal)
  assignedTo: { type: String, default: '' },
  createdAt:  { type: Date, default: Date.now }
});

const Todo = mongoose.model('Todo', todoSchema);

// ── Auth ──────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { user, code } = req.body;
  if (!MEMBERS.includes(user)) return res.status(400).json({ ok: false });
  const expected = process.env[`CODE_${user.toUpperCase()}`];
  if (code === expected) return res.json({ ok: true, user });
  res.status(401).json({ ok: false });
});

app.get('/api/members', (req, res) => res.json(MEMBERS));

// ── Helper ────────────────────────────────────────
function getUser(req, res) {
  const user = req.headers['x-user'];
  if (!user || !MEMBERS.includes(user)) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return user;
}

// ── Todos ─────────────────────────────────────────
// GET: own todos + assigned to me + Familie todos
app.get('/api/todos', async (req, res) => {
  const user = getUser(req, res);
  if (!user) return;
  const todos = await Todo.find({
    $or: [
      { owner: user },
      { assignedTo: user },
      { assignedTo: 'Familie' }
    ]
  }).sort({ createdAt: -1 });
  res.json(todos);
});

// POST: create todo
app.post('/api/todos', async (req, res) => {
  const user = getUser(req, res);
  if (!user) return;
  const { title, note, assignedTo } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const todo = await Todo.create({
    title: title.trim(),
    note: (note || '').trim(),
    owner: user,
    assignedTo: assignedTo || ''
  });
  res.status(201).json(todo);
});

// PATCH: update status or assignedTo
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
  const todo = await Todo.findOneAndUpdate(
    { _id: req.params.id, $or: [{ owner: user }, { assignedTo: user }, { assignedTo: 'Familie' }] },
    update,
    { new: true }
  );
  if (!todo) return res.status(404).json({ error: 'Not found' });
  res.json(todo);
});

// DELETE
app.delete('/api/todos/:id', async (req, res) => {
  const user = getUser(req, res);
  if (!user) return;
  const todo = await Todo.findOneAndDelete({
    _id: req.params.id,
    $or: [{ owner: user }, { assignedTo: user }, { assignedTo: 'Familie' }]
  });
  if (!todo) return res.status(404).json({ error: 'Not found' });
  res.status(204).send();
});

// ── Start ─────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}

module.exports = app;

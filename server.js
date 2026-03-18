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

// ── Schema ────────────────────────────────────────
const todoSchema = new mongoose.Schema({
  title:     { type: String, required: true },
  note:      { type: String, default: '' },
  status:    { type: String, enum: ['Offen', 'In Bearbeitung', 'Erledigt'], default: 'Offen' },
  createdAt: { type: Date, default: Date.now }
});

const Todo = mongoose.model('Todo', todoSchema);

// ── Routes ────────────────────────────────────────
app.get('/api/todos', async (req, res) => {
  const todos = await Todo.find().sort({ createdAt: -1 });
  res.json(todos);
});

app.post('/api/todos', async (req, res) => {
  const { title, note } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  const todo = await Todo.create({ title: title.trim(), note: (note || '').trim() });
  res.status(201).json(todo);
});

app.patch('/api/todos/:id', async (req, res) => {
  const { status } = req.body;
  const valid = ['Offen', 'In Bearbeitung', 'Erledigt'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const todo = await Todo.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!todo) return res.status(404).json({ error: 'Not found' });
  res.json(todo);
});

app.delete('/api/todos/:id', async (req, res) => {
  const todo = await Todo.findByIdAndDelete(req.params.id);
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

const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const TODOS_FILE = path.join(__dirname, 'todos.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readTodos() {
  try {
    const data = fs.readFileSync(TODOS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeTodos(todos) {
  fs.writeFileSync(TODOS_FILE, JSON.stringify(todos, null, 2), 'utf8');
}

// GET all todos
app.get('/api/todos', (req, res) => {
  res.json(readTodos());
});

// POST new todo
app.post('/api/todos', (req, res) => {
  const { title, note } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  const todos = readTodos();
  const todo = {
    id: Date.now().toString(),
    title: title.trim(),
    note: (note || '').trim(),
    status: 'Offen',
    createdAt: new Date().toISOString()
  };
  todos.unshift(todo);
  writeTodos(todos);
  res.status(201).json(todo);
});

// PATCH update status
app.patch('/api/todos/:id', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const validStatuses = ['Offen', 'In Bearbeitung', 'Erledigt'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const todos = readTodos();
  const idx = todos.findIndex(t => t.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  todos[idx].status = status;
  writeTodos(todos);
  res.json(todos[idx]);
});

// DELETE todo
app.delete('/api/todos/:id', (req, res) => {
  const { id } = req.params;
  const todos = readTodos();
  const idx = todos.findIndex(t => t.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  todos.splice(idx, 1);
  writeTodos(todos);
  res.status(204).send();
});

app.listen(PORT, () => {
  console.log(`Todo app running at http://localhost:${PORT}`);
});

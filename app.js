const STORAGE_KEY = "momentum-todos-v1";

const todoForm = document.querySelector("#todoForm");
const todoInput = document.querySelector("#todoInput");
const priorityInput = document.querySelector("#priorityInput");
const dueDateInput = document.querySelector("#dueDateInput");
const searchInput = document.querySelector("#searchInput");
const todoList = document.querySelector("#todoList");
const summaryText = document.querySelector("#summaryText");
const openCount = document.querySelector("#openCount");
const doneCount = document.querySelector("#doneCount");
const streakCount = document.querySelector("#streakCount");
const clearCompletedBtn = document.querySelector("#clearCompletedBtn");
const filterButtons = document.querySelectorAll(".filter-chip");
const emptyStateTemplate = document.querySelector("#emptyStateTemplate");

let state = {
  filter: "all",
  search: "",
  todos: loadTodos()
};

function loadTodos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTodos() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.todos));
}

function createTodo(title, priority, dueDate) {
  return {
    id: crypto.randomUUID(),
    title: title.trim(),
    priority,
    dueDate: dueDate || "",
    completed: false,
    createdAt: new Date().toISOString(),
    completedAt: ""
  };
}

function render() {
  const visibleTodos = getVisibleTodos();
  const openTodos = state.todos.filter((todo) => !todo.completed);
  const completedTodos = state.todos.filter((todo) => todo.completed);

  openCount.textContent = String(openTodos.length);
  doneCount.textContent = String(completedTodos.length);
  streakCount.textContent = String(calculateStreak(completedTodos));
  summaryText.textContent = buildSummary(visibleTodos.length, openTodos.length);

  todoList.innerHTML = "";

  if (visibleTodos.length === 0) {
    todoList.append(emptyStateTemplate.content.cloneNode(true));
    return;
  }

  visibleTodos
    .sort(sortTodos)
    .forEach((todo) => {
      todoList.append(buildTodoElement(todo));
    });
}

function getVisibleTodos() {
  return state.todos.filter((todo) => {
    const matchesFilter =
      state.filter === "all" ||
      (state.filter === "open" && !todo.completed) ||
      (state.filter === "done" && todo.completed);

    const searchNeedle = state.search.trim().toLowerCase();
    const matchesSearch =
      searchNeedle === "" ||
      todo.title.toLowerCase().includes(searchNeedle) ||
      formatDueDate(todo.dueDate).toLowerCase().includes(searchNeedle) ||
      todo.priority.toLowerCase().includes(searchNeedle);

    return matchesFilter && matchesSearch;
  });
}

function sortTodos(a, b) {
  if (a.completed !== b.completed) {
    return Number(a.completed) - Number(b.completed);
  }

  const priorityRank = { high: 0, medium: 1, low: 2 };
  if (priorityRank[a.priority] !== priorityRank[b.priority]) {
    return priorityRank[a.priority] - priorityRank[b.priority];
  }

  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
    return a.dueDate.localeCompare(b.dueDate);
  }

  if (a.dueDate && !b.dueDate) {
    return -1;
  }

  if (!a.dueDate && b.dueDate) {
    return 1;
  }

  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function buildSummary(visibleCount, openTodos) {
  if (state.todos.length === 0) {
    return "No tasks yet. Add one to get started.";
  }

  if (visibleCount === 0) {
    return "No tasks match this view.";
  }

  return `${visibleCount} showing, ${openTodos} still in motion.`;
}

function buildTodoElement(todo) {
  const item = document.createElement("li");
  item.className = `todo-item${todo.completed ? " done" : ""}`;

  const toggle = document.createElement("input");
  toggle.className = "todo-toggle";
  toggle.type = "checkbox";
  toggle.checked = todo.completed;
  toggle.setAttribute("aria-label", `Mark ${todo.title} as complete`);
  toggle.addEventListener("change", () => toggleTodo(todo.id));

  const content = document.createElement("div");

  const title = document.createElement("p");
  title.className = "todo-title";
  title.textContent = todo.title;
  content.append(title);

  const meta = document.createElement("div");
  meta.className = "todo-meta";
  meta.append(buildBadge(todo.priority, `Priority: ${capitalize(todo.priority)}`, `priority-${todo.priority}`));

  if (todo.dueDate) {
    const dueLabel = isOverdue(todo) ? `Overdue: ${formatDueDate(todo.dueDate)}` : `Due: ${formatDueDate(todo.dueDate)}`;
    meta.append(buildBadge("date", dueLabel));
  }

  meta.append(buildBadge("status", todo.completed ? "Completed" : "Active"));
  content.append(meta);

  const actions = document.createElement("div");
  actions.className = "todo-actions";

  const editButton = document.createElement("button");
  editButton.className = "icon-btn";
  editButton.type = "button";
  editButton.textContent = "Edit";
  editButton.addEventListener("click", () => editTodo(todo.id));

  const deleteButton = document.createElement("button");
  deleteButton.className = "icon-btn";
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => deleteTodo(todo.id));

  actions.append(editButton, deleteButton);
  item.append(toggle, content, actions);
  return item;
}

function buildBadge(kind, text, extraClass = "") {
  const badge = document.createElement("span");
  badge.className = `badge ${extraClass}`.trim();
  badge.dataset.kind = kind;
  badge.textContent = text;
  return badge;
}

function toggleTodo(id) {
  state.todos = state.todos.map((todo) =>
    todo.id === id
      ? {
          ...todo,
          completed: !todo.completed,
          completedAt: !todo.completed ? new Date().toISOString() : ""
        }
      : todo
  );

  saveTodos();
  render();
}

function deleteTodo(id) {
  state.todos = state.todos.filter((todo) => todo.id !== id);
  saveTodos();
  render();
}

function editTodo(id) {
  const todo = state.todos.find((entry) => entry.id === id);
  if (!todo) {
    return;
  }

  const nextTitle = window.prompt("Update your task", todo.title);
  if (nextTitle === null) {
    return;
  }

  const trimmedTitle = nextTitle.trim();
  if (trimmedTitle === "") {
    window.alert("Task title cannot be empty.");
    return;
  }

  state.todos = state.todos.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          title: trimmedTitle
        }
      : entry
  );

  saveTodos();
  render();
}

function clearCompleted() {
  state.todos = state.todos.filter((todo) => !todo.completed);
  saveTodos();
  render();
}

function calculateStreak(completedTodos) {
  const completionDays = new Set(
    completedTodos
      .filter((todo) => todo.completedAt)
      .map((todo) => todo.completedAt.slice(0, 10))
  );

  let streak = 0;
  const cursor = new Date();

  while (completionDays.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function isOverdue(todo) {
  if (!todo.dueDate || todo.completed) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(todo.dueDate) < today;
}

function formatDueDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

todoForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const todo = createTodo(todoInput.value, priorityInput.value, dueDateInput.value);
  state.todos = [todo, ...state.todos];
  saveTodos();

  todoForm.reset();
  priorityInput.value = "medium";
  todoInput.focus();
  render();
});

searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  render();
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    filterButtons.forEach((entry) => entry.classList.toggle("active", entry === button));
    render();
  });
});

clearCompletedBtn.addEventListener("click", clearCompleted);

render();

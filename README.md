# Momentum Todo

Momentum Todo is a lightweight, polished todo app built with plain HTML, CSS, and JavaScript. It runs entirely in the browser, stores tasks in `localStorage`, and gives you a focused dashboard for planning the day without a framework or backend.

## What it does

- Create tasks with a title, priority, and optional due date
- Mark tasks as complete and track a completion streak
- Filter tasks by `All`, `Open`, and `Done`
- Search tasks by title, priority, or due date
- Edit or delete tasks at any time
- Persist your list between page refreshes with `localStorage`

## Stack

- HTML
- CSS
- Vanilla JavaScript
- Browser `localStorage` for persistence

## Project structure

```text
.
├── index.html
├── styles.css
├── app.js
└── README.md
```

## Run locally

Open `index.html` directly in your browser, or serve the folder locally:

```bash
cd "/Users/rukshandias/Documents/Momentum Todo"
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Notes

- No build step is required
- No dependencies are required
- All data stays in your browser on the device where you use the app

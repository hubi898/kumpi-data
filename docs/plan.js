(function () {
  const CFG = window.KUMPI_PAGES || {};
  const TOKEN_KEY = "kumpi_gh_token";
  const lists = {
    david: document.getElementById("list-david"),
    anni: document.getElementById("list-anni"),
    shared: document.getElementById("list-shared")
  };
  const statusEl = document.getElementById("status");
  let tasksSha = null;
  let tasks = [];

  function token() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function ensureToken() {
    if (token()) return true;
    const entered = window.prompt(
      "Paste a GitHub token (fine-grained, Contents read/write on hubi898/kumpi-data). Stored only in this browser."
    );
    if (!entered) return false;
    localStorage.setItem(TOKEN_KEY, entered.trim());
    return true;
  }

  async function loadTasks() {
    // Prefer live GitHub Contents API when token exists; else public docs/tasks.json
    if (token()) {
      const url = `https://api.github.com/repos/${CFG.repo}/contents/${CFG.tasksPath}?ref=${CFG.branch}`;
      const res = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token()}`
        }
      });
      if (!res.ok) throw new Error("GitHub read failed: " + res.status);
      const body = await res.json();
      tasksSha = body.sha;
      const decoded = JSON.parse(atob(body.content.replace(/\n/g, "")));
      tasks = decoded.tasks || [];
      return;
    }
    const res = await fetch("./tasks.json?_=" + Date.now());
    if (!res.ok) throw new Error("Could not load tasks.json");
    const data = await res.json();
    tasks = data.tasks || [];
    tasksSha = null;
  }

  async function refreshSha() {
    const url = `https://api.github.com/repos/${CFG.repo}/contents/${CFG.tasksPath}?ref=${CFG.branch}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token()}`
      }
    });
    if (!res.ok) throw new Error("GitHub sha refresh failed: " + res.status);
    const body = await res.json();
    tasksSha = body.sha;
  }

  async function saveTasks() {
    if (!ensureToken()) throw new Error("Token required to save");
    await refreshSha();
    const content = btoa(unescape(encodeURIComponent(JSON.stringify({ tasks }, null, 2))));
    const res = await fetch(
      `https://api.github.com/repos/${CFG.repo}/contents/${CFG.tasksPath}`,
      {
        method: "PUT",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: "chore: update Kumpi tasks",
          content,
          sha: tasksSha,
          branch: CFG.branch
        })
      }
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error("Save failed: " + err);
    }
    const body = await res.json();
    tasksSha = body.content && body.content.sha;
  }

  function fmt(iso) {
    if (!iso) return "Unscheduled";
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function toLocalInput(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
      d.getMinutes()
    )}`;
  }

  function render() {
    Object.values(lists).forEach((el) => (el.innerHTML = ""));
    tasks
      .slice()
      .sort((a, b) => (a.status === "done") - (b.status === "done"))
      .forEach((task) => {
        const li = document.createElement("li");
        if (task.status === "done") li.classList.add("done");
        li.innerHTML = `
          <strong>${escapeHtml(task.title)}</strong>
          <div class="meta">${fmt(task.scheduledAt)}</div>
          <div class="row">
            <button data-act="toggle" data-id="${task.id}" type="button">${
              task.status === "done" ? "Reopen" : "Done"
            }</button>
            <input data-id="${task.id}" class="sched" type="datetime-local" value="${
              task.scheduledAt ? toLocalInput(task.scheduledAt) : ""
            }" />
            <button data-act="schedule" data-id="${task.id}" class="secondary" type="button">Save time</button>
            <button data-act="delete" data-id="${task.id}" class="secondary" type="button">Delete</button>
          </div>`;
        (lists[task.owner] || lists.shared).appendChild(li);
      });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "t-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  document.getElementById("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const title = document.getElementById("title").value.trim();
      const owner = document.getElementById("owner").value;
      const scheduledRaw = document.getElementById("scheduledAt").value;
      const now = new Date().toISOString();
      tasks.push({
        id: uid(),
        title,
        owner,
        status: "open",
        scheduledAt: scheduledRaw ? new Date(scheduledRaw).toISOString() : null,
        createdAt: now,
        updatedAt: now
      });
      await saveTasks();
      e.target.reset();
      await refresh();
      setStatus("Saved to GitHub");
    } catch (err) {
      setStatus(err.message || String(err));
    }
  });

  document.body.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    const task = tasks.find((t) => t.id === id);
    if (!task && act !== "delete") return;
    try {
      if (act === "toggle") {
        task.status = task.status === "done" ? "open" : "done";
        task.updatedAt = new Date().toISOString();
      } else if (act === "schedule") {
        const input = document.querySelector(`input.sched[data-id="${id}"]`);
        task.scheduledAt = input.value ? new Date(input.value).toISOString() : null;
        task.updatedAt = new Date().toISOString();
      } else if (act === "delete") {
        tasks = tasks.filter((t) => t.id !== id);
      }
      await saveTasks();
      await refresh();
      setStatus("Saved to GitHub");
    } catch (err) {
      setStatus(err.message || String(err));
    }
  });

  async function refresh() {
    await loadTasks();
    render();
    setStatus(token() ? "Synced with GitHub · editable" : "Read-only until a GitHub token is added (tap Add task)");
  }

  refresh().catch((err) => setStatus(err.message || String(err)));
})();

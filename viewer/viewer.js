/**
 * UMAP Viewer - Visualize emails in 2D space based on embedding similarity.
 */

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const tooltip = document.getElementById("tooltip");
const statusEl = document.getElementById("status");
const loadingEl = document.getElementById("loading");
const selectionRect = document.getElementById("selection-rect");
const sidebar = document.getElementById("sidebar");
const emailList = document.getElementById("email-list");
const selectedCountEl = document.getElementById("selected-count");
const sidebarCloseBtn = document.getElementById("sidebar-close");
const selectAllBtn = document.getElementById("select-all-btn");
const selectNoneBtn = document.getElementById("select-none-btn");
const archiveBtn = document.getElementById("archive-btn");
const senderSummary = document.getElementById("sender-summary");

/** @type {{message: object, embedding: number[], x: number, y: number, color: string, alpha: number, isArchived: boolean}[]} */
let points = [];
let hoveredPoint = null;
let selectedPoints = [];

// View transform
let scale = 1;
let offsetX = 0;
let offsetY = 0;

// Selection state
let isSelecting = false;
let selectionStart = null;

// Pan state
let isPanning = false;
let panStart = null;

const POINT_RADIUS = 3;

// Date range for color mapping
let minDate = 0;
let maxDate = 0;

async function init() {
  try {
    setStatus("Finding active folder...");

    const mailTabs = await browser.mailTabs.query({});
    const activeTab = mailTabs.find((t) => t.active) ?? mailTabs[0];
    if (!activeTab) {
      throw new Error("No mail tab found.");
    }
    const fullTab = await browser.mailTabs.get(activeTab.id);
    if (!fullTab.displayedFolder) {
      throw new Error("No folder selected.");
    }

    const folder = fullTab.displayedFolder;
    setStatus(`Loading messages from ${folder.name}...`);

    const messages = [];
    let page = await browser.messages.list(folder.id);
    messages.push(...page.messages);
    while (page.id) {
      page = await browser.messages.continueList(page.id);
      messages.push(...page.messages);
    }

    if (messages.length === 0) {
      throw new Error("No messages in folder.");
    }

    setStatus(`Loading embeddings for ${messages.length} messages...`);

    const messageIds = messages.map((m) => m.headerMessageId);
    const embeddingsMap = await getEmbeddings(messageIds);

    const messagesWithEmbeddings = messages.filter((m) =>
      embeddingsMap.has(m.headerMessageId)
    );

    if (messagesWithEmbeddings.length < 2) {
      throw new Error(
        `Need at least 2 messages with embeddings. Found ${messagesWithEmbeddings.length}. Run "Seriate Folder" first.`
      );
    }

    setStatus(`Running UMAP on ${messagesWithEmbeddings.length} messages...`);

    const embeddingMatrix = messagesWithEmbeddings.map((m) =>
      embeddingsMap.get(m.headerMessageId)
    );

    // Run UMAP
    const UMAPClass = UMAP.UMAP ?? UMAP;
    const umap = new UMAPClass({
      nNeighbors: Math.min(15, Math.floor(messagesWithEmbeddings.length / 2)),
      minDist: 0.1,
      nComponents: 2,
    });

    const projection = await umap.fitAsync(embeddingMatrix);

    // Compute date range for color mapping
    const dates = messagesWithEmbeddings.map((m) => new Date(m.date).getTime());
    minDate = Math.min(...dates);
    maxDate = Math.max(...dates);

    // Create points array
    points = messagesWithEmbeddings.map((message, i) => {
      const timestamp = new Date(message.date).getTime();
      const isArchived = isArchivedEmail(message);
      return {
        message,
        embedding: embeddingMatrix[i],
        x: projection[i][0],
        y: projection[i][1],
        color: dateToColor(timestamp),
        alpha: isArchived ? 0.25 : 1.0,
        isArchived,
      };
    });

    normalizeCoordinates();

    loadingEl.style.display = "none";
    setStatus(`${points.length} emails`);

    resizeCanvas();
    render();
  } catch (err) {
    const errorDiv = document.createElement("div");
    errorDiv.style.color = "#dc2626";
    errorDiv.textContent = `Error: ${err.message}`;
    loadingEl.replaceChildren(errorDiv);
    console.error(err);
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

/**
 * Check if email is in an archive folder.
 */
function isArchivedEmail(message) {
  const folderPath = message.folder?.path?.toLowerCase() ?? "";
  return folderPath.includes("archive");
}

/**
 * Magma colormap stops (from matplotlib)
 */
const MAGMA = [
  [0.001462, 0.000466, 0.013866],
  [0.078815, 0.054184, 0.211667],
  [0.232077, 0.059889, 0.437695],
  [0.390384, 0.100379, 0.501864],
  [0.550287, 0.161158, 0.505719],
  [0.716387, 0.214982, 0.474625],
  [0.868793, 0.287728, 0.409303],
  [0.967671, 0.439703, 0.359630],
  [0.994738, 0.624350, 0.427397],
  [0.996341, 0.805866, 0.569042],
  [0.987053, 0.991438, 0.749504],
];

/**
 * Map a timestamp to a color using magma colormap (bright=oldest, dark=newest).
 */
function dateToColor(timestamp) {
  if (maxDate === minDate) return "rgb(252, 253, 191)";

  // Normalize: 0 = newest (dark), 1 = oldest (bright)
  const t = 1 - (timestamp - minDate) / (maxDate - minDate);

  // Find which segment we're in
  const idx = t * (MAGMA.length - 1);
  const i = Math.floor(idx);
  const f = idx - i;

  const c0 = MAGMA[Math.min(i, MAGMA.length - 1)];
  const c1 = MAGMA[Math.min(i + 1, MAGMA.length - 1)];

  const r = Math.round((c0[0] + (c1[0] - c0[0]) * f) * 255);
  const g = Math.round((c0[1] + (c1[1] - c0[1]) * f) * 255);
  const b = Math.round((c0[2] + (c1[2] - c0[2]) * f) * 255);

  return `rgb(${r}, ${g}, ${b})`;
}

function normalizeCoordinates() {
  if (points.length === 0) return;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  // Use the larger range to maintain 1:1 aspect ratio
  const maxRange = Math.max(rangeX, rangeY);
  const padding = 0.05;

  // Center the data in the smaller dimension
  const offsetX = (maxRange - rangeX) / 2;
  const offsetY = (maxRange - rangeY) / 2;

  for (const p of points) {
    p.x = padding + ((p.x - minX + offsetX) / maxRange) * (1 - 2 * padding);
    p.y = padding + ((p.y - minY + offsetY) / maxRange) * (1 - 2 * padding);
  }
}

function resizeCanvas() {
  const container = document.getElementById("canvas-container");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = container.clientWidth * dpr;
  canvas.height = container.clientHeight * dpr;
  canvas.style.width = container.clientWidth + "px";
  canvas.style.height = container.clientHeight + "px";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
}

function worldToScreen(wx, wy) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const x = (wx * width * scale) + offsetX;
  const y = (wy * height * scale) + offsetY;
  return { x, y };
}

function screenToWorld(sx, sy) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const wx = (sx - offsetX) / (width * scale);
  const wy = (sy - offsetY) / (height * scale);
  return { x: wx, y: wy };
}

function render() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  ctx.fillStyle = "#e0f0ff";
  ctx.fillRect(0, 0, width, height);

  // Draw points
  for (const point of points) {
    const { x, y } = worldToScreen(point.x, point.y);

    // Skip if off-screen
    if (x < -POINT_RADIUS || x > width + POINT_RADIUS ||
        y < -POINT_RADIUS || y > height + POINT_RADIUS) {
      continue;
    }

    ctx.beginPath();
    ctx.arc(x, y, POINT_RADIUS, 0, Math.PI * 2);
    ctx.globalAlpha = point.alpha;

    if (point === hoveredPoint) {
      ctx.fillStyle = "#000";
      ctx.globalAlpha = 1;
    } else if (selectedPoints.includes(point)) {
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.fillStyle = point.color;
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
      continue;
    } else {
      ctx.fillStyle = point.color;
    }
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

function findPointAt(screenX, screenY) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  for (const point of points) {
    const { x, y } = worldToScreen(point.x, point.y);
    const dx = screenX - x;
    const dy = screenY - y;
    if (dx * dx + dy * dy <= (POINT_RADIUS + 4) ** 2) {
      return point;
    }
  }
  return null;
}

function findPointsInRect(x1, y1, x2, y2) {
  // Convert screen coords to world coords
  const w1 = screenToWorld(Math.min(x1, x2), Math.min(y1, y2));
  const w2 = screenToWorld(Math.max(x1, x2), Math.max(y1, y2));

  return points.filter((p) =>
    p.x >= w1.x && p.x <= w2.x && p.y >= w1.y && p.y <= w2.y
  );
}

function showTooltip(point, mouseX, mouseY) {
  const msg = point.message;
  tooltip.querySelector(".subject").textContent = msg.subject || "(No subject)";
  const dateStr = new Date(msg.date).toLocaleDateString();
  const archivedStr = point.isArchived ? " (Archived)" : "";
  tooltip.querySelector(".meta").textContent = `${msg.author || "Unknown"} · ${dateStr}${archivedStr}`;

  const rect = canvas.getBoundingClientRect();
  let left = mouseX + 15;
  let top = mouseY + 15;

  if (left + 350 > rect.width) left = mouseX - 360;
  if (top + 80 > rect.height) top = mouseY - 90;

  tooltip.style.left = left + "px";
  tooltip.style.top = top + "px";
  tooltip.classList.add("visible");
}

function hideTooltip() {
  tooltip.classList.remove("visible");
}

function showSidebar(selected) {
  selectedPoints = selected;
  selectedCountEl.textContent = selected.length;

  // Build sender summary
  const senderCounts = new Map();
  for (const point of selected) {
    const sender = point.message.author || "Unknown";
    senderCounts.set(sender, (senderCounts.get(sender) || 0) + 1);
  }
  // Sort by count descending
  const sortedSenders = [...senderCounts.entries()].sort((a, b) => b[1] - a[1]);
  senderSummary.textContent = sortedSenders
    .map(([sender, count]) => `${extractName(sender)} (${count})`)
    .join(", ");

  // Sort by date, newest first
  const sorted = [...selected].sort((a, b) =>
    new Date(b.message.date) - new Date(a.message.date)
  );

  emailList.replaceChildren();
  for (const point of sorted) {
    const li = document.createElement("li");
    li.dataset.messageId = point.message.id;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true; // Selected by default
    checkbox.dataset.messageId = point.message.id;

    const content = document.createElement("div");
    content.className = "email-content";

    const subjectDiv = document.createElement("div");
    subjectDiv.className = "subject";
    subjectDiv.textContent = point.message.subject || "(No subject)";

    const metaDiv = document.createElement("div");
    metaDiv.className = "meta";
    metaDiv.textContent = `${point.message.author || "Unknown"} · ${new Date(point.message.date).toLocaleDateString()}`;

    content.appendChild(subjectDiv);
    content.appendChild(metaDiv);
    content.addEventListener("click", () => openEmail(point.message));

    const starBtn = document.createElement("button");
    starBtn.className = "star-btn" + (point.message.flagged ? " starred" : "");
    starBtn.textContent = "★";
    starBtn.title = point.message.flagged ? "Unstar" : "Star";
    starBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const newFlagged = !point.message.flagged;
      await browser.messages.update(point.message.id, { flagged: newFlagged });
      point.message.flagged = newFlagged;
      starBtn.classList.toggle("starred", newFlagged);
      starBtn.title = newFlagged ? "Unstar" : "Star";
    });

    li.appendChild(checkbox);
    li.appendChild(content);
    li.appendChild(starBtn);
    emailList.appendChild(li);
  }

  updateArchiveButtonCount();
  sidebar.classList.add("visible");
  render();
}

function getCheckedMessageIds() {
  const checkboxes = emailList.querySelectorAll('input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => parseInt(cb.dataset.messageId, 10));
}

function updateArchiveButtonCount() {
  const count = getCheckedMessageIds().length;
  archiveBtn.textContent = `Archive Selected (${count})`;
  archiveBtn.disabled = count === 0;
}

function hideSidebar() {
  sidebar.classList.remove("visible");
  selectedPoints = [];
  render();
}

/**
 * Extract just the name from "Name <email>" format.
 */
function extractName(author) {
  const match = author.match(/^([^<]+)</);
  if (match) return match[1].trim();
  // If no angle brackets, might just be an email
  const atIdx = author.indexOf("@");
  if (atIdx !== -1) return author.slice(0, atIdx);
  return author;
}

async function openEmail(message) {
  try {
    await browser.messageDisplay.open({
      messageId: message.id,
      location: "tab",
    });
  } catch (err) {
    console.error("Failed to open message:", err);
  }
}

// Event handlers
canvas.addEventListener("mousedown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  if (e.button === 0) {
    // Left click - start selection
    isSelecting = true;
    selectionStart = { x: mouseX, y: mouseY };
    selectionRect.style.display = "none";
  } else if (e.button === 2) {
    // Right click - start panning
    isPanning = true;
    panStart = { x: mouseX, y: mouseY, offsetX, offsetY };
  }
});

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault(); // Prevent context menu on right-click
});

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  if (isPanning && panStart) {
    // Pan the view
    offsetX = panStart.offsetX + (mouseX - panStart.x);
    offsetY = panStart.offsetY + (mouseY - panStart.y);
    render();
    return;
  }

  if (isSelecting && selectionStart) {
    // Draw selection rectangle
    const left = Math.min(selectionStart.x, mouseX);
    const top = Math.min(selectionStart.y, mouseY);
    const width = Math.abs(mouseX - selectionStart.x);
    const height = Math.abs(mouseY - selectionStart.y);

    if (width > 5 || height > 5) {
      selectionRect.style.display = "block";
      selectionRect.style.left = left + "px";
      selectionRect.style.top = top + "px";
      selectionRect.style.width = width + "px";
      selectionRect.style.height = height + "px";
    }
    return;
  }

  // Hover detection
  const point = findPointAt(mouseX, mouseY);
  if (point !== hoveredPoint) {
    hoveredPoint = point;
    render();
    if (point) {
      showTooltip(point, mouseX, mouseY);
      canvas.style.cursor = "pointer";
    } else {
      hideTooltip();
      canvas.style.cursor = "crosshair";
    }
  } else if (point) {
    showTooltip(point, mouseX, mouseY);
  }
});

canvas.addEventListener("mouseup", (e) => {
  if (isPanning) {
    isPanning = false;
    panStart = null;
    return;
  }

  if (!isSelecting) return;

  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  const wasActualDrag = selectionStart &&
    (Math.abs(mouseX - selectionStart.x) > 5 || Math.abs(mouseY - selectionStart.y) > 5);

  if (wasActualDrag) {
    // Complete rectangle selection
    const selected = findPointsInRect(
      selectionStart.x, selectionStart.y,
      mouseX, mouseY
    );
    if (selected.length > 0) {
      showSidebar(selected);
    }
  } else {
    // It was a click, not a drag
    const point = findPointAt(mouseX, mouseY);
    if (point) {
      openEmail(point.message);
    }
  }

  isSelecting = false;
  selectionStart = null;
  selectionRect.style.display = "none";
});

canvas.addEventListener("mouseleave", () => {
  hoveredPoint = null;
  hideTooltip();
  render();
  // Don't cancel selection or panning - let user drag outside and back
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();

  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // Zoom factor - no limits
  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
  const newScale = scale * zoomFactor;

  // Zoom centered on mouse position
  const worldPos = screenToWorld(mouseX, mouseY);
  scale = newScale;

  // Adjust offset to keep mouse position fixed
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  offsetX = mouseX - worldPos.x * width * scale;
  offsetY = mouseY - worldPos.y * height * scale;

  render();
}, { passive: false });

// Double-click to reset view
canvas.addEventListener("dblclick", () => {
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  render();
});

sidebarCloseBtn.addEventListener("click", hideSidebar);

selectAllBtn.addEventListener("click", () => {
  emailList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
  updateArchiveButtonCount();
});

selectNoneBtn.addEventListener("click", () => {
  emailList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
  updateArchiveButtonCount();
});

archiveBtn.addEventListener("click", async () => {
  const messageIds = getCheckedMessageIds();
  if (messageIds.length === 0) return;

  archiveBtn.disabled = true;
  archiveBtn.textContent = "Archiving...";

  try {
    await browser.messages.archive(messageIds);
    // Remove archived items from the list and points
    for (const id of messageIds) {
      const li = emailList.querySelector(`li[data-message-id="${id}"]`);
      if (li) li.remove();
      const idx = selectedPoints.findIndex(p => p.message.id === id);
      if (idx !== -1) selectedPoints.splice(idx, 1);
      const pointIdx = points.findIndex(p => p.message.id === id);
      if (pointIdx !== -1) points.splice(pointIdx, 1);
    }
    selectedCountEl.textContent = selectedPoints.length;
    updateArchiveButtonCount();
    render();
  } catch (err) {
    console.error("Archive failed:", err);
    alert("Failed to archive: " + err.message);
  }

  archiveBtn.disabled = false;
});

// Update archive count when checkboxes change
emailList.addEventListener("change", (e) => {
  if (e.target.type === "checkbox") {
    updateArchiveButtonCount();
  }
});

window.addEventListener("resize", () => {
  resizeCanvas();
  render();
});

// Start
init();

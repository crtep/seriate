const apiKeyInput = document.getElementById("apiKey");
const saveKeyBtn = document.getElementById("saveKey");
const seriateBtn = document.getElementById("seriate");
const viewUmapBtn = document.getElementById("viewUmap");
const statusDiv = document.getElementById("status");

// Load saved API key
browser.storage.local.get("apiKey").then(({ apiKey }) => {
  if (apiKey) {
    apiKeyInput.value = apiKey;
  }
});

saveKeyBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  await browser.storage.local.set({ apiKey: key });
  statusDiv.textContent = "API key saved.";
});

seriateBtn.addEventListener("click", () => {
  seriateBtn.disabled = true;
  statusDiv.textContent = "Starting...";
  browser.runtime.sendMessage({ action: "seriate" });
});

// Listen for status updates from background
browser.runtime.onMessage.addListener((message) => {
  if (message.action === "progress") {
    statusDiv.textContent = message.text;
  } else if (message.action === "done") {
    statusDiv.textContent = message.text;
    seriateBtn.disabled = false;
  } else if (message.action === "error") {
    statusDiv.textContent = `Error: ${message.text}`;
    seriateBtn.disabled = false;
  }
});

viewUmapBtn.addEventListener("click", async () => {
  await browser.tabs.create({ url: "/viewer/viewer.html" });
  window.close();
});

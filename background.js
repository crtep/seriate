/**
 * Background script for Seriate.
 * Orchestrates embedding computation, seriation, and column updates.
 */

// Register the custom column on startup
browser.seriateColumn.addColumn();

// Open floating control window when toolbar button is clicked
browser.browserAction.onClicked.addListener(() => {
  browser.windows.create({
    url: "/popup/popup.html",
    type: "popup",
    width: 360,
    height: 300,
  });
});

/**
 * Handle messages from the popup.
 */
browser.runtime.onMessage.addListener((message) => {
  if (message.action === "seriate") {
    // Fire and forget — results sent back via separate messages
    handleSeriate();
  }
});

/**
 * Send a status update to the popup (if open).
 * @param {"progress" | "done" | "error"} type
 * @param {string} text
 * @param {object} [data]
 */
function sendStatus(type, text, data) {
  browser.runtime.sendMessage({ action: type, text, ...data }).catch(() => {
    // Popup may be closed; ignore
  });
}

async function handleSeriate() {
  try {
    const apiKey = (await browser.storage.local.get("apiKey")).apiKey;
    if (!apiKey) {
      throw new Error("OpenAI API key not configured. Set it in the popup.");
    }

    // Get the active mail tab with full details
    sendStatus("progress", "Finding active mail tab...");
    const allMailTabs = await browser.mailTabs.query({});
    if (!allMailTabs.length) {
      throw new Error("No mail tabs found.");
    }
    const mailTab = allMailTabs.find((t) => t.active) ?? allMailTabs[0];
    const fullTab = await browser.mailTabs.get(mailTab.id);
    if (!fullTab.displayedFolder) {
      throw new Error("No folder selected in mail tab.");
    }

    const folder = fullTab.displayedFolder;
    sendStatus("progress", `Reading messages from ${folder.name}...`);

    // Collect all messages in the folder
    const messages = [];
    let page = await browser.messages.list(folder.id);
    messages.push(...page.messages);
    while (page.id) {
      page = await browser.messages.continueList(page.id);
      messages.push(...page.messages);
    }

    if (messages.length === 0) {
      throw new Error("No messages in the current folder.");
    }

    sendStatus("progress", `Found ${messages.length} messages. Checking for cached embeddings...`);

    // Check which messages already have embeddings
    const messageIds = messages.map((m) => m.headerMessageId);
    const cachedEmbeddings = await getEmbeddings(messageIds);

    const needEmbedding = messages.filter(
      (m) => !cachedEmbeddings.has(m.headerMessageId)
    );

    sendStatus("progress", `${cachedEmbeddings.size} cached, ${needEmbedding.length} need embedding.`);

    // Compute missing embeddings
    if (needEmbedding.length > 0) {
      sendStatus("progress", `Fetching message bodies (0/${needEmbedding.length})...`);
      const texts = [];
      for (let i = 0; i < needEmbedding.length; i++) {
        const msg = needEmbedding[i];
        const full = await browser.messages.getFull(msg.id);
        texts.push(extractMessageText(msg, full));
        if ((i + 1) % 10 === 0) {
          sendStatus("progress", `Fetching message bodies (${i + 1}/${needEmbedding.length})...`);
        }
      }

      sendStatus("progress", `Computing embeddings for ${needEmbedding.length} messages...`);
      const newEmbeddings = await fetchEmbeddings(apiKey, texts);

      const entries = needEmbedding.map((msg, i) => ({
        messageId: msg.headerMessageId,
        embedding: newEmbeddings[i],
      }));

      // Store in background (don't await)
      storeEmbeddings(entries).catch((err) =>
        console.error("Failed to store embeddings:", err)
      );

      // Add to cached map
      for (const entry of entries) {
        cachedEmbeddings.set(entry.messageId, entry.embedding);
      }
    }

    sendStatus("progress", "Running seriation...");

    // Build embedding array in message order
    const embeddingArray = messageIds.map((id) => cachedEmbeddings.get(id));
    const order = seriate(embeddingArray);

    // Convert order to ranks
    /** @type {Object<string, number>} */
    const ranks = {};
    for (let position = 0; position < order.length; position++) {
      const originalIndex = order[position];
      const messageId = messageIds[originalIndex];
      ranks[messageId] = position + 1;
    }

    sendStatus("progress", "Updating column...");
    await browser.seriateColumn.setRanks(ranks);

    sendStatus("done", `Done. Seriated ${messages.length} messages.`, {
      count: messages.length,
    });
  } catch (err) {
    sendStatus("error", err.message ?? String(err));
  }
}

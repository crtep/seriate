/**
 * OpenAI embeddings client.
 */

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_BATCH_SIZE = 100;

/**
 * Fetch embeddings for a batch of texts from the OpenAI API.
 *
 * @param {string} apiKey
 * @param {string[]} texts
 * @returns {Promise<number[][]>} Array of embedding vectors, same order as texts
 */
async function fetchEmbeddings(apiKey, texts) {
  /** @type {number[][]} */
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: batch,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    // Response data is sorted by index, but sort explicitly to be safe
    const sorted = data.data.sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      allEmbeddings.push(item.embedding);
    }
  }

  return allEmbeddings;
}

/**
 * Extract plain text from a message for embedding.
 * Combines subject, sender, and body text.
 *
 * @param {object} message - WebExtension MessageHeader
 * @param {object} fullMessage - Result of messages.getFull()
 * @returns {string}
 */
function extractMessageText(message, fullMessage) {
  const parts = [];

  if (message.subject) {
    parts.push(`Subject: ${message.subject}`);
  }
  if (message.author) {
    parts.push(`From: ${message.author}`);
  }

  const bodyText = extractBodyText(fullMessage);
  if (bodyText) {
    // Truncate to ~8000 chars to stay within token limits
    parts.push(bodyText.slice(0, 8000));
  }

  return parts.join("\n");
}

/**
 * Recursively extract text content from a MIME message part tree.
 *
 * @param {object} part - MessagePart from messages.getFull()
 * @returns {string}
 */
function extractBodyText(part) {
  if (part.contentType === "text/plain" && part.body) {
    return part.body;
  }

  if (part.contentType === "text/html" && part.body) {
    // Strip HTML tags for a rough plain-text extraction
    return part.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  if (part.parts) {
    for (const child of part.parts) {
      const text = extractBodyText(child);
      if (text) return text;
    }
  }

  return "";
}

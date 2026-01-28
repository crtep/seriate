# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Seriate** is a Thunderbird 128+ MailExtension (WebExtension, Manifest V2) that computes embeddings of emails via the OpenAI API, then seriates them so similar emails are adjacent. It adds a custom "Seriate" column to the thread pane that users can sort by.

Based on the seriation concept from [this LessWrong post](https://www.lesswrong.com/posts/u2ww8yKp9xAB6qzcr/if-you-re-not-sure-how-to-sort-a-list-or-grid-seriate-it).

## Architecture

The extension has two execution contexts that communicate differently:

- **WebExtension sandbox** (`background.js`, `popup/`, `lib/`): Standard WebExtension code. Handles API calls, IndexedDB storage, seriation logic, and UI. Scripts are concatenated via the manifest's `background.scripts` array (order matters: `lib/` files first, then `background.js`).
- **Experiment API** (`api/seriateColumn/`): Privileged chrome-process code that accesses Thunderbird's internal `ThreadPaneColumns.mjs` to register a custom column. Functions cannot be passed across the boundary — callbacks (textCallback, sortCallback) live entirely in `implementation.js` and operate on an in-memory ranks map populated via `setRanks()`.

### Key flows

**Seriation (column sorting):**
1. User clicks "Seriate Folder" in the popup
2. `background.js` lists messages in the current folder via `browser.messages`
3. Checks IndexedDB for cached embeddings, fetches missing ones from OpenAI
4. Runs greedy nearest-neighbor seriation on the embedding distance matrix
5. Passes `{messageId: rank}` map to the Experiment API via `browser.seriateColumn.setRanks()`
6. Experiment refreshes the custom column; user can sort by it

**UMAP visualization:**
1. User clicks "View UMAP" in the popup
2. Opens `viewer/viewer.html` in a new tab
3. Viewer loads cached embeddings from IndexedDB
4. Runs UMAP (via umap-js) to project to 2D
5. Renders points on canvas; hover shows tooltip, click opens email

### Message identity

Messages are keyed by `headerMessageId` (the Message-ID header value) across both contexts. In the Experiment, this is `msgHdr.messageId`; in the WebExtension, it's `message.headerMessageId`.

## Development

### Install for testing

In Thunderbird: **Settings > Add-ons > gear icon > Debug Add-ons > Load Temporary Add-on** and select `manifest.json`.

### No build step

Plain JavaScript, no bundler or transpiler. Load directly from source.

## Code Style

- Plain JavaScript with JSDoc type annotations.
- No fallback code — prefer runtime errors over silently wrong behavior.
- When calling Claude Sonnet API, use model ID: `claude-sonnet-4-20250514`.

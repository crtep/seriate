"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);

var seriateColumn = class extends ExtensionCommon.ExtensionAPI {
  constructor(...args) {
    super(...args);
    /** @type {Map<string, number>} Message-ID -> rank */
    this.ranks = new Map();
  }

  _getThreadPaneColumns() {
    const { ThreadPaneColumns } = ChromeUtils.importESModule(
      "chrome://messenger/content/ThreadPaneColumns.mjs"
    );
    return ThreadPaneColumns;
  }

  _addColumn() {
    const self = this;
    const tpc = this._getThreadPaneColumns();

    tpc.addCustomColumn("seriate-rank", {
      name: "Seriate",
      sortable: true,
      resizable: true,
      textCallback(msgHdr) {
        const rank = self.ranks.get(msgHdr.messageId);
        return rank != null ? String(rank) : "";
      },
      sortCallback(msgHdr) {
        const rank = self.ranks.get(msgHdr.messageId);
        return rank != null ? rank : Number.MAX_SAFE_INTEGER;
      },
    });
  }

  _removeColumn() {
    try {
      const tpc = this._getThreadPaneColumns();
      tpc.removeCustomColumn("seriate-rank");
    } catch (e) {
      // Column may not exist yet
    }
  }

  _refreshColumn() {
    try {
      const tpc = this._getThreadPaneColumns();
      tpc.refreshCustomColumn("seriate-rank");
    } catch (e) {
      // Ignore if column doesn't exist
    }
  }

  getAPI(context) {
    const self = this;

    return {
      seriateColumn: {
        async addColumn() {
          self._addColumn();
        },

        async removeColumn() {
          self._removeColumn();
        },

        async setRanks(ranks) {
          self.ranks.clear();
          for (const [messageId, rank] of Object.entries(ranks)) {
            self.ranks.set(messageId, rank);
          }
          self._refreshColumn();
        },

        async clearRanks() {
          self.ranks.clear();
          self._refreshColumn();
        },
      },
    };
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) return;
    this._removeColumn();
    Services.obs.notifyObservers(null, "startupcache-invalidate");
  }
};

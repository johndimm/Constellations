/// <reference types="chrome" />

chrome.runtime.onInstalled.addListener((details) => {
    chrome.contextMenus.create({
        id: "constellations-graph-selection",
        title: "Graph '%s' on Constellations",
        contexts: ["selection"]
    });

    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        chrome.tabs.create({ url: "chrome-extension/welcome.html" });
    }

    // Allow clicking the extension icon to open the side panel directly
    // @ts-ignore
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
        // @ts-ignore
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
            .catch((error: any) => console.error(error));
    }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "constellations-graph-selection" && info.selectionText && tab?.id) {
        // Run in parallel to ensure sidePanel.open is called within the user gesture
        const storagePromise = chrome.storage.local.set({
            pendingQuery: info.selectionText.trim(),
            timestamp: Date.now()
        });

        // Open the side panel immediately
        const openPromise = chrome.sidePanel.open({ tabId: tab.id }).catch((e) => {
            console.error("Failed to open side panel:", e);
        });

        await Promise.all([storagePromise, openPromise]);
    }
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "OPEN_SIDE_PANEL" && message.query && sender.tab?.id) {
        (async () => {
            try {
                // Save query first
                await chrome.storage.local.set({
                    pendingQuery: message.query.trim(),
                    timestamp: Date.now()
                });
                // Open panel (requires user gesture, which click -> message usually preserves)
                await chrome.sidePanel.open({ tabId: sender.tab.id });
                sendResponse({ success: true });
            } catch (e) {
                console.error("Failed to open side panel from content script:", e);
                sendResponse({ error: e instanceof Error ? e.message : String(e) });
            }
        })();
        return true; // Keep channel open for async response
    }
});

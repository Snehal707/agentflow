import {
  getWalletBalance,
  listFundPlans,
  streamExtensionAnalyze,
} from "./lib/api";
import { getStoredAuth } from "./lib/auth";

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "af-analyze") {
    return;
  }

  port.onMessage.addListener(
    (msg: { type?: string; url?: string; question?: string }) => {
      if (msg.type !== "analyze" || !msg.url || !msg.question) {
        return;
      }
      const analyzeUrl = msg.url;
      const analyzeQuestion = msg.question;

      void (async () => {
        const auth = await getStoredAuth();
        if (!auth?.jwt) {
          port.postMessage({
            type: "error",
            error: "Not signed in. Open settings and save your JWT.",
          });
          return;
        }

        await streamExtensionAnalyze(auth.jwt, analyzeUrl, analyzeQuestion, {
          onDelta: (delta) => port.postMessage({ type: "delta", delta }),
          onDone: () => port.postMessage({ type: "done" }),
          onError: (message) => port.postMessage({ type: "error", error: message }),
        });
      })();
    },
  );
});

chrome.runtime.onMessage.addListener(
  (
    request: { type?: string },
    _sender,
    sendResponse: (r: unknown) => void,
  ) => {
    if (request.type === "getSummary") {
      void (async () => {
        try {
          const auth = await getStoredAuth();
          if (!auth?.jwt) {
            sendResponse({ ok: false, error: "no_auth" });
            return;
          }
          const [balance, plans] = await Promise.all([
            getWalletBalance(auth.jwt).catch(() => null),
            listFundPlans(auth.jwt).catch(() => null),
          ]);
          sendResponse({ ok: true, balance, plans });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }
    return false;
  },
);

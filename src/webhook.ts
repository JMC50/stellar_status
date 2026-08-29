import type { BroadcastStatus } from "./broadcastStore";

const WEBHOOK_URL = process.env.STELINFO_WEBHOOK_URL?.trim();
const WEBHOOK_SECRET = process.env.STELINFO_WEBHOOK_SECRET?.trim();
const WEBHOOK_TIMEOUT_MS = 5000;

let warnedMissingConfig = false;

function logError(context: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[stellar_status][${context}]`, msg);
    if (stack) console.error(stack);
}

/**
 * Tells stelinfo a stream just went live, so it can push "방송 시작"
 * notifications to subscribers. Fire-and-forget by design: a slow or down
 * stelinfo backend must never hold up this project's own polling cycle, so
 * this never throws and callers don't (and shouldn't) await it.
 */
export function notifyBroadcastStarted(stellarId: string, status: BroadcastStatus): void {
    if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
        if (!warnedMissingConfig) {
            warnedMissingConfig = true;
            console.log(
                "[stellar_status][webhook] STELINFO_WEBHOOK_URL/STELINFO_WEBHOOK_SECRET 미설정 — 방송 시작 웹훅 비활성화"
            );
        }
        return;
    }

    fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Webhook-Secret": WEBHOOK_SECRET
        },
        body: JSON.stringify({
            stellarId,
            title: status.title,
            url: status.url,
            startedAt: status.date
        }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
    })
        .then((res) => {
            if (!res.ok) {
                logError(`webhook ${stellarId}`, `stelinfo responded ${res.status}`);
            }
        })
        .catch((err) => {
            logError(`webhook ${stellarId}`, err);
        });
}

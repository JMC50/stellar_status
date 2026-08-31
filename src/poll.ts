import { STREAMERS, type StreamerConfig } from "./streamers";
import { captureBroadcastStatus } from "./chzzkCapture";
import { getBroadcastStatus, markCycleComplete, setBroadcastStatus } from "./broadcastStore";
import { notifyBroadcastStarted } from "./webhook";

const POLL_INTERVAL_MS = 3 * 60 * 1000;
const BETWEEN_REQUESTS_MS = 1_500;
const IDLE_PROGRESS_TICK_MS = 500;
const DEFAULT_STARTUP_DELAY_BEFORE_FIRST_CYCLE_MS = 5_000;

type CycleFailure = {
    name: string;
    channelId: string;
    detail: string;
};

function logError(context: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[stellar_status][${context}]`, msg);
    if (stack) console.error(stack);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 첫 순환 전 대기 — 브라우저 launch 등 콜드 스타트 완화 */
function getStartupDelayBeforeFirstCycleMs(): number {
    const raw = process.env.STELLAR_STATUS_STARTUP_DELAY_MS?.trim();
    if (raw === undefined || raw === "") {
        return DEFAULT_STARTUP_DELAY_BEFORE_FIRST_CYCLE_MS;
    }
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0 || n > 120_000) {
        return DEFAULT_STARTUP_DELAY_BEFORE_FIRST_CYCLE_MS;
    }
    return n;
}

/** npm 설치 로그처럼 한 줄에 진행 막대 + 퍼센트 */
function formatProgressBar(completed: number, total: number, barWidth = 28): string {
    if (total <= 0) return "[░░░░░░░░░░░░░░░░░░░░░░░░░░░░]   0.0% (0/0)";
    const ratio = Math.min(1, Math.max(0, completed / total));
    const filled = Math.round(ratio * barWidth);
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
    const pctStr = `${(ratio * 100).toFixed(1)}%`.padStart(6, " ");
    return `[${bar}] ${pctStr} (${completed}/${total})`;
}

/** 0~1 비율(대기 진행 등) */
function formatRatioProgressBar(ratio: number, barWidth = 28): string {
    const r = Math.min(1, Math.max(0, ratio));
    const filled = Math.round(r * barWidth);
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
    const pctStr = `${(r * 100).toFixed(1)}%`.padStart(6, " ");
    return `[${bar}] ${pctStr}`;
}

function formatRoughRemainingKo(ms: number): string {
    const s = Math.max(0, Math.ceil(ms / 1000));
    if (s < 60) return `약 ${s}초`;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    if (sec === 0) return `약 ${m}분`;
    return `약 ${m}분 ${sec}초`;
}

function clearStdoutProgressLine(): void {
    process.stdout.write("\x1b[2K\r");
}

/** 순환과 순환 사이 POLL 간격 동안 대기 진행률 */
async function idleWaitWithProgress(totalMs: number): Promise<void> {
    if (totalMs <= 0) return;
    const start = Date.now();
    for (;;) {
        const elapsed = Date.now() - start;
        const ratio = Math.min(1, elapsed / totalMs);
        const remaining = Math.max(0, totalMs - elapsed);
        const bar = formatRatioProgressBar(ratio);
        const tail = `· 다음 순환까지 ${formatRoughRemainingKo(remaining)}`;
        const line = `[idle] ${bar} ${tail}`;
        const maxLen = 120;
        const clipped = line.length > maxLen ? `${line.slice(0, maxLen - 1)}…` : line;
        process.stdout.write("\x1b[2K\r" + clipped);
        if (remaining <= 0) break;
        await delay(Math.min(IDLE_PROGRESS_TICK_MS, remaining));
    }
    clearStdoutProgressLine();
    process.stdout.write("\n");
}

function writeCycleProgressLine(completed: number, total: number, tail: string, maxLen = 120): void {
    const base = `[cycle] ${formatProgressBar(completed, total)} ${tail}`;
    const line = base.length > maxLen ? `${base.slice(0, maxLen - 1)}…` : base;
    process.stdout.write("\x1b[2K\r" + line);
}

function fail(row: StreamerConfig, detail: string): CycleFailure {
    return { name: row.name, channelId: row.channelId, detail };
}

/**
 * 한 스트리머: chzzk 캡처 → 메모리 저장.
 * 예기치 않은 예외는 실패로 기록하고 서버 프로세스는 유지합니다.
 */
async function processStreamerRow(row: StreamerConfig): Promise<CycleFailure | null> {
    try {
        const status = await captureBroadcastStatus(row.channelId);
        if (!status) {
            return fail(row, "no live/video data found");
        }

        // Compare against the previous cycle's status *before* overwriting
        // it, so a stream that's still live from last cycle doesn't fire
        // the webhook again — only the actual off→on transition should.
        // `previous === null` means this streamer has never been observed
        // this process lifetime (first cycle after a restart) — that's a
        // baseline snapshot, not a transition, so it must NOT notify even
        // if they happen to already be live: broadcastStatus resets on every
        // restart, and without this check a restart during a broadcast
        // would wrongly re-fire "방송 시작" for every streamer already live.
        const previous = getBroadcastStatus(row.name);
        const justWentLive = status.isLive && previous !== null && !previous.isLive;

        // Debug visibility for the transition decision itself -- only logged
        // while actually live, so this doesn't spam every offline streamer
        // every cycle.
        if (status.isLive) {
            console.log(
                `[stellar_status][live] ${row.name} isLive=true, previous=${
                    previous === null ? "null(첫 관측)" : previous.isLive ? "live" : "offline"
                }, justWentLive=${justWentLive}`
            );
        }

        setBroadcastStatus(row.name, status);

        if (justWentLive) {
            notifyBroadcastStarted(row.name, status);
        }

        return null;
    } catch (err) {
        return fail(row, err instanceof Error ? err.message : String(err));
    }
}

/** POLL_INTERVAL_MS 마다 1회: 배열 전원을 순서대로 조회(요청 간 `BETWEEN_REQUESTS_MS` 간격) */
async function fetchFullCycleBroadcastStatuses(): Promise<void> {
    if (STREAMERS.length === 0) {
        console.error("[cycle] STREAMERS 배열이 비어 있습니다.");
        return;
    }

    const total = STREAMERS.length;
    const failures: CycleFailure[] = [];

    try {
        writeCycleProgressLine(0, total, "시작…");

        for (let i = 0; i < total; i++) {
            const row = STREAMERS[i]!;
            try {
                writeCycleProgressLine(i, total, `진행: ${row.name} …`);
                const failResult = await processStreamerRow(row);
                if (failResult) failures.push(failResult);

                const done = i + 1;
                const tail = failResult ? `· ${row.name} 실패` : `· ${row.name} 완료`;
                writeCycleProgressLine(done, total, tail);
            } catch (err) {
                failures.push(fail(row, err instanceof Error ? err.message : String(err)));
                writeCycleProgressLine(i + 1, total, `· ${row.name} 예외(내부)`);
                logError(`cycle row ${row.name}`, err);
            }

            if (i < total - 1) {
                try {
                    await delay(BETWEEN_REQUESTS_MS);
                } catch (err) {
                    logError("delay BETWEEN_REQUESTS_MS", err);
                }
            }
        }
    } catch (err) {
        clearStdoutProgressLine();
        process.stdout.write("\n");
        logError("fetchFullCycleBroadcastStatuses", err);
        console.error(`[cycle] ${new Date().toISOString()} 순환 전체 중 예외 — 다음 주기까지 계속합니다.`);
        return;
    }

    clearStdoutProgressLine();
    process.stdout.write("\n");

    markCycleComplete();

    const ts = new Date().toISOString();
    const successCount = total - failures.length;
    const failCount = failures.length;

    try {
        console.log(`[cycle] ${ts} 순환 요약`);
        console.log(`  · 성공: ${successCount}명 · 실패: ${failCount}명`);
        if (failCount > 0) {
            const details = failures.map((f) => `${f.name} (${f.detail})`);
            console.log(`  · 실패 상세: ${details.join(" | ")}`);
        }
    } catch (err) {
        logError("cycle summary log", err);
    }
}

export async function runPollingLoop(): Promise<void> {
    const startupMs = getStartupDelayBeforeFirstCycleMs();
    if (startupMs > 0) {
        console.log(
            `[stellar_status] 첫 순환 전 ${startupMs}ms 대기 (STELLAR_STATUS_STARTUP_DELAY_MS, 기본 ${DEFAULT_STARTUP_DELAY_BEFORE_FIRST_CYCLE_MS})`
        );
        try {
            await delay(startupMs);
        } catch (err) {
            logError("runPollingLoop.startupDelay", err);
        }
    }

    for (;;) {
        try {
            await fetchFullCycleBroadcastStatuses();
        } catch (err) {
            logError("runPollingLoop.fetchFullCycleBroadcastStatuses", err);
        }
        try {
            await idleWaitWithProgress(POLL_INTERVAL_MS);
        } catch (err) {
            logError("runPollingLoop.idleWaitWithProgress", err);
            await delay(POLL_INTERVAL_MS);
        }
    }
}

export { POLL_INTERVAL_MS, BETWEEN_REQUESTS_MS, IDLE_PROGRESS_TICK_MS, getStartupDelayBeforeFirstCycleMs };

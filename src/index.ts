import path from "node:path";
import dotenv from "dotenv";
import express from "express";
import { STREAMERS } from "./streamers";
import { getBroadcastStatus, getLastUpdatedAt } from "./broadcastStore";
import {
    runPollingLoop,
    POLL_INTERVAL_MS,
    BETWEEN_REQUESTS_MS,
    IDLE_PROGRESS_TICK_MS,
    getStartupDelayBeforeFirstCycleMs
} from "./poll";
import { closeBrowser } from "./chzzkCapture";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

function logError(context: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[stellar_status][${context}]`, msg);
    if (stack) console.error(stack);
}

function installProcessExceptionHandlers(): void {
    process.on("uncaughtException", (err) => {
        logError("uncaughtException", err);
    });
    process.on("unhandledRejection", (reason) => {
        logError("unhandledRejection", reason);
    });
}

function getPort(): number {
    const raw = process.env.PORT?.trim();
    if (!raw) {
        console.error("[stellar_status] .env에 PORT가 없습니다. 예: PORT=4101");
        process.exit(1);
    }
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        console.error("[stellar_status] PORT가 올바른 숫자가 아닙니다:", raw);
        process.exit(1);
    }
    return port;
}

installProcessExceptionHandlers();

if (STREAMERS.length === 0) {
    console.error("[stellar_status] STREAMERS가 비어 있어 종료합니다.");
    process.exit(1);
}

let port = 0;
try {
    port = getPort();
} catch (err) {
    logError("port config", err);
    console.error("[stellar_status] 포트 설정을 읽지 못했습니다. 종료합니다.");
    process.exit(1);
}

const app = express();

app.get("/health", (_req, res) => {
    try {
        res.json({
            ok: true,
            pollIntervalMs: POLL_INTERVAL_MS,
            betweenRequestsMs: BETWEEN_REQUESTS_MS,
            idleProgressTickMs: IDLE_PROGRESS_TICK_MS,
            startupDelayBeforeFirstCycleMs: getStartupDelayBeforeFirstCycleMs(),
            streamerCount: STREAMERS.length,
            pollMode: "full_cycle_per_interval",
            lastUpdatedAt: getLastUpdatedAt()
        });
    } catch (err) {
        logError("GET /health", err);
        res.status(500).json({ ok: false, error: "internal_error" });
    }
});

/** 등록된 모든 스트리머의 현재 상태(라이브 또는 최근 다시보기) */
app.get("/status", (_req, res) => {
    try {
        const streamers: Record<string, ReturnType<typeof getBroadcastStatus>> = {};
        for (const streamer of STREAMERS) {
            streamers[streamer.name] = getBroadcastStatus(streamer.name);
        }
        res.json({
            updatedAt: getLastUpdatedAt(),
            streamers
        });
    } catch (err) {
        logError("GET /status", err);
        res.status(500).json({ ok: false, error: "internal_error" });
    }
});

/** 특정 스트리머의 현재 상태(라이브 또는 최근 다시보기) */
app.get("/status/:stellarId", (req, res) => {
    try {
        const known = STREAMERS.some((s) => s.name === req.params.stellarId);
        if (!known) {
            res.status(404).json({ error: "unknown streamer" });
            return;
        }

        const status = getBroadcastStatus(req.params.stellarId);
        if (!status) {
            res.status(404).json({ error: "no data yet" });
            return;
        }

        res.json(status);
    } catch (err) {
        logError("GET /status/:stellarId", err);
        res.status(500).json({ ok: false, error: "internal_error" });
    }
});

app.use(
    (
        err: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
    ) => {
        logError("express", err);
        if (!res.headersSent) {
            res.status(500).json({ ok: false, error: "internal_error" });
        }
    }
);

const server = app.listen(port, () => {
    const startup = getStartupDelayBeforeFirstCycleMs();
    console.log(
        `[stellar_status] :${port} /health, /status, /status/:stellarId | 순환 후 ${
            POLL_INTERVAL_MS / 60000
        }분 대기(진행률) | 요청 간격 ${BETWEEN_REQUESTS_MS}ms | 첫 순환 전 ${startup}ms`
    );
    void runPollingLoop().catch((err) => {
        logError("runPollingLoop (top-level)", err);
    });
});

server.on("error", (err) => {
    logError("http server", err);
});

async function shutdown(signal: string): Promise<void> {
    console.log(`[stellar_status] ${signal} 수신 — 종료합니다.`);
    server.close();
    await closeBrowser().catch((err) => logError("closeBrowser", err));
    process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

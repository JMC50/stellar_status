import { chromium, type Browser } from "playwright";
import type { BroadcastStatus } from "./broadcastStore";

// chzzk's own live-detail/videos endpoints reject plain server-to-server
// requests (WAF), but accept the exact same requests when they come from a
// real browser — so a real (headless) browser loads the channel's public
// live page, and we read the JSON responses it naturally makes while
// rendering, rather than hitting the API directly ourselves.
let browserPromise: Promise<Browser> | null = null;
function getBrowser(): Promise<Browser> {
    if (!browserPromise) {
        browserPromise = chromium.launch({
            headless: true,
            // Chromium's sandbox needs a user-namespace setup that most
            // servers (running as root, or inside a container) don't have,
            // so it silently fails to launch there without this.
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });
    }
    return browserPromise;
}

interface CapturedResponses {
    liveDetail: any;
    videos: any;
}

// Ceiling for the rare case the page never fires the responses we need at
// all (network hiccup, chzzk markup change, etc).
const CAPTURE_TIMEOUT_MS = 20000;

async function captureChannelPage(channelId: string): Promise<CapturedResponses> {
    const browser = await getBrowser();

    const context = await browser.newContext({
        userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 720 },
        locale: "ko-KR",
        timezoneId: "Asia/Seoul"
    });

    const page = await context.newPage();
    const captured: CapturedResponses = { liveDetail: null, videos: null };

    try {
        // Don't wait for the page's own "done loading" signal — this page
        // keeps loading for a long time after (hundreds of ad/chat-emoji/
        // badge requests), and neither "load" nor "networkidle" reflect
        // when the two responses we actually care about have arrived.
        // Instead resolve as soon as we have what we need: a live broadcast
        // only needs live-detail; a non-live one needs both live-detail
        // (to know it's not live) and videos.
        await new Promise<void>((resolve) => {
            let settled = false;
            const maybeDone = () => {
                if (settled) return;
                const isLive = captured.liveDetail?.content?.status === "OPEN";
                if (isLive || (captured.liveDetail && captured.videos)) {
                    settled = true;
                    resolve();
                }
            };

            page.on("response", async (response) => {
                if (!response.ok()) return;
                const url = response.url();
                try {
                    if (url.includes(`/channels/${channelId}/live-detail`)) {
                        captured.liveDetail = await response.json();
                        maybeDone();
                    } else if (url.includes(`/channels/${channelId}/videos`)) {
                        captured.videos ??= await response.json();
                        maybeDone();
                    }
                } catch {
                    // Non-JSON response (e.g. a redirect/asset) — ignore.
                }
            });

            // Fire-and-forget: navigation keeps running in the background,
            // but completion is driven by maybeDone() above, not by this.
            page.goto(`https://chzzk.naver.com/live/${channelId}`, { timeout: CAPTURE_TIMEOUT_MS }).catch(() => {});

            setTimeout(() => {
                settled = true;
                resolve();
            }, CAPTURE_TIMEOUT_MS);
        });
    } finally {
        // Safe to close mid-navigation — we already have what we need (or
        // hit the timeout), so the rest of the page's load is just wasted
        // work at that point.
        await context.close();
    }

    return captured;
}

/** 라이브 중이면 라이브 정보를, 아니면 가장 최근 다시보기 정보를 반환. 둘 다 없으면 null. */
export async function captureBroadcastStatus(channelId: string): Promise<BroadcastStatus | null> {
    const { liveDetail, videos } = await captureChannelPage(channelId);

    const live = liveDetail?.content;
    if (live?.status === "OPEN") {
        return {
            title: live.liveTitle,
            date: live.openDate,
            url: `https://chzzk.naver.com/live/${channelId}`,
            isLive: true
        };
    }

    const latestVideo = videos?.content?.data?.[0];
    if (latestVideo) {
        return {
            title: latestVideo.videoTitle,
            date: latestVideo.publishDate,
            url: `https://chzzk.naver.com/video/${latestVideo.videoNo}`,
            isLive: false
        };
    }

    return null;
}

export async function closeBrowser(): Promise<void> {
    if (!browserPromise) return;
    const browser = await browserPromise;
    browserPromise = null;
    await browser.close();
}

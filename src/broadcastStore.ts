export interface BroadcastStatus {
    title: string;
    date: string;
    url: string;
    isLive: boolean;
}

const store = new Map<string, BroadcastStatus>();
let lastUpdatedAt: string | null = null;

export function setBroadcastStatus(streamerName: string, status: BroadcastStatus): void {
    store.set(streamerName, status);
}

export function clearBroadcastStatus(streamerName: string): void {
    store.delete(streamerName);
}

export function getBroadcastStatus(streamerName: string): BroadcastStatus | null {
    return store.get(streamerName) ?? null;
}

export function markCycleComplete(): void {
    lastUpdatedAt = new Date().toISOString();
}

export function getLastUpdatedAt(): string | null {
    return lastUpdatedAt;
}

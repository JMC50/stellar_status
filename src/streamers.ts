export interface StreamerConfig {
    name: string;
    channelId: string;
}

// chzzk channel id per stellar — must stay in sync with
// stelinfo/frontend/src/lib/data/stellars.ts's links.chzzk URLs.
export const STREAMERS: StreamerConfig[] = [
    { name: "Gangzi", channelId: "b5ed5db484d04faf4d150aedd362f34b" },
    { name: "Ayatsuno_yuni", channelId: "45e71a76e949e16a34764deb962f9d9f" },
    { name: "Sakihane_huya", channelId: "36ddb9bb4f17593b60f1b63cec86611d" },
    { name: "Shirayuki_hina", channelId: "b044e3a3b9259246bc92e863e7d3f3b8" },
    { name: "Neneko_mashiro", channelId: "4515b179f86b67b4981e16190817c580" },
    { name: "Akane_lize", channelId: "4325b1d5bbc321fad3042306646e2e50" },
    { name: "Arahashi_tabi", channelId: "a6c4ddb09cdb160478996007bff35296" },
    { name: "Tenko_shibuki", channelId: "64d76089fba26b180d9c9e48a32600d9" },
    { name: "Aokumo_rin", channelId: "516937b5f85cbf2249ce31b0ad046b0f" },
    { name: "Hanako_nana", channelId: "4d812b586ff63f8a2946e64fa860bbf5" },
    { name: "Yuzuha_riko", channelId: "8fd39bb8de623317de90654718638b10" }
];

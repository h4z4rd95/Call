import { createP2PLiteServer } from "./src/server.js";

function resolveIceServers() {
  if (process.env.ICE_SERVERS) {
    return JSON.parse(process.env.ICE_SERVERS);
  }

  if (
    process.env.TURN_URL &&
    process.env.TURN_USERNAME &&
    process.env.TURN_PASSWORD
  ) {
    return [
      { urls: ["stun:stun.l.google.com:19302"] },
      {
        urls: [process.env.TURN_URL],
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_PASSWORD,
      },
    ];
  }

  return [{ urls: ["stun:stun.l.google.com:19302"] }];
}

const port = Number(process.env.PORT ?? 3030);
const app = createP2PLiteServer({
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
  iceServers: resolveIceServers(),
});

await app.start(port);

console.log(`P2P Lite server running at ${app.url}`);

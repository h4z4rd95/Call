# P2P Lite Call

A tiny self-hosted 1:1 video call app that uses:

- Node.js HTTP server
- WebSocket signaling
- Browser WebRTC
- In-memory temporary rooms

It is designed to be copied into a separate repository and deployed on a Linux VPS or any Node.js host.

## Features

- 1:1 video calls
- Link-only rooms
- Optional temporary password per room
- No database
- No login
- No build step
- TURN/STUN support through environment variables

## Run locally

```bash
cd apps/p2p-lite
pnpm install
pnpm start
```

Open:

- `http://localhost:3030`

## Development mode

```bash
cd apps/p2p-lite
pnpm dev
```

## Tests

```bash
cd apps/p2p-lite
pnpm test
```

## Environment variables

- `PORT`
  - HTTP port
  - Default: `3030`

- `PUBLIC_BASE_URL`
  - Public URL used to generate share links
  - Example: `https://call.example.com`

- `ICE_SERVERS`
  - Optional JSON array of ICE server definitions
  - Example:

```bash
export ICE_SERVERS='[
  {"urls":["stun:stun.l.google.com:19302"]},
  {
    "urls":["turn:turn.example.com:3478"],
    "username":"my-user",
    "credential":"my-password"
  }
]'
```

- `TURN_URL`, `TURN_USERNAME`, `TURN_PASSWORD`
  - Optional shortcut for one TURN server
  - If `ICE_SERVERS` is set, it wins

## Deploy on Linux VPS

1. Install Node.js 20+
2. Copy this folder to your server
3. Install dependencies
4. Set `PUBLIC_BASE_URL`
5. Start behind Nginx or Caddy

Example:

```bash
cd /opt/p2p-lite
pnpm install --prod=false
PUBLIC_BASE_URL=https://call.example.com PORT=3030 pnpm start
```

## Reverse proxy example

For Nginx, make sure websocket upgrades are enabled for `/ws`.

```nginx
server {
  listen 80;
  server_name call.example.com;

  location / {
    proxy_pass http://127.0.0.1:3030;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

## Important production note

Without a TURN server, some users behind strict NAT/firewall setups may fail to connect.

For reliable public internet usage, add a TURN server such as `coturn`.

## Project files

- `server.js`
  - App entrypoint
- `src/room-store.js`
  - In-memory room rules
- `src/server.js`
  - HTTP + WebSocket signaling server
- `public/index.html`
  - UI shell
- `public/app.js`
  - Browser WebRTC logic
- `public/styles.css`
  - UI styles
- `test/*.test.js`
  - Node test suite

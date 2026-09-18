import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WebSocketServer } from "ws";

import { createRoomStore } from "./room-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function safePublicPath(urlPathname) {
  const requestedPath = urlPathname === "/" ? "/index.html" : urlPathname;
  const resolvedPath = path.resolve(publicDir, `.${requestedPath}`);
  if (!resolvedPath.startsWith(publicDir)) {
    return null;
  }
  return resolvedPath;
}

export function createP2PLiteServer(options = {}) {
  const roomStore = options.roomStore ?? createRoomStore();
  const iceServers = options.iceServers ?? [{ urls: ["stun:stun.l.google.com:19302"] }];
  const publicBaseUrl = options.publicBaseUrl ?? null;
  const peerSockets = new Map();
  const socketMeta = new Map();
  const roomSockets = new Map();

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && requestUrl.pathname === "/health") {
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "GET" && requestUrl.pathname.startsWith("/api/rooms/")) {
      const roomId = requestUrl.pathname.split("/").at(-1);
      const room = roomStore.getRoom(roomId);

      if (!room) {
        return sendJson(response, 404, {
          ok: false,
          code: "ROOM_NOT_FOUND",
          message: "Room not found.",
        });
      }

      return sendJson(response, 200, {
        ok: true,
        roomId: room.id,
        requirePassword: room.requirePassword,
        participantCount: room.participants.length,
      });
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/rooms") {
      const payload = await readJson(request);
      const room = roomStore.createRoom({
        requirePassword: payload.requirePassword !== false,
      });
      const baseUrl =
        currentUrl ?? publicBaseUrl ?? `http://127.0.0.1:${server.address().port}`;

      return sendJson(response, 201, {
        roomId: room.id,
        password: room.password,
        requirePassword: room.requirePassword,
        joinUrl: `${baseUrl}/#room=${room.id}`,
        iceServers,
      });
    }

    const filePath = safePublicPath(requestUrl.pathname);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const extension = path.extname(filePath);
    response.writeHead(200, {
      "content-type": contentTypes[extension] ?? "application/octet-stream",
    });
    fs.createReadStream(filePath).pipe(response);
  });

  const wss = new WebSocketServer({ noServer: true });
  let currentUrl = null;

  function getPeerInRoom(roomId, excludePeerId) {
    const sockets = roomSockets.get(roomId) ?? new Set();
    for (const socket of sockets) {
      const meta = socketMeta.get(socket);
      if (meta && meta.peerId !== excludePeerId) {
        return meta;
      }
    }
    return null;
  }

  function removeSocket(socket) {
    const meta = socketMeta.get(socket);
    if (!meta) {
      return;
    }

    socketMeta.delete(socket);
    peerSockets.delete(meta.peerId);
    roomStore.leaveRoom({ roomId: meta.roomId, peerId: meta.peerId });

    const sockets = roomSockets.get(meta.roomId);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        roomSockets.delete(meta.roomId);
      }
    }

    const peer = getPeerInRoom(meta.roomId, meta.peerId);
    if (peer) {
      peer.socket.send(
        JSON.stringify({
          type: "peer-left",
          peerId: meta.peerId,
        })
      );
    }
  }

  wss.on("connection", (socket) => {
    socket.on("message", (rawMessage) => {
      let message;
      try {
        message = JSON.parse(String(rawMessage));
      } catch {
        socket.send(
          JSON.stringify({
            type: "error",
            code: "BAD_MESSAGE",
            message: "Message must be valid JSON.",
          })
        );
        return;
      }

      if (message.type === "join-room") {
        const joinResult = roomStore.joinRoom({
          roomId: message.roomId,
          password: message.password ?? "",
          peerId: message.peerId,
        });

        if (!joinResult.ok) {
          socket.send(JSON.stringify({ type: "error", ...joinResult }));
          return;
        }

        const meta = {
          roomId: message.roomId,
          peerId: message.peerId,
          socket,
        };

        socketMeta.set(socket, meta);
        peerSockets.set(message.peerId, socket);

        if (!roomSockets.has(message.roomId)) {
          roomSockets.set(message.roomId, new Set());
        }
        roomSockets.get(message.roomId).add(socket);

        socket.send(
          JSON.stringify({
            type: "joined-room",
            role: joinResult.role,
            roomId: message.roomId,
            iceServers,
          })
        );

        const peer = getPeerInRoom(message.roomId, message.peerId);
        if (peer) {
          peer.socket.send(
            JSON.stringify({
              type: "peer-ready",
              shouldCreateOffer: true,
              peerId: message.peerId,
            })
          );

          socket.send(
            JSON.stringify({
              type: "peer-ready",
              shouldCreateOffer: false,
              peerId: peer.peerId,
            })
          );
        }

        return;
      }

      if (message.type === "signal") {
        const senderMeta = socketMeta.get(socket);
        if (!senderMeta) {
          socket.send(
            JSON.stringify({
              type: "error",
              code: "NOT_JOINED",
              message: "Join a room before signaling.",
            })
          );
          return;
        }

        const peer = getPeerInRoom(senderMeta.roomId, senderMeta.peerId);
        if (!peer) {
          return;
        }

        peer.socket.send(
          JSON.stringify({
            type: "signal",
            fromPeerId: senderMeta.peerId,
            payload: message.payload,
          })
        );
      }
    });

    socket.on("close", () => {
      removeSocket(socket);
    });
  });

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (upgradedSocket) => {
      wss.emit("connection", upgradedSocket, request);
    });
  });

  return {
    async start(port = 0) {
      await new Promise((resolve) => {
        server.listen(port, "127.0.0.1", resolve);
      });
      const address = server.address();
      currentUrl = `http://127.0.0.1:${address.port}`;
    },
    async stop() {
      for (const socket of [...peerSockets.values()]) {
        socket.terminate();
      }
      await new Promise((resolve) => {
        wss.close(() => resolve());
      });
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    get url() {
      return currentUrl;
    },
    get wsUrl() {
      return currentUrl ? currentUrl.replace("http", "ws") + "/ws" : null;
    },
  };
}

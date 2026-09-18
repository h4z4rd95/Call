import test from "node:test";
import assert from "node:assert/strict";

import { WebSocket } from "ws";

import { createP2PLiteServer } from "../src/server.js";

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForMessage(socket) {
  return new Promise((resolve, reject) => {
    socket.once("message", (value) => {
      resolve(JSON.parse(String(value)));
    });
    socket.once("error", reject);
  });
}

function createMessageQueue(socket) {
  const pending = [];
  const buffered = [];

  socket.on("message", (value) => {
    const parsed = JSON.parse(String(value));
    const resolve = pending.shift();
    if (resolve) {
      resolve(parsed);
      return;
    }
    buffered.push(parsed);
  });

  socket.on("error", (error) => {
    const resolve = pending.shift();
    if (resolve) {
      resolve(Promise.reject(error));
    }
  });

  return {
    next() {
      if (buffered.length > 0) {
        return Promise.resolve(buffered.shift());
      }
      return new Promise((resolve) => {
        pending.push(resolve);
      });
    },
  };
}

function waitForClose(socket) {
  return new Promise((resolve) => {
    socket.once("close", resolve);
  });
}

test("creates rooms over HTTP and returns a shareable join URL", async () => {
  const app = createP2PLiteServer({
    publicBaseUrl: "http://127.0.0.1",
    iceServers: [{ urls: ["stun:stun.example.com:3478"] }],
  });

  await app.start(0);

  try {
    const response = await fetch(`${app.url}/api/rooms`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ requirePassword: false }),
    });

    assert.equal(response.status, 201);
    const body = await response.json();

    assert.equal(typeof body.roomId, "string");
    assert.equal(body.password, null);
    assert.equal(body.requirePassword, false);
    assert.equal(body.joinUrl, `${app.url}/#room=${body.roomId}`);
    assert.deepEqual(body.iceServers, [{ urls: ["stun:stun.example.com:3478"] }]);
  } finally {
    await app.stop();
  }
});

test("joins a room over websocket and forwards signaling messages", async () => {
  const app = createP2PLiteServer({
    publicBaseUrl: "http://127.0.0.1",
    iceServers: [{ urls: ["stun:stun.example.com:3478"] }],
  });

  await app.start(0);

  try {
    const createRoomResponse = await fetch(`${app.url}/api/rooms`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ requirePassword: true }),
    });
    const room = await createRoomResponse.json();

    const hostSocket = new WebSocket(app.wsUrl);
    const guestSocket = new WebSocket(app.wsUrl);

    await Promise.all([waitForOpen(hostSocket), waitForOpen(guestSocket)]);

    const hostMessages = createMessageQueue(hostSocket);
    const guestMessages = createMessageQueue(guestSocket);

    hostSocket.send(
      JSON.stringify({
        type: "join-room",
        roomId: room.roomId,
        password: room.password,
        peerId: "host-peer",
      })
    );
    const hostJoinAck = await hostMessages.next();
    assert.equal(hostJoinAck.type, "joined-room");
    assert.equal(hostJoinAck.role, "host");

    guestSocket.send(
      JSON.stringify({
        type: "join-room",
        roomId: room.roomId,
        password: room.password,
        peerId: "guest-peer",
      })
    );

    const guestJoinAck = await guestMessages.next();
    const hostPeerReady = await hostMessages.next();
    const guestPeerReady = await guestMessages.next();

    assert.equal(guestJoinAck.type, "joined-room");
    assert.equal(guestJoinAck.role, "guest");
    assert.deepEqual(hostPeerReady, {
      type: "peer-ready",
      shouldCreateOffer: true,
      peerId: "guest-peer",
    });
    assert.deepEqual(guestPeerReady, {
      type: "peer-ready",
      shouldCreateOffer: false,
      peerId: "host-peer",
    });

    hostSocket.send(
      JSON.stringify({
        type: "signal",
        roomId: room.roomId,
        payload: {
          kind: "offer",
          sdp: "fake-sdp",
        },
      })
    );

    const forwardedSignal = await guestMessages.next();
    assert.deepEqual(forwardedSignal, {
      type: "signal",
      fromPeerId: "host-peer",
      payload: {
        kind: "offer",
        sdp: "fake-sdp",
      },
    });

    const hostClosed = waitForClose(hostSocket);
    const guestClosed = waitForClose(guestSocket);
    hostSocket.close();
    guestSocket.close();
    await Promise.all([hostClosed, guestClosed]);
  } finally {
    await app.stop();
  }
});

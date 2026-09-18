import test from "node:test";
import assert from "node:assert/strict";

import { createRoomStore } from "../src/room-store.js";

test("creates a room with a generated id and temporary password", () => {
  const store = createRoomStore({
    createRoomId: () => "room123",
    createPassword: () => "654321",
  });

  const room = store.createRoom();

  assert.deepEqual(room, {
    id: "room123",
    password: "654321",
    requirePassword: true,
    createdAt: room.createdAt,
    participants: [],
  });
  assert.ok(room.createdAt);
});

test("creates a link-only room when password protection is disabled", () => {
  const store = createRoomStore({
    createRoomId: () => "room123",
    createPassword: () => "654321",
  });

  const room = store.createRoom({ requirePassword: false });
  const join = store.joinRoom({
    roomId: room.id,
    password: "",
    peerId: "peer-a",
  });

  assert.equal(room.password, null);
  assert.equal(join.ok, true);
  assert.equal(join.role, "host");
});

test("allows two participants with the correct password", () => {
  const store = createRoomStore({
    createRoomId: () => "room123",
    createPassword: () => "654321",
  });

  const room = store.createRoom();
  const firstJoin = store.joinRoom({
    roomId: room.id,
    password: room.password,
    peerId: "peer-a",
  });
  const secondJoin = store.joinRoom({
    roomId: room.id,
    password: room.password,
    peerId: "peer-b",
  });

  assert.equal(firstJoin.ok, true);
  assert.equal(firstJoin.role, "host");
  assert.equal(secondJoin.ok, true);
  assert.equal(secondJoin.role, "guest");
  assert.equal(store.getRoom(room.id).participants.length, 2);
});

test("rejects a participant with the wrong password", () => {
  const store = createRoomStore({
    createRoomId: () => "room123",
    createPassword: () => "654321",
  });

  const room = store.createRoom();
  const join = store.joinRoom({
    roomId: room.id,
    password: "000000",
    peerId: "peer-a",
  });

  assert.deepEqual(join, {
    ok: false,
    code: "INVALID_PASSWORD",
    message: "Invalid room password.",
  });
});

test("rejects a third participant when the room is full", () => {
  const store = createRoomStore({
    createRoomId: () => "room123",
    createPassword: () => "654321",
  });

  const room = store.createRoom();
  store.joinRoom({ roomId: room.id, password: room.password, peerId: "peer-a" });
  store.joinRoom({ roomId: room.id, password: room.password, peerId: "peer-b" });

  const thirdJoin = store.joinRoom({
    roomId: room.id,
    password: room.password,
    peerId: "peer-c",
  });

  assert.deepEqual(thirdJoin, {
    ok: false,
    code: "ROOM_FULL",
    message: "Room already has two participants.",
  });
});

test("removes a participant and deletes the room when empty", () => {
  const store = createRoomStore({
    createRoomId: () => "room123",
    createPassword: () => "654321",
  });

  const room = store.createRoom();
  store.joinRoom({ roomId: room.id, password: room.password, peerId: "peer-a" });

  const firstLeave = store.leaveRoom({ roomId: room.id, peerId: "peer-a" });

  assert.deepEqual(firstLeave, {
    ok: true,
    removed: true,
    roomDeleted: true,
  });
  assert.equal(store.getRoom(room.id), null);
});

import crypto from "node:crypto";

function defaultRoomId() {
  return crypto.randomBytes(4).toString("hex");
}

function defaultPassword() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function createRoomStore(options = {}) {
  const rooms = new Map();
  const createRoomId = options.createRoomId ?? defaultRoomId;
  const createPassword = options.createPassword ?? defaultPassword;

  function createRoom({ requirePassword = true } = {}) {
    const room = {
      id: createRoomId(),
      password: requirePassword ? createPassword() : null,
      requirePassword,
      createdAt: new Date().toISOString(),
      participants: [],
    };

    rooms.set(room.id, room);
    return structuredClone(room);
  }

  function getRoom(roomId) {
    const room = rooms.get(roomId);
    return room ? structuredClone(room) : null;
  }

  function joinRoom({ roomId, password, peerId }) {
    const room = rooms.get(roomId);

    if (!room) {
      return {
        ok: false,
        code: "ROOM_NOT_FOUND",
        message: "Room not found.",
      };
    }

    if (room.requirePassword && room.password !== password) {
      return {
        ok: false,
        code: "INVALID_PASSWORD",
        message: "Invalid room password.",
      };
    }

    if (room.participants.length >= 2) {
      return {
        ok: false,
        code: "ROOM_FULL",
        message: "Room already has two participants.",
      };
    }

    if (!room.participants.includes(peerId)) {
      room.participants.push(peerId);
    }

    return {
      ok: true,
      role: room.participants.length === 1 ? "host" : "guest",
      room: structuredClone(room),
    };
  }

  function leaveRoom({ roomId, peerId }) {
    const room = rooms.get(roomId);

    if (!room) {
      return {
        ok: true,
        removed: false,
        roomDeleted: false,
      };
    }

    const before = room.participants.length;
    room.participants = room.participants.filter((participant) => participant !== peerId);
    const removed = room.participants.length !== before;

    if (room.participants.length === 0) {
      rooms.delete(roomId);
      return {
        ok: true,
        removed,
        roomDeleted: true,
      };
    }

    return {
      ok: true,
      removed,
      roomDeleted: false,
    };
  }

  return {
    createRoom,
    getRoom,
    joinRoom,
    leaveRoom,
  };
}

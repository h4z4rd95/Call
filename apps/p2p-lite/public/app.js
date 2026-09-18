const state = {
  roomId: "",
  requirePassword: true,
  joinUrl: "",
  createdPassword: "",
  ws: null,
  peerConnection: null,
  localStream: null,
  remoteStream: null,
  peerId: crypto.randomUUID(),
  iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
};

const elements = {
  connectionStatus: document.querySelector("#connectionStatus"),
  roomStatus: document.querySelector("#roomStatus"),
  requirePassword: document.querySelector("#requirePassword"),
  createRoomButton: document.querySelector("#createRoomButton"),
  createdRoomPanel: document.querySelector("#createdRoomPanel"),
  shareLink: document.querySelector("#shareLink"),
  roomIdValue: document.querySelector("#roomIdValue"),
  roomPasswordValue: document.querySelector("#roomPasswordValue"),
  roomIdInput: document.querySelector("#roomIdInput"),
  roomPasswordInput: document.querySelector("#roomPasswordInput"),
  loadRoomButton: document.querySelector("#loadRoomButton"),
  joinRoomButton: document.querySelector("#joinRoomButton"),
  roomPanel: document.querySelector("#roomPanel"),
  roomMeta: document.querySelector("#roomMeta"),
  copyLinkButton: document.querySelector("#copyLinkButton"),
  leaveButton: document.querySelector("#leaveButton"),
  toggleAudioButton: document.querySelector("#toggleAudioButton"),
  toggleVideoButton: document.querySelector("#toggleVideoButton"),
  localVideo: document.querySelector("#localVideo"),
  remoteVideo: document.querySelector("#remoteVideo"),
  eventLog: document.querySelector("#eventLog"),
};

function appendLog(message) {
  const now = new Date().toLocaleTimeString();
  elements.eventLog.textContent = `[${now}] ${message}\n${elements.eventLog.textContent}`;
}

function setConnectionStatus(value) {
  elements.connectionStatus.textContent = value;
}

function setRoomStatus(value) {
  elements.roomStatus.textContent = value;
}

function setRoomMeta() {
  if (!state.roomId) {
    elements.roomMeta.textContent = "No room loaded.";
    return;
  }

  elements.roomMeta.textContent = state.requirePassword
    ? `Room ${state.roomId} requires a temporary password.`
    : `Room ${state.roomId} is link-only.`;
}

function getRoomHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return params.get("room");
}

function updateRoomHash(roomId) {
  const params = new URLSearchParams();
  params.set("room", roomId);
  window.location.hash = params.toString();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.message || "Request failed.");
  }

  return body;
}

async function loadRoom(roomId, options = {}) {
  if (!roomId) {
    throw new Error("Room ID is required.");
  }

  const room = await fetchJson(`/api/rooms/${roomId}`);
  state.roomId = room.roomId;
  state.requirePassword = room.requirePassword;
  state.joinUrl = `${window.location.origin}/#room=${room.roomId}`;
  state.createdPassword = options.createdPassword ?? state.createdPassword ?? "";

  elements.roomIdInput.value = room.roomId;
  if (options.password !== undefined) {
    elements.roomPasswordInput.value = options.password;
  }

  elements.roomPanel.classList.remove("hidden");
  setRoomMeta();
  setConnectionStatus("Room loaded");
  setRoomStatus("Ready to join the call.");
  updateRoomHash(room.roomId);
  appendLog(`Loaded room ${room.roomId}.`);
}

async function createRoom() {
  setConnectionStatus("Creating room...");

  try {
    const room = await fetchJson("/api/rooms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        requirePassword: elements.requirePassword.checked,
      }),
    });

    elements.createdRoomPanel.classList.remove("hidden");
    elements.shareLink.textContent = room.joinUrl;
    elements.roomIdValue.textContent = room.roomId;
    elements.roomPasswordValue.textContent = room.password ?? "Not required";
    state.createdPassword = room.password ?? "";
    state.iceServers = room.iceServers ?? state.iceServers;

    await loadRoom(room.roomId, {
      password: room.password ?? "",
      createdPassword: room.password ?? "",
    });

    setRoomStatus("Room created. Joining your call...");
    await joinCurrentRoom();
  } catch (error) {
    setConnectionStatus("Create room failed");
    setRoomStatus(error.message);
    appendLog(`Create room failed: ${error.message}`);
  }
}

async function ensureLocalMedia() {
  if (state.localStream) {
    return state.localStream;
  }

  state.localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: true,
  });
  elements.localVideo.srcObject = state.localStream;
  appendLog("Local media acquired.");
  return state.localStream;
}

function getSocketUrl() {
  return `${window.location.origin.replace(/^http/, "ws")}/ws`;
}

function closePeerConnection() {
  if (state.peerConnection) {
    state.peerConnection.onicecandidate = null;
    state.peerConnection.ontrack = null;
    state.peerConnection.onconnectionstatechange = null;
    state.peerConnection.close();
    state.peerConnection = null;
  }

  state.remoteStream = null;
  elements.remoteVideo.srcObject = null;
}

function createPeerConnection() {
  if (state.peerConnection) {
    return state.peerConnection;
  }

  const connection = new RTCPeerConnection({
    iceServers: state.iceServers,
  });

  state.remoteStream = new MediaStream();
  elements.remoteVideo.srcObject = state.remoteStream;

  for (const track of state.localStream.getTracks()) {
    connection.addTrack(track, state.localStream);
  }

  connection.ontrack = (event) => {
    for (const track of event.streams[0].getTracks()) {
      state.remoteStream.addTrack(track);
    }
    setRoomStatus("Remote participant connected.");
    appendLog("Remote tracks received.");
  };

  connection.onicecandidate = (event) => {
    if (!event.candidate || !state.ws) {
      return;
    }

    state.ws.send(
      JSON.stringify({
        type: "signal",
        roomId: state.roomId,
        payload: {
          kind: "candidate",
          candidate: event.candidate.toJSON(),
        },
      })
    );
  };

  connection.onconnectionstatechange = () => {
    setConnectionStatus(`WebRTC ${connection.connectionState}`);
    appendLog(`Peer connection state: ${connection.connectionState}`);
  };

  state.peerConnection = connection;
  return connection;
}

async function createOffer() {
  const connection = createPeerConnection();
  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);

  state.ws.send(
    JSON.stringify({
      type: "signal",
      roomId: state.roomId,
      payload: {
        kind: "offer",
        sdp: offer.sdp,
      },
    })
  );

  appendLog("Offer sent to remote participant.");
}

async function handleSignal(payload) {
  const connection = createPeerConnection();

  if (payload.kind === "offer") {
    await connection.setRemoteDescription({
      type: "offer",
      sdp: payload.sdp,
    });
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    state.ws.send(
      JSON.stringify({
        type: "signal",
        roomId: state.roomId,
        payload: {
          kind: "answer",
          sdp: answer.sdp,
        },
      })
    );
    appendLog("Received offer and sent answer.");
    return;
  }

  if (payload.kind === "answer") {
    await connection.setRemoteDescription({
      type: "answer",
      sdp: payload.sdp,
    });
    appendLog("Remote answer applied.");
    return;
  }

  if (payload.kind === "candidate" && payload.candidate) {
    await connection.addIceCandidate(payload.candidate);
    appendLog("Remote ICE candidate applied.");
  }
}

function cleanupSocket() {
  if (!state.ws) {
    return;
  }

  state.ws.onopen = null;
  state.ws.onmessage = null;
  state.ws.onclose = null;
  state.ws.onerror = null;
  state.ws.close();
  state.ws = null;
}

async function connectSocket() {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    return state.ws;
  }

  const socket = new WebSocket(getSocketUrl());

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket connection failed.")), {
      once: true,
    });
  });

  socket.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "joined-room") {
      state.iceServers = message.iceServers ?? state.iceServers;
      createPeerConnection();
      setConnectionStatus("Joined signaling room");
      setRoomStatus("Waiting for the other participant.");
      appendLog(`Joined room ${message.roomId} as ${message.role}.`);
      return;
    }

    if (message.type === "peer-ready") {
      setRoomStatus("Peer is ready. Connecting...");
      appendLog(`Peer ${message.peerId} is ready.`);
      if (message.shouldCreateOffer) {
        await createOffer();
      }
      return;
    }

    if (message.type === "signal") {
      await handleSignal(message.payload);
      return;
    }

    if (message.type === "peer-left") {
      closePeerConnection();
      setRoomStatus("Peer left the room.");
      appendLog(`Peer ${message.peerId} left.`);
      return;
    }

    if (message.type === "error") {
      setConnectionStatus("Join failed");
      setRoomStatus(message.message);
      appendLog(`Server error: ${message.message}`);
    }
  });

  socket.addEventListener("close", () => {
    if (state.ws === socket) {
      state.ws = null;
    }
    appendLog("WebSocket disconnected.");
  });

  socket.addEventListener("error", () => {
    appendLog("WebSocket error.");
  });

  state.ws = socket;
  return socket;
}

async function joinCurrentRoom() {
  try {
    if (!state.roomId) {
      const roomId = elements.roomIdInput.value.trim();
      await loadRoom(roomId);
    }

    await ensureLocalMedia();
    const socket = await connectSocket();
    const password = elements.roomPasswordInput.value.trim() || state.createdPassword || "";

    socket.send(
      JSON.stringify({
        type: "join-room",
        roomId: state.roomId,
        password,
        peerId: state.peerId,
      })
    );

    setConnectionStatus("Joining room...");
    setRoomStatus("Connecting to signaling server...");
  } catch (error) {
    setConnectionStatus("Join failed");
    setRoomStatus(error.message);
    appendLog(`Join failed: ${error.message}`);
  }
}

function leaveRoom() {
  cleanupSocket();
  closePeerConnection();

  if (state.localStream) {
    for (const track of state.localStream.getTracks()) {
      track.stop();
    }
    state.localStream = null;
  }

  elements.localVideo.srcObject = null;
  elements.remoteVideo.srcObject = null;
  setConnectionStatus("Left room");
  setRoomStatus("You left the room.");
  appendLog("Call ended.");
}

function toggleAudio() {
  if (!state.localStream) {
    return;
  }

  const track = state.localStream.getAudioTracks()[0];
  if (!track) {
    return;
  }

  track.enabled = !track.enabled;
  elements.toggleAudioButton.textContent = track.enabled
    ? "Mute microphone"
    : "Unmute microphone";
}

function toggleVideo() {
  if (!state.localStream) {
    return;
  }

  const track = state.localStream.getVideoTracks()[0];
  if (!track) {
    return;
  }

  track.enabled = !track.enabled;
  elements.toggleVideoButton.textContent = track.enabled
    ? "Turn camera off"
    : "Turn camera on";
}

async function copyLink() {
  if (!state.joinUrl) {
    return;
  }

  await navigator.clipboard.writeText(state.joinUrl);
  appendLog("Share link copied.");
  setRoomStatus("Share link copied to clipboard.");
}

async function loadRoomFromInput() {
  try {
    await loadRoom(elements.roomIdInput.value.trim(), {
      password: elements.roomPasswordInput.value.trim(),
    });
  } catch (error) {
    setConnectionStatus("Load room failed");
    setRoomStatus(error.message);
    appendLog(`Load room failed: ${error.message}`);
  }
}

elements.createRoomButton.addEventListener("click", createRoom);
elements.loadRoomButton.addEventListener("click", loadRoomFromInput);
elements.joinRoomButton.addEventListener("click", joinCurrentRoom);
elements.copyLinkButton.addEventListener("click", copyLink);
elements.leaveButton.addEventListener("click", leaveRoom);
elements.toggleAudioButton.addEventListener("click", toggleAudio);
elements.toggleVideoButton.addEventListener("click", toggleVideo);

window.addEventListener("hashchange", async () => {
  const roomId = getRoomHash();
  if (!roomId || roomId === state.roomId) {
    return;
  }

  try {
    await loadRoom(roomId);
  } catch (error) {
    appendLog(`Hash room load failed: ${error.message}`);
  }
});

window.addEventListener("beforeunload", () => {
  leaveRoom();
});

const initialRoomId = getRoomHash();
if (initialRoomId) {
  elements.roomIdInput.value = initialRoomId;
  loadRoom(initialRoomId).catch((error) => {
    appendLog(`Initial room load failed: ${error.message}`);
  });
}

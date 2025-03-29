// For interactive documentation and code auto-completion in editor
/** @typedef {import('pear-interface')} */

/* global Pear */
import Hyperswarm from "hyperswarm"; // Module for P2P networking and connecting peers
import crypto from "hypercore-crypto"; // Cryptographic functions for generating the key in app
import b4a from "b4a"; // Module for buffer-to-string and vice-versa conversions
const { teardown, updates } = Pear; // Functions for cleanup and updates

const swarm = new Hyperswarm();
let canvas, ctx;
let isDrawing = false;
let currentTool = "pen";
let currentColor = "#000000";
let lastX = 0;
let lastY = 0;

// Unannounce the public key before exiting the process
// (This is not a requirement, but it helps avoid DHT pollution)
teardown(() => swarm.destroy());

// Enable automatic reloading for the app
// This is optional but helpful during production
updates(() => Pear.reload());

// When there's a new connection, listen for new drawing data
swarm.on("connection", (peer) => {
  const name = b4a.toString(peer.remotePublicKey, "hex").substr(0, 6);
  peer.on("data", (data) => handleDrawingData(data));
  peer.on("error", (e) => console.log(`Connection error: ${e}`));
});

// When there's updates to the swarm, update the peers count
swarm.on("update", () => {
  document.querySelector("#peers-count").textContent = swarm.connections.size;
});

document
  .querySelector("#create-chat-room")
  .addEventListener("click", createDrawingBoard);
document
  .querySelector("#join-form")
  .addEventListener("submit", joinDrawingBoard);

// Tool selection
document.querySelectorAll(".tool-button").forEach((button) => {
  button.addEventListener("click", () => {
    document
      .querySelectorAll(".tool-button")
      .forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");
    currentTool = button.dataset.tool;
  });
});

// Color picker
document.querySelector("#color-picker").addEventListener("input", (e) => {
  currentColor = e.target.value;
});

async function createDrawingBoard() {
  const topicBuffer = crypto.randomBytes(32);
  joinSwarm(topicBuffer);
}

async function joinDrawingBoard(e) {
  e.preventDefault();
  const topicStr = document.querySelector("#join-chat-room-topic").value;
  const topicBuffer = b4a.from(topicStr, "hex");
  joinSwarm(topicBuffer);
}

async function joinSwarm(topicBuffer) {
  document.querySelector("#setup").classList.add("hidden");
  document.querySelector("#loading").classList.remove("hidden");

  const discovery = swarm.join(topicBuffer, { client: true, server: true });
  await discovery.flushed();

  const topic = b4a.toString(topicBuffer, "hex");
  document.querySelector("#chat-room-topic").innerText = topic;
  document.querySelector("#loading").classList.add("hidden");
  document.querySelector("#drawing-board").classList.remove("hidden");

  // Initialize canvas
  canvas = document.getElementById("canvas");
  ctx = canvas.getContext("2d");

  // Set canvas size to container size
  const container = document.getElementById("canvas-container");
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;

  // Set up drawing event listeners
  setupDrawingEvents();
}

function setupDrawingEvents() {
  canvas.addEventListener("mousedown", startDrawing);
  canvas.addEventListener("mousemove", draw);
  canvas.addEventListener("mouseup", stopDrawing);
  canvas.addEventListener("mouseout", stopDrawing);
}

function startDrawing(e) {
  isDrawing = true;
  [lastX, lastY] = getCanvasCoordinates(e);
}

function draw(e) {
  if (!isDrawing) return;

  const [currentX, currentY] = getCanvasCoordinates(e);

  // Draw locally
  drawLine(lastX, lastY, currentX, currentY);

  // Send drawing data to peers
  const drawingData = {
    type: "draw",
    tool: currentTool,
    color: currentColor,
    fromX: lastX,
    fromY: lastY,
    toX: currentX,
    toY: currentY,
  };

  const peers = [...swarm.connections];
  for (const peer of peers) {
    peer.write(JSON.stringify(drawingData));
  }

  [lastX, lastY] = [currentX, currentY];
}

function stopDrawing() {
  isDrawing = false;
}

function getCanvasCoordinates(e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  return [x, y];
}

function drawLine(fromX, fromY, toX, toY) {
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);

  if (currentTool === "eraser") {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 20;
  } else {
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = 2;
  }

  ctx.lineCap = "round";
  ctx.stroke();
}

function handleDrawingData(data) {
  try {
    const drawingData = JSON.parse(data.toString());

    if (drawingData.type === "draw") {
      drawLine(
        drawingData.fromX,
        drawingData.fromY,
        drawingData.toX,
        drawingData.toY
      );
    }
  } catch (e) {
    console.error("Error handling drawing data:", e);
  }
}

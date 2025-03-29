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

// Game state
let gameState = {
  currentDrawer: null,
  currentWord: null,
  guesses: new Map(),
  scores: new Map(),
  roundTime: 60, // seconds per round
  timeLeft: 60,
  isDrawing: false,
  roundInProgress: false,
};

// Word list for the game
const words = [
  "cat",
  "dog",
  "house",
  "tree",
  "car",
  "bicycle",
  "computer",
  "phone",
  "book",
  "chair",
  "table",
  "window",
  "door",
  "flower",
  "bird",
  "fish",
  "sun",
  "moon",
  "star",
  "cloud",
  "rain",
  "snow",
  "mountain",
  "river",
  "beach",
  "ocean",
  "forest",
  "desert",
  "city",
  "bridge",
  "train",
  "plane",
];

// Unannounce the public key before exiting the process
// (This is not a requirement, but it helps avoid DHT pollution)
teardown(() => swarm.destroy());

// Enable automatic reloading for the app
// This is optional but helpful during production
updates(() => Pear.reload());

// When there's a new connection, listen for new game data
swarm.on("connection", (peer) => {
  const name = b4a.toString(peer.remotePublicKey, "hex").substr(0, 6);
  peer.on("data", (data) => handleGameData(data));
  peer.on("error", (e) => console.log(`Connection error: ${e}`));
});

// When there's updates to the swarm, update the peers count
swarm.on("update", () => {
  document.querySelector("#peers-count").textContent = swarm.connections.size;
});

document
  .querySelector("#create-chat-room")
  .addEventListener("click", createGameRoom);
document.querySelector("#join-form").addEventListener("submit", joinGameRoom);
document.querySelector("#submit-guess").addEventListener("click", submitGuess);

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

async function createGameRoom() {
  const topicBuffer = crypto.randomBytes(32);
  joinSwarm(topicBuffer);
}

async function joinGameRoom(e) {
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
  document.querySelector("#game-board").classList.remove("hidden");

  // Initialize canvas
  canvas = document.getElementById("canvas");
  ctx = canvas.getContext("2d");

  // Set canvas size to container size
  const container = document.getElementById("canvas-container");
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;

  // Set up drawing event listeners
  setupDrawingEvents();

  // Initialize game state
  initializeGame();
}

function initializeGame() {
  const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);
  gameState.scores.set(myId, 0);
  updateScoresDisplay();

  // Start the game if we're the first player
  if (swarm.connections.size === 0) {
    startNewRound();
  }
}

function startNewRound() {
  gameState.roundInProgress = true;
  gameState.guesses.clear();
  gameState.timeLeft = gameState.roundTime;

  // Select random drawer
  const players = Array.from(swarm.connections).map((peer) =>
    b4a.toString(peer.remotePublicKey, "hex").substr(0, 6)
  );
  players.push(b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6));

  gameState.currentDrawer = players[Math.floor(Math.random() * players.length)];
  gameState.currentWord = words[Math.floor(Math.random() * words.length)];

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Update UI
  updateGameState();

  // Start timer
  startTimer();

  // Send game state to all players
  broadcastGameState();
}

function startTimer() {
  const timerElement = document.querySelector("#timer");
  const timer = setInterval(() => {
    if (!gameState.roundInProgress) {
      clearInterval(timer);
      return;
    }

    gameState.timeLeft--;
    timerElement.textContent = `Time left: ${gameState.timeLeft}s`;

    if (gameState.timeLeft <= 0) {
      endRound();
    }
  }, 1000);
}

function endRound() {
  gameState.roundInProgress = false;
  document.querySelector("#timer").textContent = "Round ended!";

  // Show all guesses to the drawer
  if (
    gameState.currentDrawer ===
    b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6)
  ) {
    showGuessesToDrawer();
  }

  // Wait 5 seconds before starting next round
  setTimeout(startNewRound, 5000);
}

function showGuessesToDrawer() {
  const guessesList = document.querySelector("#guesses-list");
  guessesList.innerHTML = "";

  gameState.guesses.forEach((guess, playerId) => {
    const guessElement = document.createElement("div");
    guessElement.className = "guess-item";
    guessElement.innerHTML = `
      <span>${playerId}: ${guess}</span>
      <div>
        <button onclick="markGuess('${playerId}', true)">Correct</button>
        <button onclick="markGuess('${playerId}', false)">Incorrect</button>
      </div>
    `;
    guessesList.appendChild(guessElement);
  });
}

function markGuess(playerId, isCorrect) {
  if (!gameState.roundInProgress) {
    if (isCorrect) {
      // Add points
      const guesserScore = gameState.scores.get(playerId) || 0;
      const drawerScore = gameState.scores.get(gameState.currentDrawer) || 0;
      gameState.scores.set(playerId, guesserScore + 3);
      gameState.scores.set(gameState.currentDrawer, drawerScore + 1);

      // Mark guess as correct
      const guessElement = document.querySelector(
        `[data-player="${playerId}"]`
      );
      if (guessElement) {
        guessElement.classList.add("correct");
      }
    }
    updateScoresDisplay();
  }
}

function updateScoresDisplay() {
  const scoresElement = document.querySelector("#scores");
  scoresElement.innerHTML = "";

  gameState.scores.forEach((score, playerId) => {
    const scoreElement = document.createElement("div");
    scoreElement.className = "player-score";
    scoreElement.innerHTML = `<span>${playerId}: ${score}</span>`;
    scoresElement.appendChild(scoreElement);
  });
}

function updateGameState() {
  const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);
  const isDrawer = gameState.currentDrawer === myId;

  // Update word display
  const wordDisplay = document.querySelector("#word-display");
  if (isDrawer) {
    wordDisplay.textContent = `Draw this: ${gameState.currentWord}`;
  } else {
    wordDisplay.textContent = "Guess what's being drawn!";
  }

  // Update UI elements based on role
  document.querySelector("#tools").style.display = isDrawer ? "flex" : "none";
  document.querySelector("#guessing-area").style.display = isDrawer
    ? "none"
    : "flex";
}

function submitGuess() {
  if (gameState.roundInProgress) {
    const guessInput = document.querySelector("#guess-input");
    const guess = guessInput.value.trim().toLowerCase();

    if (guess) {
      const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);
      gameState.guesses.set(myId, guess);

      // Send guess to all players
      broadcastGameState();

      // Clear input
      guessInput.value = "";
    }
  }
}

function setupDrawingEvents() {
  canvas.addEventListener("mousedown", startDrawing);
  canvas.addEventListener("mousemove", draw);
  canvas.addEventListener("mouseup", stopDrawing);
  canvas.addEventListener("mouseout", stopDrawing);
}

function startDrawing(e) {
  if (
    gameState.currentDrawer ===
    b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6)
  ) {
    isDrawing = true;
    [lastX, lastY] = getCanvasCoordinates(e);
  }
}

function draw(e) {
  if (!isDrawing || !gameState.roundInProgress) return;

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

function handleGameData(data) {
  try {
    const gameData = JSON.parse(data.toString());

    switch (gameData.type) {
      case "draw":
        drawLine(gameData.fromX, gameData.fromY, gameData.toX, gameData.toY);
        break;
      case "gameState":
        // Update game state from received data
        gameState = { ...gameState, ...gameData.state };
        updateGameState();
        break;
      case "guess":
        // Update guesses from received data
        gameState.guesses.set(gameData.playerId, gameData.guess);
        break;
    }
  } catch (e) {
    console.error("Error handling game data:", e);
  }
}

function broadcastGameState() {
  const gameData = {
    type: "gameState",
    state: gameState,
  };

  const peers = [...swarm.connections];
  for (const peer of peers) {
    peer.write(JSON.stringify(gameData));
  }
}

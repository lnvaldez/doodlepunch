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
  nicknames: new Map(),
  currentRound: 0,
  maxRounds: 5,
  players: [], // Array to store player order
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
  const nickname = document.querySelector("#nickname-input").value.trim();
  if (!nickname) {
    alert("Please enter a nickname!");
    return;
  }
  const topicBuffer = crypto.randomBytes(32);
  joinSwarm(topicBuffer, nickname);
}

async function joinGameRoom(e) {
  e.preventDefault();
  const nickname = document.querySelector("#nickname-input").value.trim();
  if (!nickname) {
    alert("Please enter a nickname!");
    return;
  }
  const topicStr = document.querySelector("#join-chat-room-topic").value;
  const topicBuffer = b4a.from(topicStr, "hex");
  joinSwarm(topicBuffer, nickname);
}

async function joinSwarm(topicBuffer, nickname) {
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

  // Initialize game state with nickname
  initializeGame(nickname);
}

function initializeGame(nickname) {
  const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);
  gameState.scores.set(myId, 0);
  gameState.nicknames.set(myId, nickname);
  updateScoresDisplay();

  // Add event listener for start button
  const startButton = document.querySelector("#start-game");
  startButton.addEventListener("click", () => {
    if (swarm.connections.size > 0) {
      // Initialize player order when starting the game
      const players = Array.from(swarm.connections).map((peer) =>
        b4a.toString(peer.remotePublicKey, "hex").substr(0, 6)
      );
      players.push(myId);
      gameState.players = players;
      gameState.currentRound = 0;
      // Set first drawer randomly
      gameState.currentDrawer =
        players[Math.floor(Math.random() * players.length)];
      startNewRound();
    } else {
      alert("Please wait for other players to join before starting!");
    }
  });

  // Hide tools initially
  document.querySelector("#tools").style.display = "none";
  document.querySelector("#guessing-area").style.display = "none";
}

function startNewRound() {
  gameState.roundInProgress = true;
  gameState.guesses.clear();
  gameState.timeLeft = gameState.roundTime;

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Select drawer based on round number
  gameState.currentDrawer =
    gameState.players[gameState.currentRound % gameState.players.length];
  gameState.currentWord = words[Math.floor(Math.random() * words.length)];

  // Update UI
  updateGameState();

  // Start timer
  startTimer();

  // Send game state to all players
  broadcastGameState();
}

function startTimer() {
  const timerElement = document.querySelector("#timer");
  // Clear any existing interval
  if (window.timerInterval) {
    clearInterval(window.timerInterval);
  }

  // Start new interval
  window.timerInterval = setInterval(() => {
    if (!gameState.roundInProgress) {
      clearInterval(window.timerInterval);
      timerElement.textContent = "";
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
  const timerElement = document.querySelector("#timer");

  // Clear the timer interval
  if (window.timerInterval) {
    clearInterval(window.timerInterval);
  }
  timerElement.textContent = "Round ended!";

  // Clear all canvases
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Broadcast clear action to all peers
  const clearData = {
    type: "clear",
  };
  const peers = [...swarm.connections];
  for (const peer of peers) {
    peer.write(JSON.stringify(clearData));
  }

  // Increment round counter
  gameState.currentRound++;

  // Check if game is over
  if (gameState.currentRound >= gameState.maxRounds) {
    endGame();
    return;
  }

  // Select next drawer (alternate between players)
  const currentDrawerIndex = gameState.players.indexOf(gameState.currentDrawer);
  const nextDrawerIndex = (currentDrawerIndex + 1) % gameState.players.length;
  gameState.currentDrawer = gameState.players[nextDrawerIndex];
  gameState.currentWord = words[Math.floor(Math.random() * words.length)];

  // Update UI
  updateGameState();

  // Broadcast new game state
  broadcastGameState();

  // Start next round after a short delay
  setTimeout(startNewRound, 3000);
}

function endGame() {
  // Show final scores
  const scoresElement = document.querySelector("#scores");
  scoresElement.innerHTML = "<h2>Game Over! Final Scores:</h2>";

  // Sort players by score
  const sortedPlayers = [...gameState.scores.entries()].sort(
    (a, b) => b[1] - a[1]
  );

  sortedPlayers.forEach(([playerId, score]) => {
    const nickname = gameState.nicknames.get(playerId) || playerId;
    const scoreElement = document.createElement("div");
    scoreElement.className = "player-score";
    scoreElement.innerHTML = `<span>${nickname}: ${score}</span>`;
    scoresElement.appendChild(scoreElement);
  });

  // Show restart button
  const startButton = document.querySelector("#start-game");
  startButton.textContent = "Play Again";
  startButton.style.display = "block";
  startButton.addEventListener("click", () => {
    gameState.currentRound = 0;
    gameState.scores.clear();
    gameState.guesses.clear();
    updateScoresDisplay();
    startNewRound();
  });
}

function showGuessesToDrawer() {
  const guessesList = document.querySelector("#guesses-list");
  guessesList.innerHTML = "";

  gameState.guesses.forEach((guess, playerId) => {
    const nickname = gameState.nicknames.get(playerId) || playerId;
    const guessElement = document.createElement("div");
    guessElement.className = "guess-item";
    guessElement.innerHTML = `
      <span>${nickname}: ${guess}</span>
      <div>
        <button onclick="markGuess('${playerId}', true)">Correct</button>
        <button onclick="markGuess('${playerId}', false)">Incorrect</button>
      </div>
    `;
    guessesList.appendChild(guessElement);
  });
}

function updateChatMessages() {
  const chatMessages = document.querySelector("#chat-messages");
  chatMessages.innerHTML = "";

  gameState.guesses.forEach((guess, playerId) => {
    const messageElement = document.createElement("div");
    messageElement.className = "chat-message";
    messageElement.setAttribute("data-player", playerId);

    const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);
    const isDrawer = gameState.currentDrawer === myId;
    const isMyGuess = playerId === myId;
    const nickname = gameState.nicknames.get(playerId) || playerId;

    if (isDrawer) {
      // Drawer sees all guesses with checkmark and cross buttons
      messageElement.innerHTML = `
        <span>${nickname}: ${guess}</span>
        <div class="guess-actions">
          <button class="action-button correct-btn">✓</button>
          <button class="action-button incorrect-btn">✗</button>
        </div>
      `;

      // Add event listeners to the buttons
      const correctBtn = messageElement.querySelector(".correct-btn");
      const incorrectBtn = messageElement.querySelector(".incorrect-btn");

      correctBtn.addEventListener("click", () => markGuess(playerId, true));
      incorrectBtn.addEventListener("click", () => markGuess(playerId, false));
    } else if (isMyGuess) {
      // Players see their own guesses
      messageElement.innerHTML = `<span>Your guess: ${guess}</span>`;
    }
    chatMessages.appendChild(messageElement);
  });

  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function submitGuess() {
  if (gameState.roundInProgress) {
    const guessInput = document.querySelector("#guess-input");
    const guess = guessInput.value.trim().toLowerCase();

    if (guess) {
      const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);

      // Send guess to all players
      const guessData = {
        type: "guess",
        playerId: myId,
        guess: guess,
      };

      const peers = [...swarm.connections];
      for (const peer of peers) {
        peer.write(JSON.stringify(guessData));
      }

      // Update local state
      gameState.guesses.set(myId, guess);
      updateChatMessages();

      // Check if all players have guessed
      checkAllPlayersGuessed();

      // Clear input
      guessInput.value = "";
    }
  }
}

function clearTimer() {
  const timerElement = document.querySelector("#timer");
  timerElement.textContent = "";
}

function checkAllPlayersGuessed() {
  // Get all players except the current drawer
  const guessers = gameState.players.filter(
    (p) => p !== gameState.currentDrawer
  );

  // Check if all guessers have submitted a guess
  const allGuessed = guessers.every((playerId) =>
    gameState.guesses.has(playerId)
  );

  if (allGuessed) {
    // Notify the drawer
    const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);
    if (gameState.currentDrawer === myId) {
      const wordDisplay = document.querySelector("#word-display");
      wordDisplay.textContent = `All players have guessed! Evaluate their guesses.`;
    }
  }
}

// Add event listeners for guess submission
document.addEventListener("DOMContentLoaded", () => {
  const guessInput = document.querySelector("#guess-input");
  const submitButton = document.querySelector("#submit-guess");

  // Submit on button click
  submitButton.addEventListener("click", submitGuess);

  // Submit on Enter key
  guessInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      submitGuess();
    }
  });
});

function markGuess(playerId, isCorrect) {
  if (
    gameState.currentDrawer ===
    b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6)
  ) {
    if (isCorrect) {
      // Add points
      const guesserScore = gameState.scores.get(playerId) || 0;
      const drawerScore = gameState.scores.get(gameState.currentDrawer) || 0;
      gameState.scores.set(playerId, guesserScore + 3);
      gameState.scores.set(gameState.currentDrawer, drawerScore + 1);

      // Mark guess as correct
      const messageElement = document.querySelector(
        `[data-player="${playerId}"]`
      );
      if (messageElement) {
        messageElement.classList.add("correct");
        // Remove the action buttons
        const actions = messageElement.querySelector(".guess-actions");
        if (actions) {
          actions.innerHTML = "✓ Correct!";
        }
      }
    } else {
      // Mark guess as incorrect
      const messageElement = document.querySelector(
        `[data-player="${playerId}"]`
      );
      if (messageElement) {
        messageElement.classList.add("incorrect");
        // Remove the action buttons
        const actions = messageElement.querySelector(".guess-actions");
        if (actions) {
          actions.innerHTML = "✗ Incorrect";
        }
      }
    }
    updateScoresDisplay();

    // End the round after evaluating the guess
    setTimeout(() => {
      endRound();
    }, 2000);
  }
}

function updateScoresDisplay() {
  const scoresElement = document.querySelector("#scores");
  scoresElement.innerHTML = "";

  gameState.scores.forEach((score, playerId) => {
    const nickname = gameState.nicknames.get(playerId) || playerId;
    const scoreElement = document.createElement("div");
    scoreElement.className = "player-score";
    scoreElement.innerHTML = `<span>${nickname}: ${score}</span>`;
    scoresElement.appendChild(scoreElement);
  });
}

function updateGameState() {
  const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);
  const isDrawer = gameState.currentDrawer === myId;

  // Update word display
  const wordDisplay = document.querySelector("#word-display");
  if (isDrawer) {
    if (gameState.roundInProgress) {
      wordDisplay.textContent = `Draw this: ${gameState.currentWord} (Round ${
        gameState.currentRound + 1
      }/${gameState.maxRounds})`;
    } else {
      wordDisplay.textContent = `You're the next drawer! (Round ${
        gameState.currentRound + 1
      }/${gameState.maxRounds})`;
    }
  } else {
    wordDisplay.textContent = `Guess what's being drawn! (Round ${
      gameState.currentRound + 1
    }/${gameState.maxRounds})`;
  }

  // Update UI elements based on role
  document.querySelector("#tools").style.display =
    isDrawer && gameState.roundInProgress ? "flex" : "none";
  document.querySelector("#guessing-area").style.display = isDrawer
    ? "none"
    : "flex";
  document.querySelector("#start-game").style.display = "none";
  document.querySelector("#ready-to-draw").classList.add("hidden");
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

function clearCanvas() {
  const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);
  if (gameState.currentDrawer === myId) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Broadcast clear action to all peers
    const clearData = {
      type: "clear",
    };

    const peers = [...swarm.connections];
    for (const peer of peers) {
      peer.write(JSON.stringify(clearData));
    }
  }
}

function handleGameData(data) {
  try {
    const gameData = JSON.parse(data.toString());

    switch (gameData.type) {
      case "draw":
        // Set the color and tool before drawing
        const originalColor = currentColor;
        const originalTool = currentTool;
        currentColor = gameData.color;
        currentTool = gameData.tool;

        drawLine(gameData.fromX, gameData.fromY, gameData.toX, gameData.toY);

        // Restore original color and tool
        currentColor = originalColor;
        currentTool = originalTool;
        break;
      case "gameState":
        // Update game state from received data
        const newState = gameData.state;
        gameState = {
          ...gameState,
          currentDrawer: newState.currentDrawer,
          currentWord: newState.currentWord,
          roundInProgress: newState.roundInProgress,
          timeLeft: newState.timeLeft,
          scores: new Map(Object.entries(newState.scores)),
          guesses: new Map(Object.entries(newState.guesses)),
          nicknames: new Map(Object.entries(newState.nicknames)),
          currentRound: newState.currentRound,
          maxRounds: newState.maxRounds,
          players: newState.players,
        };
        updateGameState();
        updateChatMessages();

        // Update timer display and start/stop timer based on game state
        const timerElement = document.querySelector("#timer");
        if (gameState.roundInProgress) {
          startTimer(); // Start or restart timer for all players
        } else {
          if (window.timerInterval) {
            clearInterval(window.timerInterval);
          }
          timerElement.textContent = "";
        }
        break;
      case "guess":
        // Update guesses from received data
        gameState.guesses.set(gameData.playerId, gameData.guess);
        updateChatMessages();
        break;
      case "clear":
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        break;
    }
  } catch (e) {
    console.error("Error handling game data:", e);
  }
}

// Tool selection (clear functionality)
document.querySelectorAll(".tool-button").forEach((button) => {
  button.addEventListener("click", () => {
    document
      .querySelectorAll(".tool-button")
      .forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");
    currentTool = button.dataset.tool;

    // Add clear functionality
    if (currentTool === "clear") {
      clearCanvas();
    }
  });
});

function broadcastGameState() {
  // Convert Map to Object for JSON serialization
  const scoresObject = Object.fromEntries(gameState.scores);
  const guessesObject = Object.fromEntries(gameState.guesses);
  const nicknamesObject = Object.fromEntries(gameState.nicknames);

  const gameData = {
    type: "gameState",
    state: {
      ...gameState,
      scores: scoresObject,
      guesses: guessesObject,
      nicknames: nicknamesObject,
    },
  };

  const peers = [...swarm.connections];
  for (const peer of peers) {
    peer.write(JSON.stringify(gameData));
  }
}

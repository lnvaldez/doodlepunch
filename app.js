// For interactive documentation and code auto-completion in editor
/** @typedef {import('pear-interface')} */

/* global Pear */
import Hyperswarm from "hyperswarm"; // Module for P2P networking and connecting peers
import crypto from "hypercore-crypto"; // Cryptographic functions for generating the key in app
import b4a from "b4a"; // Module for buffer-to-string and vice-versa conversions
const { teardown, updates } = Pear; // Functions for cleanup and updates
import { spawn } from "child_process";
import { words } from "./words";

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

// Unannounce the public key before exiting the process
// (This is not a requirement, but it helps avoid DHT pollution)
teardown(() => swarm.destroy());

// Enable automatic reloading for the app
// This is optional but helpful during production
updates(() => Pear.reload());

// When there's a new connection, listen for new game data
swarm.on("connection", (peer) => {
  try {
    const name = b4a.toString(peer.remotePublicKey, "hex").substr(0, 6);
    console.log("New peer connected:", name);

    peer.on("data", (data) => {
      console.log(`Received data from ${name}`);
      handleGameData(data);
    });

    peer.on("error", (e) => {
      console.error(`Connection error with peer ${name}:`, e);
    });

    peer.on("close", () => {
      console.log(`Peer ${name} disconnected`);
    });
  } catch (error) {
    console.error("Error handling new connection:", error);
  }
});

// When there's updates to the swarm, update the peers count
swarm.on("update", () => {
  console.log("Swarm updated, connections:", swarm.connections.size);
  const peersCount = document.querySelector("#peers-count");
  if (peersCount) {
    peersCount.textContent = swarm.connections.size;
  }
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
  try {
    const nickname = document.querySelector("#nickname-input").value.trim();
    if (!nickname) {
      alert("Please enter a nickname!");
      return;
    }
    console.log("Creating game room with nickname:", nickname);
    const topicBuffer = crypto.randomBytes(32);
    await joinSwarm(topicBuffer, nickname);
  } catch (error) {
    console.error("Error creating game room:", error);
    alert("Failed to create game room: " + error.message);
    // Reset UI to initial state
    document.querySelector("#loading").classList.add("hidden");
    document.querySelector("#setup").classList.remove("hidden");
  }
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
  try {
    document.querySelector("#setup").classList.add("hidden");
    document.querySelector("#loading").classList.remove("hidden");

    console.log("Joining swarm with nickname:", nickname);
    const discovery = swarm.join(topicBuffer, { client: true, server: true });
    await discovery.flushed();

    const topic = b4a.toString(topicBuffer, "hex");
    console.log("Game room created with topic:", topic);
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
  } catch (error) {
    console.error("Error joining swarm:", error);
    alert("Failed to join game room: " + error.message);
    // Reset UI to initial state
    document.querySelector("#loading").classList.add("hidden");
    document.querySelector("#setup").classList.remove("hidden");
  }
}

function initializeGame(nickname) {
  try {
    console.log("Initializing game with nickname:", nickname);
    const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);
    console.log("Player ID:", myId);

    gameState.scores.set(myId, 0);
    gameState.nicknames.set(myId, nickname);

    // Broadcast initial game state with nickname
    broadcastGameState();
    updateScoresDisplay();

    // Add event listener for start button
    const startButton = document.querySelector("#start-game");
    if (startButton) {
      // Remove any existing listeners to prevent duplicates
      const newStartButton = startButton.cloneNode(true);
      startButton.parentNode.replaceChild(newStartButton, startButton);

      newStartButton.addEventListener("click", () => {
        console.log(
          "Start button clicked, connections:",
          swarm.connections.size
        );
        if (swarm.connections.size > 0) {
          // Initialize player order when starting the game
          const players = Array.from(swarm.connections).map((peer) =>
            b4a.toString(peer.remotePublicKey, "hex").substr(0, 6)
          );
          players.push(myId);
          console.log("Players:", players);

          gameState.players = players;
          gameState.currentRound = 0;
          // Set first drawer randomly
          gameState.currentDrawer =
            players[Math.floor(Math.random() * players.length)];
          console.log("First drawer:", gameState.currentDrawer);

          startNewRound();
        } else {
          alert("Please wait for other players to join before starting!");
        }
      });
      console.log("Added event listener to start button");
    } else {
      console.error("Start button not found!");
    }

    // Hide tools initially
    const tools = document.querySelector("#tools");
    const guessingArea = document.querySelector("#guessing-area");

    if (tools) tools.style.display = "none";
    if (guessingArea) guessingArea.style.display = "none";

    console.log("Game initialized successfully");
  } catch (error) {
    console.error("Error initializing game:", error);
  }
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

  const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);

  // Sort players by score, but keep current player first
  const sortedPlayers = [...gameState.scores.entries()].sort((a, b) => {
    if (a[0] === myId) return -1;
    if (b[0] === myId) return 1;
    return b[1] - a[1]; // Sort others by score
  });

  sortedPlayers.forEach(([playerId, score]) => {
    const nickname =
      playerId === myId ? "You" : gameState.nicknames.get(playerId) || playerId;
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

function updateChatMessages() {
  const chatMessages = document.querySelector("#chat-messages");
  chatMessages.innerHTML = "";

  gameState.guesses.forEach((guessData, playerId) => {
    const messageElement = document.createElement("div");
    messageElement.className = "chat-message";
    messageElement.setAttribute("data-player", playerId);

    const nickname =
      gameState.nicknames.get(playerId) || `Player ${playerId.substr(0, 4)}`;

    // Handle both old and new guess format
    if (typeof guessData === "string") {
      // Old format - simple string
      messageElement.innerHTML = `<span>${nickname}: ${guessData}</span>`;
    } else {
      // New format - object with text, points, similarity
      const points = guessData.points || 0;
      const similarity = guessData.similarity
        ? Math.round(guessData.similarity * 100)
        : 0;

      let pointsClass = "";
      if (points === 3) pointsClass = "correct";
      else if (points > 0) pointsClass = "partial";

      messageElement.innerHTML = `
        <div class="guess-result">
          <span class="guess-text">${nickname}: ${guessData.text}</span>
          <span class="guess-points ${pointsClass}">${points} points</span>
          <span class="guess-similarity">${similarity}% match</span>
        </div>
      `;
    }

    chatMessages.appendChild(messageElement);
  });

  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Function to compare words using the Python script
function compareWords(word1, word2) {
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn("python", ["similarity.py", word1, word2]);

    pythonProcess.stdout.on("data", (data) => {
      resolve(parseFloat(data.toString()));
    });

    pythonProcess.stderr.on("data", (data) => {
      reject(data.toString());
    });
  });
}

async function submitGuess() {
  if (gameState.roundInProgress) {
    const guessInput = document.querySelector("#guess-input");
    const guess = guessInput.value.trim().toLowerCase();

    if (guess) {
      const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);

      try {
        showNotification("Evaluating your guess...", 2000);

        // Use the Python script for comparison
        const similarity = await compareWords(gameState.currentWord, guess);
        const points = calculatePoints(similarity);

        // Update scores
        const currentScore = gameState.scores.get(myId) || 0;
        gameState.scores.set(myId, currentScore + points);

        // Store guess with evaluation data
        gameState.guesses.set(myId, {
          text: guess,
          points: points,
          similarity: similarity,
        });

        // Show notification with points
        showNotification(
          `${points} points! (${Math.round(similarity * 100)}% similar)`,
          3000
        );

        // Create the guess data
        const guessData = {
          type: "aiGuess",
          playerId: myId,
          guess: {
            text: guess,
            points: points,
            similarity: similarity,
          },
          currentScore: gameState.scores.get(myId),
        };

        const peers = [...swarm.connections];

        if (points === 3) {
          // Correct guess (3 points) - only send to the drawer
          // Halve the timer
          gameState.timeLeft = Math.floor(gameState.timeLeft / 2);
          const timerElement = document.querySelector("#timer");
          timerElement.textContent = `Time left: ${gameState.timeLeft}s`;

          // Create a special timer update message for all players
          const timerData = {
            type: "timerUpdate",
            timeLeft: gameState.timeLeft,
          };

          // Send to all peers
          for (const peer of peers) {
            const peerId = b4a
              .toString(peer.remotePublicKey, "hex")
              .substr(0, 6);

            // Only send the guess to the drawer
            if (peerId === gameState.currentDrawer) {
              peer.write(JSON.stringify(guessData));
            }

            // Send timer update to everyone
            peer.write(JSON.stringify(timerData));
          }
        } else {
          // Normal guess (less than 3 points) - broadcast to all
          for (const peer of peers) {
            peer.write(JSON.stringify(guessData));
          }
        }

        updateChatMessages();
        updateScoresDisplay();
        guessInput.value = "";
      } catch (error) {
        console.error("Evaluation error:", error);
      }
    }
  }
}

function calculatePoints(similarity) {
  if (similarity >= 0.95) return 3;
  if (similarity >= 0.85) return 2;
  if (similarity >= 0.65) return 1;
  return 0;
}

// Add event listeners for guess submission
document.addEventListener("DOMContentLoaded", () => {
  try {
    console.log("DOM loaded, setting up event listeners");

    // Create and join game room buttons
    const createButton = document.querySelector("#create-chat-room");
    if (createButton) {
      createButton.addEventListener("click", createGameRoom);
      console.log("Added event listener to create button");
    } else {
      console.error("Create button not found!");
    }

    const joinForm = document.querySelector("#join-form");
    if (joinForm) {
      joinForm.addEventListener("submit", joinGameRoom);
      console.log("Added event listener to join form");
    } else {
      console.error("Join form not found!");
    }

    // Guess submission
    const guessInput = document.querySelector("#guess-input");
    const submitButton = document.querySelector("#submit-guess");

    if (submitButton) {
      submitButton.addEventListener("click", submitGuess);
      console.log("Added event listener to submit button");
    }

    if (guessInput) {
      guessInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          submitGuess();
        }
      });
      console.log("Added keypress event listener to guess input");
    }
  } catch (error) {
    console.error("Error setting up initial event listeners:", error);
  }
});

function updateScoresDisplay() {
  const scoresElement = document.querySelector("#scores");
  scoresElement.innerHTML = "";

  const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);

  // Convert scores to array and sort to put current player first
  const sortedScores = [...gameState.scores.entries()].sort((a, b) => {
    if (a[0] === myId) return -1;
    if (b[0] === myId) return 1;
    return 0;
  });

  sortedScores.forEach(([playerId, score]) => {
    let nickname;
    if (playerId === myId) {
      nickname = "You";
    } else {
      nickname = gameState.nicknames.get(playerId);
      // If nickname isn't available yet, show placeholder
      if (!nickname) nickname = `Player ${playerId.substr(0, 4)}`;
    }
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
    const [x, y] = getCanvasCoordinates(e);

    if (currentTool === "bucket") {
      // Use the bucket tool
      floodFill(Math.floor(x), Math.floor(y), currentColor);

      // Send fill data to peers
      const fillData = {
        type: "fill",
        color: currentColor,
        x: Math.floor(x),
        y: Math.floor(y),
      };

      const peers = [...swarm.connections];
      for (const peer of peers) {
        peer.write(JSON.stringify(fillData));
      }
    } else {
      // Regular drawing tools
      isDrawing = true;
      [lastX, lastY] = [x, y];
    }
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
      case "aiGuess":
        // Update guesses with AI evaluation data
        gameState.guesses.set(gameData.playerId, gameData.guess);
        // Update score
        gameState.scores.set(gameData.playerId, gameData.currentScore);
        updateChatMessages();
        updateScoresDisplay();
        break;

      case "gameState":
        // Update game state from received data
        const newState = gameData.state;

        // Preserve existing nicknames and merge with new ones
        const existingNicknames = new Map(gameState.nicknames);
        const newNicknames = new Map(Object.entries(newState.nicknames || {}));

        // Merge nicknames, keeping existing ones if they exist
        for (const [playerId, nickname] of newNicknames) {
          if (nickname) {
            // Only update if there's a nickname
            existingNicknames.set(playerId, nickname);
          }
        }

        gameState = {
          ...gameState,
          currentDrawer: newState.currentDrawer,
          currentWord: newState.currentWord,
          roundInProgress: newState.roundInProgress,
          timeLeft: newState.timeLeft,
          scores: new Map(Object.entries(newState.scores)),
          guesses: new Map(Object.entries(newState.guesses)),
          nicknames: existingNicknames,
          currentRound: newState.currentRound,
          maxRounds: newState.maxRounds,
          players: newState.players,
        };
        updateGameState();
        updateChatMessages();
        updateScoresDisplay();

        // Update timer display and start/stop timer based on game state
        const timerElement = document.querySelector("#timer");
        if (gameState.roundInProgress) {
          // Restart timer with updated timeLeft
          if (window.timerInterval) {
            clearInterval(window.timerInterval);
          }
          startTimer();
        } else {
          if (window.timerInterval) {
            clearInterval(window.timerInterval);
          }
          timerElement.textContent = "";
        }
        break;
      case "clear":
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        break;
      case "skip":
        // Handle skip notification
        const playerId = gameData.playerId;
        const nickname =
          gameState.nicknames.get(playerId) ||
          `Player ${playerId.substr(0, 4)}`;
        showNotification(`${nickname} skipped their guess.`, 2000);
        break;
      case "timerUpdate":
        // Update the timer with the received value
        gameState.timeLeft = gameData.timeLeft;

        timerElement.textContent = `Time left: ${gameState.timeLeft}s`;
        break;
      case "fill":
        // Apply the fill operation
        floodFill(gameData.x, gameData.y, gameData.color);
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

function showNotification(message, duration = 3000) {
  // Check if notification container exists, if not create it
  let notificationContainer = document.getElementById("notification-container");
  if (!notificationContainer) {
    notificationContainer = document.createElement("div");
    notificationContainer.id = "notification-container";
    notificationContainer.style.position = "fixed";
    notificationContainer.style.top = "20px";
    notificationContainer.style.right = "20px";
    notificationContainer.style.zIndex = "1000";
    document.body.appendChild(notificationContainer);
  }

  // Create notification element
  const notification = document.createElement("div");
  notification.className = "notification";
  notification.style.backgroundColor = "#000";
  notification.style.color = "#b0d944";
  notification.style.padding = "10px 15px";
  notification.style.margin = "5px 0";
  notification.style.border = "1px solid #b0d944";
  notification.style.borderRadius = "3px";
  notification.style.opacity = "0";
  notification.style.transition = "opacity 0.3s";
  notification.textContent = message;

  // Add to container
  notificationContainer.appendChild(notification);

  // Fade in
  setTimeout(() => {
    notification.style.opacity = "1";
  }, 10);

  // Remove after duration
  setTimeout(() => {
    notification.style.opacity = "0";
    setTimeout(() => {
      notificationContainer.removeChild(notification);
    }, 300);
  }, duration);
}

// First, we need to add a floodFill function
function floodFill(startX, startY, fillColor) {
  // Get the canvas image data
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Get the start point color
  const startPos = (startY * canvas.width + startX) * 4;
  const startR = data[startPos];
  const startG = data[startPos + 1];
  const startB = data[startPos + 2];
  const startA = data[startPos + 3];

  // Convert fill color to RGBA
  const fillColorObj = hexToRgb(fillColor);
  const fillR = fillColorObj.r;
  const fillG = fillColorObj.g;
  const fillB = fillColorObj.b;
  const fillA = 255; // fully opaque

  // If target color is the same as fill color, do nothing
  if (
    startR === fillR &&
    startG === fillG &&
    startB === fillB &&
    startA === fillA
  ) {
    return;
  }

  // Queue for pixels to check
  const queue = [];
  queue.push([startX, startY]);

  // Process queue
  while (queue.length > 0) {
    const [x, y] = queue.shift();
    const pos = (y * canvas.width + x) * 4;

    // Check if the current pixel has the target color
    if (
      x >= 0 &&
      x < canvas.width &&
      y >= 0 &&
      y < canvas.height &&
      data[pos] === startR &&
      data[pos + 1] === startG &&
      data[pos + 2] === startB &&
      data[pos + 3] === startA
    ) {
      // Fill the pixel
      data[pos] = fillR;
      data[pos + 1] = fillG;
      data[pos + 2] = fillB;
      data[pos + 3] = fillA;

      // Add neighboring pixels to the queue
      queue.push([x + 1, y]);
      queue.push([x - 1, y]);
      queue.push([x, y + 1]);
      queue.push([x, y - 1]);
    }
  }

  // Put the modified image data back on the canvas
  ctx.putImageData(imageData, 0, 0);
}

// Utility function to convert hex color to RGB
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
}

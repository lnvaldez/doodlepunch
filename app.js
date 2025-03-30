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
  verificationResults: new Map(), // Map of guess ID -> Map of player ID -> similarity
  pendingVotes: new Map(), // For end-game verification
  voteResults: new Map(), // Track vote results
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

  // Show verification results before moving to next round
  showRoundVerificationResults();

  // Increment round counter
  gameState.currentRound++;

  // Check if game is over
  if (gameState.currentRound >= gameState.maxRounds) {
    // Wait for verification results to be shown before ending game
    setTimeout(endGame, 5000);
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

  // Start next round after a longer delay to allow viewing results
  setTimeout(startNewRound, 8000);
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

  // Clear existing event listeners
  const newStartButton = startButton.cloneNode(true);
  startButton.parentNode.replaceChild(newStartButton, startButton);

  newStartButton.addEventListener("click", () => {
    gameState.currentRound = 0;
    gameState.scores.clear();
    gameState.guesses.clear();
    gameState.verificationResults.clear();
    gameState.voteResults.clear();
    updateScoresDisplay();
    startNewRound();
  });

  // Add verification results button
  const gameControls = document.querySelector("#game-controls");

  // Check if button already exists
  const existingButton = document.querySelector(".verification-button");
  if (existingButton) {
    gameControls.removeChild(existingButton);
  }

  const verificationButton = document.createElement("button");
  verificationButton.className = "control-button verification-button";
  verificationButton.textContent = "View All Verification Results";
  verificationButton.style.marginTop = "10px";
  verificationButton.addEventListener("click", showVerificationSummary);

  gameControls.appendChild(verificationButton);
}

function updateChatMessages() {
  const chatMessages = document.querySelector("#chat-messages");
  chatMessages.innerHTML = "";
  const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);
  const isDrawer = gameState.currentDrawer === myId;

  gameState.guesses.forEach((guessData, playerId) => {
    const messageElement = document.createElement("div");
    messageElement.className = "chat-message";
    messageElement.setAttribute("data-player", playerId);

    const nickname =
      gameState.nicknames.get(playerId) || `Player ${playerId.substr(0, 4)}`;

    // Handle various guess formats
    if (typeof guessData === "string") {
      // Old format - simple string
      messageElement.innerHTML = `<span>${nickname}: ${guessData}</span>`;
    } else if (guessData.pending) {
      // Pending verification
      messageElement.innerHTML = `
        <div class="guess-result">
          <span class="guess-text">${nickname}: ${guessData.text}</span>
          <span class="guess-pending">Verification in progress...</span>
        </div>
      `;
    } else {
      // Verified or normal guess
      const points = guessData.points || 0;
      const similarity = guessData.similarity || 0;
      const isCorrect = guessData.isCorrect || points === 3;

      let pointsClass = "";
      if (isCorrect) pointsClass = "correct";
      else if (points > 0) pointsClass = "partial";

      let verificationText = "";
      if (guessData.verified) {
        verificationText = `<span class="verification-status">✓ Verified by ${guessData.verifications} players</span>`;
      }

      // Determine what text to display
      let displayText = guessData.text;

      // If it's a correct guess but I'm not the guesser and not the drawer, hide the actual word
      if (isCorrect && playerId !== myId && !isDrawer) {
        displayText = "Correct word! ✓"; // Just indicate it was correct without showing the word
      }

      messageElement.innerHTML = `
        <div class="guess-result">
          <span class="guess-text">${nickname}: ${displayText}</span>
          <span class="guess-points ${pointsClass}">${points} points</span>
          <span class="guess-similarity">similarity: ${similarity.toFixed(
            4
          )}</span>
          ${verificationText}
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
        // Show normal notification
        showNotification("Evaluating your guess...", 2000);

        // Use the Python script for comparison
        const similarity = await compareWords(gameState.currentWord, guess);
        const points = calculatePoints(similarity);
        const isCorrect = points === 3;

        // Update scores
        const currentScore = gameState.scores.get(myId) || 0;
        gameState.scores.set(myId, currentScore + points);

        // Store guess with evaluation data
        gameState.guesses.set(myId, {
          text: guess,
          points: points,
          similarity: similarity,
          isCorrect: isCorrect,
        });

        // Show notification with points
        showNotification(
          `${points} points! (similarity: ${similarity.toFixed(4)})`,
          3000
        );

        // Also broadcast for verification (silently in the background)
        const guessId = broadcastGuessForVerification(guess, myId);

        // Create two versions of the guess data - one for the drawer and one for other players
        const guessDataForDrawer = {
          type: "aiGuess",
          playerId: myId,
          guess: {
            text: guess, // Actual guess for the drawer
            points: points,
            similarity: similarity,
            isCorrect: isCorrect,
          },
          currentScore: gameState.scores.get(myId),
        };

        const guessDataForOthers = {
          type: "aiGuess",
          playerId: myId,
          guess: {
            text: isCorrect ? "Correct word! ✓" : guess, // Hide the exact word if correct
            points: points,
            similarity: similarity,
            isCorrect: isCorrect,
          },
          currentScore: gameState.scores.get(myId),
        };

        // Send to all peers
        const peers = [...swarm.connections];
        for (const peer of peers) {
          const peerId = b4a.toString(peer.remotePublicKey, "hex").substr(0, 6);

          // Only the drawer sees the actual correct word
          if (peerId === gameState.currentDrawer) {
            peer.write(JSON.stringify(guessDataForDrawer));
          } else {
            peer.write(JSON.stringify(guessDataForOthers));
          }
        }

        updateChatMessages();
        updateScoresDisplay();
        guessInput.value = "";

        // If this is a winning guess (3 points)
        if (isCorrect) {
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
            peer.write(JSON.stringify(timerData));
          }
        }
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
      case "verifyGuess":
        // Handle verification request
        processGuessVerification(gameData);
        break;

      case "verificationResult":
        // Handle verification result
        handleVerificationResult(gameData);
        break;
      case "verificationVote":
        handleVerificationVote(gameData);
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

// This function broadcasts a guess to all clients for independent verification
function broadcastGuessForVerification(guess, guessingPlayerId) {
  const guessId = `${guessingPlayerId}-${Date.now()}`; // Unique ID for this guess

  // Create a verification request
  const verificationRequest = {
    type: "verifyGuess",
    guessId: guessId,
    guess: guess,
    guessingPlayerId: guessingPlayerId,
    timestamp: Date.now(),
  };

  // Initialize verification results for this guess
  if (!gameState.verificationResults.has(guessId)) {
    gameState.verificationResults.set(guessId, new Map());
  }

  // Send to all peers
  const peers = [...swarm.connections];
  for (const peer of peers) {
    peer.write(JSON.stringify(verificationRequest));
  }

  // Also process locally
  processGuessVerification(verificationRequest);

  return guessId; // Return the ID for tracking
}

// This function processes a verification request and calculates similarity locally
async function processGuessVerification(verificationData) {
  const { guessId, guess, guessingPlayerId } = verificationData;
  const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);

  try {
    // Calculate similarity locally
    const similarity = await compareWords(gameState.currentWord, guess);

    // Store the result locally
    if (!gameState.verificationResults.has(guessId)) {
      gameState.verificationResults.set(guessId, new Map());
    }

    const guessResults = gameState.verificationResults.get(guessId);
    guessResults.set(myId, {
      similarity,
      points: calculatePoints(similarity),
      verifier: myId,
      timestamp: Date.now(),
    });

    // Broadcast the verification result
    const verificationResult = {
      type: "verificationResult",
      guessId: guessId,
      guessingPlayerId: guessingPlayerId,
      verifierId: myId,
      similarity: similarity,
      points: calculatePoints(similarity),
    };

    // Send to all peers
    const peers = [...swarm.connections];
    for (const peer of peers) {
      peer.write(JSON.stringify(verificationResult));
    }

    console.log(`Verified guess ${guess} with similarity ${similarity}`);
  } catch (error) {
    console.error("Error processing verification:", error);
  }
}

// This function handles received verification results
function handleVerificationResult(data) {
  const { guessId, guessingPlayerId, verifierId, similarity, points } = data;

  // Store the verification result
  if (!gameState.verificationResults.has(guessId)) {
    gameState.verificationResults.set(guessId, new Map());
  }

  const guessResults = gameState.verificationResults.get(guessId);
  guessResults.set(verifierId, {
    similarity,
    points,
    verifier: verifierId,
    timestamp: Date.now(),
  });

  // Check if the result is for our guess and update UI if needed
  const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);
  if (guessingPlayerId === myId) {
    updateVerificationUI(guessId);
  }
}

// Update the UI with verification results for a guess
function updateVerificationUI(guessId) {
  const guessResults = gameState.verificationResults.get(guessId);
  if (!guessResults || guessResults.size === 0) return;

  // Calculate average similarity and points
  let totalSimilarity = 0;
  let totalPoints = 0;

  guessResults.forEach((result) => {
    totalSimilarity += result.similarity;
    totalPoints += result.points;
  });

  const averageSimilarity = totalSimilarity / guessResults.size;
  const averagePoints = Math.round(totalPoints / guessResults.size);

  // Update the chat/guess display with verification information
  const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);

  // Now update the guess in the game state
  if (gameState.guesses.has(myId)) {
    const existingGuessData = gameState.guesses.get(myId);

    // Update with verification data
    gameState.guesses.set(myId, {
      ...existingGuessData,
      points: averagePoints,
      similarity: averageSimilarity,
      verified: true,
      verifications: guessResults.size,
    });

    // Update score
    const currentScore = gameState.scores.get(myId) || 0;
    gameState.scores.set(myId, currentScore + averagePoints);

    // Update UI
    updateChatMessages();
    updateScoresDisplay();
  }
}

// Function to show the verification summary
function showVerificationSummary() {
  // Create container for verification summary
  const summaryContainer = document.createElement("div");
  summaryContainer.className = "verification-summary";
  summaryContainer.style.position = "fixed";
  summaryContainer.style.top = "50%";
  summaryContainer.style.left = "50%";
  summaryContainer.style.transform = "translate(-50%, -50%)";
  summaryContainer.style.backgroundColor = "#001601";
  summaryContainer.style.color = "#b0d944";
  summaryContainer.style.padding = "20px";
  summaryContainer.style.borderRadius = "5px";
  summaryContainer.style.zIndex = "1000";
  summaryContainer.style.maxWidth = "80%";
  summaryContainer.style.maxHeight = "80%";
  summaryContainer.style.overflow = "auto";

  // Add heading
  const heading = document.createElement("h2");
  heading.textContent = "Verification Results";
  summaryContainer.appendChild(heading);

  // Create table for verification results
  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.marginTop = "15px";

  // Create header row
  const headerRow = document.createElement("tr");

  const guessHeader = document.createElement("th");
  guessHeader.textContent = "Guess";
  guessHeader.style.textAlign = "left";
  guessHeader.style.padding = "8px";
  guessHeader.style.borderBottom = "1px solid #b0d944";

  const playerHeader = document.createElement("th");
  playerHeader.textContent = "Player";
  playerHeader.style.textAlign = "left";
  playerHeader.style.padding = "8px";
  playerHeader.style.borderBottom = "1px solid #b0d944";

  headerRow.appendChild(guessHeader);
  headerRow.appendChild(playerHeader);

  // Add headers for each player as a verifier
  gameState.players.forEach((playerId) => {
    const verifierHeader = document.createElement("th");
    const nickname =
      gameState.nicknames.get(playerId) || `Player ${playerId.substr(0, 4)}`;
    verifierHeader.textContent = nickname;
    verifierHeader.style.textAlign = "center";
    verifierHeader.style.padding = "8px";
    verifierHeader.style.borderBottom = "1px solid #b0d944";
    headerRow.appendChild(verifierHeader);
  });

  const consensusHeader = document.createElement("th");
  consensusHeader.textContent = "Consensus";
  consensusHeader.style.textAlign = "center";
  consensusHeader.style.padding = "8px";
  consensusHeader.style.borderBottom = "1px solid #b0d944";
  headerRow.appendChild(consensusHeader);

  table.appendChild(headerRow);

  // Add rows for each verified guess
  gameState.verificationResults.forEach((results, guessId) => {
    const row = document.createElement("tr");

    // Extract guess and player info from guessId
    const parts = guessId.split("-");
    const guessingPlayerId = parts[0];
    const guessData = Array.from(gameState.guesses.entries()).find(
      ([pid, data]) => pid === guessingPlayerId
    );

    if (!guessData) return; // Skip if we can't find the guess

    const guessText = guessData[1].text;
    const nickname =
      gameState.nicknames.get(guessingPlayerId) ||
      `Player ${guessingPlayerId.substr(0, 4)}`;

    // Add guess column
    const guessCell = document.createElement("td");
    guessCell.textContent = guessText;
    guessCell.style.padding = "8px";
    guessCell.style.borderBottom = "1px solid #3a3a3a";

    // Add player column
    const playerCell = document.createElement("td");
    playerCell.textContent = nickname;
    playerCell.style.padding = "8px";
    playerCell.style.borderBottom = "1px solid #3a3a3a";

    row.appendChild(guessCell);
    row.appendChild(playerCell);

    // Add similarity values from each verifier
    let totalSimilarity = 0;
    let verifierCount = 0;

    gameState.players.forEach((playerId) => {
      const verifierCell = document.createElement("td");
      verifierCell.style.textAlign = "center";
      verifierCell.style.padding = "8px";
      verifierCell.style.borderBottom = "1px solid #3a3a3a";

      if (results.has(playerId)) {
        const result = results.get(playerId);
        verifierCell.textContent = `${Math.round(result.similarity * 100)}%`;
        totalSimilarity += result.similarity;
        verifierCount++;
      } else {
        verifierCell.textContent = "N/A";
      }

      row.appendChild(verifierCell);
    });

    // Add consensus column
    const consensusCell = document.createElement("td");
    consensusCell.style.textAlign = "center";
    consensusCell.style.padding = "8px";
    consensusCell.style.borderBottom = "1px solid #3a3a3a";

    if (verifierCount > 0) {
      const avgSimilarity = totalSimilarity / verifierCount;
      consensusCell.textContent = `${Math.round(avgSimilarity * 100)}%`;
    } else {
      consensusCell.textContent = "N/A";
    }

    row.appendChild(consensusCell);
    table.appendChild(row);
  });

  summaryContainer.appendChild(table);

  // Add voting buttons
  const votingSection = document.createElement("div");
  votingSection.style.marginTop = "20px";
  votingSection.style.textAlign = "center";

  const votePrompt = document.createElement("p");
  votePrompt.textContent = "Do you agree with these verification results?";
  votingSection.appendChild(votePrompt);

  const buttonContainer = document.createElement("div");
  buttonContainer.style.display = "flex";
  buttonContainer.style.justifyContent = "center";
  buttonContainer.style.gap = "20px";
  buttonContainer.style.marginTop = "10px";

  const agreeButton = document.createElement("button");
  agreeButton.textContent = "I Agree";
  agreeButton.style.padding = "10px 20px";
  agreeButton.style.backgroundColor = "#004d00";
  agreeButton.style.color = "#b0d944";
  agreeButton.style.border = "none";
  agreeButton.style.borderRadius = "5px";
  agreeButton.style.cursor = "pointer";

  const disagreeButton = document.createElement("button");
  disagreeButton.textContent = "I Disagree";
  disagreeButton.style.padding = "10px 20px";
  disagreeButton.style.backgroundColor = "#4d0000";
  disagreeButton.style.color = "#b0d944";
  disagreeButton.style.border = "none";
  disagreeButton.style.borderRadius = "5px";
  disagreeButton.style.cursor = "pointer";

  // Add voting functionality
  const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);

  agreeButton.addEventListener("click", () => {
    submitVerificationVote(true);
    agreeButton.disabled = true;
    disagreeButton.disabled = true;
    votePrompt.textContent = "Your vote has been recorded. Thank you!";
  });

  disagreeButton.addEventListener("click", () => {
    submitVerificationVote(false);
    agreeButton.disabled = true;
    disagreeButton.disabled = true;
    votePrompt.textContent = "Your vote has been recorded. Thank you!";
  });

  buttonContainer.appendChild(agreeButton);
  buttonContainer.appendChild(disagreeButton);
  votingSection.appendChild(buttonContainer);

  // Add close button
  const closeButton = document.createElement("button");
  closeButton.textContent = "Close";
  closeButton.style.marginTop = "20px";
  closeButton.style.padding = "8px 16px";
  closeButton.style.backgroundColor = "#000";
  closeButton.style.color = "#b0d944";
  closeButton.style.border = "1px solid #b0d944";
  closeButton.style.borderRadius = "5px";
  closeButton.style.cursor = "pointer";

  closeButton.addEventListener("click", () => {
    document.body.removeChild(summaryContainer);
  });

  summaryContainer.appendChild(votingSection);
  summaryContainer.appendChild(closeButton);
  document.body.appendChild(summaryContainer);
}

// Function to submit a verification vote
function submitVerificationVote(agree) {
  const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);

  // Create vote data
  const voteData = {
    type: "verificationVote",
    playerId: myId,
    agree: agree,
    timestamp: Date.now(),
  };

  // Store vote locally
  if (!gameState.voteResults.has(myId)) {
    gameState.voteResults.set(myId, agree);
  }

  // Broadcast vote to all peers
  const peers = [...swarm.connections];
  for (const peer of peers) {
    peer.write(JSON.stringify(voteData));
  }

  // Check vote results
  updateVotingResults();
}

// Function to handle incoming votes
function handleVerificationVote(data) {
  const { playerId, agree } = data;

  // Store the vote
  gameState.voteResults.set(playerId, agree);

  // Update voting results
  updateVotingResults();
}

// Update voting results and display
function updateVotingResults() {
  // Count votes
  let agreeCount = 0;
  let disagreeCount = 0;

  gameState.voteResults.forEach((agree) => {
    if (agree) {
      agreeCount++;
    } else {
      disagreeCount++;
    }
  });

  // If everyone has voted, show the results
  if (agreeCount + disagreeCount >= gameState.players.length) {
    // Create result notification
    if (agreeCount > disagreeCount) {
      showNotification(
        "Majority of players AGREE with verification results!",
        5000
      );
    } else if (disagreeCount > agreeCount) {
      showNotification(
        "Majority of players DISAGREE with verification results!",
        5000
      );
    } else {
      showNotification(
        "Verification vote is tied! No consensus reached.",
        5000
      );
    }
  }
}

// Create a function to show verification results at the end of each round
function showRoundVerificationResults() {
  // Create container for round verification summary
  const summaryContainer = document.createElement("div");
  summaryContainer.className = "verification-summary";
  summaryContainer.style.position = "fixed";
  summaryContainer.style.top = "50%";
  summaryContainer.style.left = "50%";
  summaryContainer.style.transform = "translate(-50%, -50%)";
  summaryContainer.style.backgroundColor = "#001601";
  summaryContainer.style.color = "#b0d944";
  summaryContainer.style.padding = "20px";
  summaryContainer.style.borderRadius = "5px";
  summaryContainer.style.zIndex = "1000";
  summaryContainer.style.maxWidth = "90%";
  summaryContainer.style.maxHeight = "80%";
  summaryContainer.style.overflow = "auto";

  // Add heading
  const heading = document.createElement("h2");
  heading.textContent = `Round ${
    gameState.currentRound + 1
  } Verification Results`;
  summaryContainer.appendChild(heading);

  // Add word information
  const wordInfo = document.createElement("p");
  wordInfo.textContent = `The word was: ${gameState.currentWord}`;
  wordInfo.style.fontSize = "18px";
  wordInfo.style.marginBottom = "20px";
  summaryContainer.appendChild(wordInfo);

  // Create table for verification results
  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.marginTop = "15px";

  // Create header row
  const headerRow = document.createElement("tr");

  const guessHeader = document.createElement("th");
  guessHeader.textContent = "Guess";
  guessHeader.style.textAlign = "left";
  guessHeader.style.padding = "8px";
  guessHeader.style.borderBottom = "1px solid #b0d944";

  const playerHeader = document.createElement("th");
  playerHeader.textContent = "Player";
  playerHeader.style.textAlign = "left";
  playerHeader.style.padding = "8px";
  playerHeader.style.borderBottom = "1px solid #b0d944";

  headerRow.appendChild(guessHeader);
  headerRow.appendChild(playerHeader);

  // Add headers for each player as a verifier
  gameState.players.forEach((playerId) => {
    const verifierHeader = document.createElement("th");
    const nickname =
      gameState.nicknames.get(playerId) || `Player ${playerId.substr(0, 4)}`;
    verifierHeader.textContent = nickname;
    verifierHeader.style.textAlign = "center";
    verifierHeader.style.padding = "8px";
    verifierHeader.style.borderBottom = "1px solid #b0d944";
    headerRow.appendChild(verifierHeader);
  });

  const consensusHeader = document.createElement("th");
  consensusHeader.textContent = "Consensus";
  consensusHeader.style.textAlign = "center";
  consensusHeader.style.padding = "8px";
  consensusHeader.style.borderBottom = "1px solid #b0d944";
  headerRow.appendChild(consensusHeader);

  table.appendChild(headerRow);

  // Filter verification results for the current round only
  let foundResults = false;
  gameState.verificationResults.forEach((results, guessId) => {
    const row = document.createElement("tr");

    // Extract guess and player info from guessId
    const parts = guessId.split("-");
    const guessingPlayerId = parts[0];
    const guessData = Array.from(gameState.guesses.entries()).find(
      ([pid, data]) => pid === guessingPlayerId
    );

    if (!guessData) return; // Skip if we can't find the guess

    foundResults = true;
    // Now we can show the actual guess since the round is over
    const guessText = guessData[1].text;
    const nickname =
      gameState.nicknames.get(guessingPlayerId) ||
      `Player ${guessingPlayerId.substr(0, 4)}`;

    // Add guess column - At round end, we can show the actual word
    const guessCell = document.createElement("td");
    guessCell.textContent = guessText;
    guessCell.style.padding = "8px";
    guessCell.style.borderBottom = "1px solid #3a3a3a";

    // Add player column
    const playerCell = document.createElement("td");
    playerCell.textContent = nickname;
    playerCell.style.padding = "8px";
    playerCell.style.borderBottom = "1px solid #3a3a3a";

    row.appendChild(guessCell);
    row.appendChild(playerCell);

    // Add similarity values from each verifier
    let totalSimilarity = 0;
    let verifierCount = 0;

    gameState.players.forEach((playerId) => {
      const verifierCell = document.createElement("td");
      verifierCell.style.textAlign = "center";
      verifierCell.style.padding = "8px";
      verifierCell.style.borderBottom = "1px solid #3a3a3a";

      if (results.has(playerId)) {
        const result = results.get(playerId);
        verifierCell.textContent = result.similarity.toFixed(4); // Raw similarity value
        totalSimilarity += result.similarity;
        verifierCount++;
      } else {
        verifierCell.textContent = "N/A";
      }

      row.appendChild(verifierCell);
    });

    // Add consensus column
    const consensusCell = document.createElement("td");
    consensusCell.style.textAlign = "center";
    consensusCell.style.padding = "8px";
    consensusCell.style.borderBottom = "1px solid #3a3a3a";

    if (verifierCount > 0) {
      const avgSimilarity = totalSimilarity / verifierCount;
      consensusCell.textContent = avgSimilarity.toFixed(4); // Raw similarity value
    } else {
      consensusCell.textContent = "N/A";
    }

    row.appendChild(consensusCell);
    table.appendChild(row);
  });

  if (!foundResults) {
    const noResultsRow = document.createElement("tr");
    const noResultsCell = document.createElement("td");
    noResultsCell.colSpan = 3 + gameState.players.length;
    noResultsCell.textContent = "No guesses were made in this round.";
    noResultsCell.style.textAlign = "center";
    noResultsCell.style.padding = "20px";
    noResultsRow.appendChild(noResultsCell);
    table.appendChild(noResultsRow);
  }

  summaryContainer.appendChild(table);

  // Add info text about next round
  const nextRoundInfo = document.createElement("p");
  nextRoundInfo.textContent = "Next round starting soon...";
  nextRoundInfo.style.marginTop = "20px";
  nextRoundInfo.style.textAlign = "center";
  summaryContainer.appendChild(nextRoundInfo);

  // Add close button
  const closeButton = document.createElement("button");
  closeButton.textContent = "Close";
  closeButton.style.marginTop = "15px";
  closeButton.style.padding = "8px 16px";
  closeButton.style.backgroundColor = "#000";
  closeButton.style.color = "#b0d944";
  closeButton.style.border = "1px solid #b0d944";
  closeButton.style.borderRadius = "5px";
  closeButton.style.cursor = "pointer";
  closeButton.style.display = "block";
  closeButton.style.margin = "15px auto 0";

  closeButton.addEventListener("click", () => {
    document.body.removeChild(summaryContainer);
  });

  summaryContainer.appendChild(closeButton);
  document.body.appendChild(summaryContainer);

  // Auto-close after 7 seconds (before next round starts)
  setTimeout(() => {
    if (document.body.contains(summaryContainer)) {
      document.body.removeChild(summaryContainer);
    }
  }, 7000);
}

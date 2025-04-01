// Game state and core game logic
import { words } from "./words.js";
import { spawn } from "child_process";
import { updateGameState, updateScoresDisplay } from "./ui.js";
import { broadcastGameState } from "./networking.js";

// Game state object
export const gameState = {
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
  verificationResults: new Map(),
  pendingVotes: new Map(),
  voteResults: new Map(),
};

// Core game functions
export function startNewRound() {
  gameState.roundInProgress = true;
  gameState.guesses.clear();
  gameState.timeLeft = gameState.roundTime;

  // Select drawer based on round number
  gameState.currentDrawer =
    gameState.players[gameState.currentRound % gameState.players.length];
  gameState.currentWord = words[Math.floor(Math.random() * words.length)];

  // Update UI
  updateGameState();
  startTimer();
  broadcastGameState();
}

export function endRound() {
  gameState.roundInProgress = false;
  const timerElement = document.querySelector("#timer");

  if (window.timerInterval) {
    clearInterval(window.timerInterval);
  }
  timerElement.textContent = "Round ended!";

  showRoundVerificationResults();
  gameState.currentRound++;

  if (gameState.currentRound >= gameState.maxRounds) {
    setTimeout(endGame, 5000);
    return;
  }

  const currentDrawerIndex = gameState.players.indexOf(gameState.currentDrawer);
  const nextDrawerIndex = (currentDrawerIndex + 1) % gameState.players.length;
  gameState.currentDrawer = gameState.players[nextDrawerIndex];
  gameState.currentWord = words[Math.floor(Math.random() * words.length)];

  updateGameState();
  broadcastGameState();
  setTimeout(startNewRound, 8000);
}

export function startTimer() {
  const timerElement = document.querySelector("#timer");
  if (window.timerInterval) {
    clearInterval(window.timerInterval);
  }

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

export function endGame() {
  // ... existing endGame code ...
}

// Word comparison function
export function compareWords(word1, word2) {
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

export function calculatePoints(similarity) {
  if (similarity >= 0.95) return 3;
  if (similarity >= 0.85) return 2;
  if (similarity >= 0.65) return 1;
  return 0;
}

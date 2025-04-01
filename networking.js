import Hyperswarm from "hyperswarm";
import crypto from "hypercore-crypto";
import b4a from "b4a";
import { gameState } from "./gameState.js";
import { drawLine, floodFill, clearCanvas } from "./drawing.js";
import {
  updateGameState,
  updateScoresDisplay,
  updateChatMessages,
  showNotification,
} from "./ui.js";

export const swarm = new Hyperswarm();

export async function createGameRoom(nickname) {
  const topicBuffer = crypto.randomBytes(32);
  await joinSwarm(topicBuffer, nickname);
}

export async function joinGameRoom(e, nickname) {
  const topicStr = document.querySelector("#join-chat-room-topic").value;
  const topicBuffer = b4a.from(topicStr, "hex");
  await joinSwarm(topicBuffer, nickname);
}

export async function joinSwarm(topicBuffer, nickname) {
  document.querySelector("#setup").classList.add("hidden");
  document.querySelector("#loading").classList.remove("hidden");

  const discovery = swarm.join(topicBuffer, { client: true, server: true });
  await discovery.flushed();

  const topic = b4a.toString(topicBuffer, "hex");
  document.querySelector("#chat-room-topic").innerText = topic;
  document.querySelector("#loading").classList.add("hidden");
  document.querySelector("#game-board").classList.remove("hidden");

  const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);
  gameState.scores.set(myId, 0);
  gameState.nicknames.set(myId, nickname);

  broadcastGameState();
  updateScoresDisplay();
}

export function broadcastGameState() {
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

export function handleGameData(data) {
  try {
    const gameData = JSON.parse(data.toString());

    switch (gameData.type) {
      case "draw":
        const originalColor = currentColor;
        const originalTool = currentTool;
        currentColor = gameData.color;
        currentTool = gameData.tool;

        drawLine(gameData.fromX, gameData.fromY, gameData.toX, gameData.toY);

        currentColor = originalColor;
        currentTool = originalTool;
        break;

      case "aiGuess":
        gameState.guesses.set(gameData.playerId, gameData.guess);
        gameState.scores.set(gameData.playerId, gameData.currentScore);
        updateChatMessages();
        updateScoresDisplay();
        break;

      case "gameState":
        const newState = gameData.state;
        const existingNicknames = new Map(gameState.nicknames);
        const newNicknames = new Map(Object.entries(newState.nicknames || {}));

        for (const [playerId, nickname] of newNicknames) {
          if (nickname) {
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

        if (gameState.roundInProgress) {
          if (window.timerInterval) {
            clearInterval(window.timerInterval);
          }
          startTimer();
        } else {
          if (window.timerInterval) {
            clearInterval(window.timerInterval);
          }
          document.querySelector("#timer").textContent = "";
        }
        break;

      case "clear":
        clearCanvas();
        break;

      case "fill":
        floodFill(gameData.x, gameData.y, gameData.color);
        break;

      case "timerUpdate":
        gameState.timeLeft = gameData.timeLeft;
        document.querySelector(
          "#timer"
        ).textContent = `Time left: ${gameState.timeLeft}s`;
        break;

      case "verifyGuess":
        processGuessVerification(gameData);
        break;

      case "verificationResult":
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

swarm.on("connection", (peer) => {
  const name = b4a.toString(peer.remotePublicKey, "hex").substr(0, 6);

  peer.on("data", (data) => {
    handleGameData(data);
  });

  peer.on("error", (e) => {
    console.error(`Connection error with peer ${name}:`, e);
  });

  peer.on("close", () => {
    console.log(`Peer ${name} disconnected`);
  });
});

swarm.on("update", () => {
  const peersCount = document.querySelector("#peers-count");
  if (peersCount) {
    peersCount.textContent = swarm.connections.size;
  }
});

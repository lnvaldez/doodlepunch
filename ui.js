import { gameState } from "./gameState.js";
import { swarm } from "./networking.js";
import b4a from "b4a";

export function updateGameState() {
  const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);
  const isDrawer = gameState.currentDrawer === myId;

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

  document.querySelector("#tools").style.display =
    isDrawer && gameState.roundInProgress ? "flex" : "none";
  document.querySelector("#guessing-area").style.display = isDrawer
    ? "none"
    : "flex";
  document.querySelector("#start-game").style.display = "none";
}

export function updateScoresDisplay() {
  const scoresElement = document.querySelector("#scores");
  scoresElement.innerHTML = "";

  const myId = b4a.toString(swarm.keyPair.publicKey, "hex").substr(0, 6);

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
      if (!nickname) nickname = `Player ${playerId.substr(0, 4)}`;
    }
    const scoreElement = document.createElement("div");
    scoreElement.className = "player-score";
    scoreElement.innerHTML = `<span>${nickname}: ${score}</span>`;
    scoresElement.appendChild(scoreElement);
  });
}

export function updateChatMessages() {
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

    if (typeof guessData === "string") {
      messageElement.innerHTML = `<span>${nickname}: ${guessData}</span>`;
    } else if (guessData.pending) {
      messageElement.innerHTML = `
        <div class="guess-result">
          <span class="guess-text">${nickname}: ${guessData.text}</span>
          <span class="guess-pending">Verification in progress...</span>
        </div>
      `;
    } else {
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

      let displayText = guessData.text;
      if (isCorrect && playerId !== myId && !isDrawer) {
        displayText = "Correct word! ✓";
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

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

export function showNotification(message, duration = 3000) {
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

  notificationContainer.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = "1";
  }, 10);

  setTimeout(() => {
    notification.style.opacity = "0";
    setTimeout(() => {
      notificationContainer.removeChild(notification);
    }, 300);
  }, duration);
}

export function showRoundVerificationResults() {
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

  const heading = document.createElement("h2");
  heading.textContent = `Round ${
    gameState.currentRound + 1
  } Verification Results`;
  summaryContainer.appendChild(heading);

  const wordInfo = document.createElement("p");
  wordInfo.textContent = `The word was: ${gameState.currentWord}`;
  wordInfo.style.fontSize = "18px";
  wordInfo.style.marginBottom = "20px";
  summaryContainer.appendChild(wordInfo);

  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.marginTop = "15px";

  const headerRow = document.createElement("tr");
  const headers = [
    "Guess",
    "Player",
    ...gameState.players.map(
      (playerId) =>
        gameState.nicknames.get(playerId) || `Player ${playerId.substr(0, 4)}`
    ),
    "Consensus",
  ];

  headers.forEach((headerText) => {
    const header = document.createElement("th");
    header.textContent = headerText;
    header.style.textAlign = headerText === "Guess" ? "left" : "center";
    header.style.padding = "8px";
    header.style.borderBottom = "1px solid #b0d944";
    headerRow.appendChild(header);
  });

  table.appendChild(headerRow);

  let foundResults = false;
  gameState.verificationResults.forEach((results, guessId) => {
    const row = document.createElement("tr");
    const [guessingPlayerId] = guessId.split("-");
    const guessData = Array.from(gameState.guesses.entries()).find(
      ([pid]) => pid === guessingPlayerId
    );

    if (!guessData) return;

    foundResults = true;
    const guessText = guessData[1].text;
    const nickname =
      gameState.nicknames.get(guessingPlayerId) ||
      `Player ${guessingPlayerId.substr(0, 4)}`;

    [guessText, nickname].forEach((text) => {
      const cell = document.createElement("td");
      cell.textContent = text;
      cell.style.padding = "8px";
      cell.style.borderBottom = "1px solid #3a3a3a";
      row.appendChild(cell);
    });

    let totalSimilarity = 0;
    let verifierCount = 0;

    gameState.players.forEach((playerId) => {
      const verifierCell = document.createElement("td");
      verifierCell.style.textAlign = "center";
      verifierCell.style.padding = "8px";
      verifierCell.style.borderBottom = "1px solid #3a3a3a";

      if (results.has(playerId)) {
        const result = results.get(playerId);
        verifierCell.textContent = result.similarity.toFixed(4);
        totalSimilarity += result.similarity;
        verifierCount++;
      } else {
        verifierCell.textContent = "N/A";
      }

      row.appendChild(verifierCell);
    });

    const consensusCell = document.createElement("td");
    consensusCell.style.textAlign = "center";
    consensusCell.style.padding = "8px";
    consensusCell.style.borderBottom = "1px solid #3a3a3a";

    if (verifierCount > 0) {
      consensusCell.textContent = (totalSimilarity / verifierCount).toFixed(4);
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

  const nextRoundInfo = document.createElement("p");
  nextRoundInfo.textContent = "Next round starting soon...";
  nextRoundInfo.style.marginTop = "20px";
  nextRoundInfo.style.textAlign = "center";
  summaryContainer.appendChild(nextRoundInfo);

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

  setTimeout(() => {
    if (document.body.contains(summaryContainer)) {
      document.body.removeChild(summaryContainer);
    }
  }, 7000);
}

export function showVerificationSummary() {
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

  const heading = document.createElement("h2");
  heading.textContent = "Verification Results";
  summaryContainer.appendChild(heading);

  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.marginTop = "15px";

  const headerRow = document.createElement("tr");
  const headers = [
    "Guess",
    "Player",
    ...gameState.players.map(
      (playerId) =>
        gameState.nicknames.get(playerId) || `Player ${playerId.substr(0, 4)}`
    ),
    "Consensus",
  ];

  headers.forEach((headerText) => {
    const header = document.createElement("th");
    header.textContent = headerText;
    header.style.textAlign = headerText === "Guess" ? "left" : "center";
    header.style.padding = "8px";
    header.style.borderBottom = "1px solid #b0d944";
    headerRow.appendChild(header);
  });

  table.appendChild(headerRow);

  gameState.verificationResults.forEach((results, guessId) => {
    const row = document.createElement("tr");
    const [guessingPlayerId] = guessId.split("-");
    const guessData = Array.from(gameState.guesses.entries()).find(
      ([pid]) => pid === guessingPlayerId
    );

    if (!guessData) return;

    const guessText = guessData[1].text;
    const nickname =
      gameState.nicknames.get(guessingPlayerId) ||
      `Player ${guessingPlayerId.substr(0, 4)}`;

    [guessText, nickname].forEach((text) => {
      const cell = document.createElement("td");
      cell.textContent = text;
      cell.style.padding = "8px";
      cell.style.borderBottom = "1px solid #3a3a3a";
      row.appendChild(cell);
    });

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

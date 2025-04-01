# DoodlePunch

DoodlePunch is a multiplayer P2P drawing and guessing game built with decentralized networking and AI-powered guess evaluation.

## Features

- 🎨 Real-time collaborative drawing canvas
- 🔍 AI-powered guess validation using spaCy word vectors
- 🌐 Peer-to-peer networking with Hyperswarm
- 📊 Score tracking and leaderboards
- ⏱ Round timer with dynamic adjustments
- 🤖 Automated similarity scoring system
- 🔒 End-to-end encrypted peer connections
- 📱 Responsive UI with dark theme

## Technology Stack

- **Frontend**: HTML5 Canvas, Vanilla JavaScript
- **P2P Networking**: Hyperswarm (via Pear SDK)
- **AI Validation**: Python + spaCy (en_core_web_lg model)

## Prerequisites

- Node.js v16+
- Python 3.8+
- spaCy English language model

## Installation

1. Ensure you have:

   - Node.js v16+
   - Python 3.x

2. Clone and setup:

```bash
git clone https://github.com/lnvaldez/doodlepunch.git
cd doodlepunch
npm install
pip install -r requirements.txt
python -m spacy download en_core_web_lg
```

3. Run the Game

```bash
npm run dev
```

## How to Play
**Create or Join Game**
- Enter nickname
- Create new room or join with existing topic

**Game Flow**
- Drawer: Receives secret word to draw
- Guessers: Type guesses in real-time
- AI Validation: Guesses scored by semantic similarity
- Scoring: Points awarded based on similarity thresholds

 **Round Structure**
- 60-second rounds
- 5 rounds per game
- Dynamic timer (halved on correct guesses) **

 **Tools**
- Pen/Eraser with color picker
- Bucket fill tool
- Canvas clearing


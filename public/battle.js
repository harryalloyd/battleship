const socket = io();

// DOM elements
const messages      = document.getElementById("messages");
const readyBtn      = document.getElementById("readyBtn");
const doneBtn       = document.getElementById("doneBtn");
const playerBoard   = document.getElementById("player-board");
const opponentBoard = document.getElementById("opponent-board");

// Chat
const chatMessages = document.getElementById("chat-messages");
const chatInput    = document.getElementById("chat-input");
const chatSend     = document.getElementById("chat-send");

// Spinner (waiting overlay)
const spinner = document.getElementById("spinner");

// Username overlay
const usernameOverlay = document.getElementById("username-overlay");
const usernameInput   = document.getElementById("username-input");
const usernameBtn     = document.getElementById("username-btn");

// Show the spinner initially, waiting for second player
spinner.classList.remove('hidden');

// Game state
let myPlayerNumber = null;
let shipsPlaced = 0;
const maxShips = 3;
let canPlaceShips = false;
let isDonePlacing = false;
const myShipCells = new Set();

let isMyTurn = false;
let currentRoom = null;
let firedThisTurn = false; 

// Win condition
let myShipCount = 0;    
let enemyShipCount = 3; 

let gameEnded = false;

//** We'll store username here, and let the user pick it after spinner is gone. */
let myUsername = "Me";
let opponentUsername = "Opponent";

//------------------------------------------
// Socket Listeners
//------------------------------------------

socket.on("connect", () => {
  console.log("// DEBUG: Client connected, ID =", socket.id);
});

socket.on("playerNumber", (num) => {
  myPlayerNumber = num;
  console.log("// DEBUG: I am Player", num);

  // Initially disable boards
  playerBoard.style.pointerEvents = "none";
  opponentBoard.style.pointerEvents = "none";
});

socket.on("message", (msg) => {
  addMessage(msg);
  console.log("// DEBUG: [message] =>", msg);
});

// If both players are ready, let's hide spinner + show username overlay
socket.on("bothPlayersReady", () => {
  addMessage("Both players ready. Place your 3 ships!");
  canPlaceShips = true;
  enemyShipCount = 3;

  // Hide the spinner
  spinner.classList.add('hidden');

  // Show the username overlay for the user to pick a name
  usernameOverlay.classList.remove('hidden');

  if (myPlayerNumber === "1") {
    playerBoard.style.pointerEvents = "auto";
  } else {
    opponentBoard.style.pointerEvents = "auto";
  }
});

// Once both players are done placing ships
socket.on("bothPlayersDone", () => {
  addMessage("Both players placed ships! Let the battle begin.");
  playerBoard.style.pointerEvents = "none";
  opponentBoard.style.pointerEvents = "none";
});

// Turn event
socket.on("turn", (playerId) => {
  isMyTurn = false;
  firedThisTurn = false;

  playerBoard.style.pointerEvents = "none";
  opponentBoard.style.pointerEvents = "none";

  if (playerId === socket.id) {
    isMyTurn = true;
    addMessage("It's your turn to fire!");
    if (!gameEnded) {
      getOpponentBoard().style.pointerEvents = "auto";
    }
  } else {
    addMessage(`${opponentUsername}'s turn. Please wait.`);
  }
});

// Opponent fired => check if it's a hit
socket.on("fired", ({ x, y }) => {
  const cellId = (myPlayerNumber === "1")
    ? `player-${x + y * 10}`
    : `opponent-${x + y * 10}`;

  const cell = document.getElementById(cellId);
  if (!cell) return;

  if (myShipCells.has(cellId)) {
    cell.classList.add("hit");
    myShipCount--;
    if (myShipCount === 0) {
      addMessage("You Lost!");
      endGame();
    }
    socket.emit("fireResult", { room: currentRoom, x, y, result: "hit" });
  } else {
    cell.classList.add("miss");
    socket.emit("fireResult", { room: currentRoom, x, y, result: "miss" });
  }
});

// Our shot outcome
socket.on("fireResultForShooter", ({ x, y, result }) => {
  let cellId;
  if (myPlayerNumber === "1") {
    cellId = `opponent-${x + y * 10}`;
  } else {
    cellId = `player-${x + y * 10}`;
  }

  const cell = document.getElementById(cellId);
  if (!cell) return;

  if (result === "hit") {
    cell.classList.add("hit");
    addMessage(`Shot at (${x}, ${y}) was a HIT!`);
    enemyShipCount--;
    if (enemyShipCount === 0) {
      addMessage("You Won!");
      endGame();
    }
  } else {
    cell.classList.add("miss");
    addMessage(`Shot at (${x}, ${y}) was a miss.`);
  }
});

// Assign the room
socket.on("assignRoom", (roomName) => {
  currentRoom = roomName;
  console.log("// DEBUG: assignRoom =>", roomName);
});

// Error event
socket.on("error", (msg) => {
  addMessage("Error: " + msg);
  console.warn("// DEBUG [server error]:", msg);
});

// ========== Chat Logic ==========
socket.on("chatMessage", ({ from, text }) => {
  if (from === socket.id) {
    return; // we already displayed "Me: text"
  }
  // Otherwise, show "opponentUsername: text"
  addChatMessage(opponentUsername, text);
});

//------------------------------------------
// DOM event listeners
//------------------------------------------

readyBtn.addEventListener("click", () => {
  socket.emit("playerReady");
  readyBtn.disabled = true;
});

doneBtn.addEventListener("click", () => {
  if (shipsPlaced === maxShips) {
    isDonePlacing = true;
    doneBtn.disabled = true;
    socket.emit("playerDone");
    myShipCount = 3;
    if (myPlayerNumber === "1") {
      playerBoard.style.pointerEvents = "none";
    } else {
      opponentBoard.style.pointerEvents = "none";
    }
  }
});

// Chat
chatSend.addEventListener("click", () => {
  const text = chatInput.value.trim();
  if (text) {
    addChatMessage(myUsername, text);
    socket.emit("chatMessage", text);
    chatInput.value = "";
  }
});
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    chatSend.click();
  }
});

// Username
usernameBtn.addEventListener("click", () => {
  const name = usernameInput.value.trim();
  if (name) {
    myUsername = name;
    // Optionally, guess that the other player's username is something else 
    // or show "???". Or you can exchange username info via server if you want.
    opponentUsername = "???";

    usernameOverlay.classList.add('hidden');
  }
});

//------------------------------------------
// Helper Functions
//------------------------------------------

function getOpponentBoard() {
  return (myPlayerNumber === "1") ? opponentBoard : playerBoard;
}

function endGame() {
  gameEnded = true;
  isMyTurn = false;
  playerBoard.style.pointerEvents = "none";
  opponentBoard.style.pointerEvents = "none";
}

function createBoard(board, prefix) {
  board.style.pointerEvents = "none";
  for (let i = 0; i < 100; i++) {
    const cell = document.createElement("div");
    cell.id = `${prefix}-${i}`;
    board.appendChild(cell);

    cell.addEventListener("click", () => {
      if (!isDonePlacing && canPlaceShips) {
        handlePlacement(prefix, cell);
      } else if (isDonePlacing && isMyTurn) {
        handleFiring(prefix, i);
      } else if (!isMyTurn) {
        addMessage("It's not your turn!");
      } else {
        addMessage("You must place your ships first!");
      }
    });
  }
}
function handlePlacement(prefix, cell) {
  if (shipsPlaced >= maxShips) return;

  const isCorrectBoard =
    (myPlayerNumber === "1" && prefix === "player") ||
    (myPlayerNumber === "2" && prefix === "opponent");

  if (!isCorrectBoard) {
    addMessage("That's your own board, you can't fire there.");
    return;
  }

  if (!cell.classList.contains("ship")) {
    cell.classList.add("ship");
    myShipCells.add(cell.id);
    shipsPlaced++;
    if (shipsPlaced === maxShips) {
      addMessage("All your ships placed!");
      doneBtn.disabled = false;
    }
  }
}
function handleFiring(prefix, index) {
  if (firedThisTurn) return;

  const isOpponentBoard =
    (myPlayerNumber === "1" && prefix === "opponent") ||
    (myPlayerNumber === "2" && prefix === "player");

  if (!isOpponentBoard) {
    addMessage("That's your own board, can't fire there.");
    return;
  }

  firedThisTurn = true;
  isMyTurn = false;
  playerBoard.style.pointerEvents = "none";
  opponentBoard.style.pointerEvents = "none";

  const x = index % 10;
  const y = Math.floor(index / 10);
  socket.emit("fire", { room: currentRoom, x, y });
}
function addMessage(text) {
  const div = document.createElement("div");
  div.textContent = text;
  messages.appendChild(div);
}
function addChatMessage(sender, msg) {
  const div = document.createElement("div");
  div.textContent = sender + ": " + msg;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Build boards
createBoard(playerBoard, "player");
createBoard(opponentBoard, "opponent");

const socket = io();

// DOM
const messages      = document.getElementById("messages");
const readyBtn      = document.getElementById("readyBtn");
const doneBtn       = document.getElementById("doneBtn");
const rematchBtn    = document.getElementById("rematchBtn");  // <--- NEW
const playerHead    = document.getElementById("player-heading");
const oppHead       = document.getElementById("opponent-heading");
const playerBoard   = document.getElementById("player-board");
const opponentBoard = document.getElementById("opponent-board");

// Chat
const chatMessages = document.getElementById("chat-messages");
const chatInput    = document.getElementById("chat-input");
const chatSend     = document.getElementById("chat-send");

// Overlays
const spinner         = document.getElementById("spinner");
const usernameOverlay = document.getElementById("username-overlay");
const usernameInput   = document.getElementById("username-input");
const usernameBtn     = document.getElementById("username-btn");

// Show spinner initially
spinner.classList.remove("hidden");

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
let myShipCount = 0;    
let enemyShipCount = 3;
let gameEnded = false;

// Usernames
let myUsername = "Me";
let opponentUsername = "Opponent";

//----------------------------------
// Socket events
//----------------------------------

socket.on("connect", () => {
  console.log("// DEBUG: connected =>", socket.id);
});

socket.on("assignRoom", (roomName) => {
  currentRoom = roomName;
  console.log("// DEBUG: assignRoom =>", roomName);
});

// As soon as second player arrives, hide spinner & show username overlay
socket.on("bothPlayersConnected", () => {
  spinner.classList.add("hidden");
  usernameOverlay.classList.remove("hidden");
});

socket.on("playerNumber", (num) => {
  myPlayerNumber = num;
  console.log("// DEBUG: I am playerNumber =", num);
});

socket.on("message", (msg) => {
  addMessage(msg);
});

// The server sends the updated user names
socket.on("updateUsernames", ({ p1, p2 }) => {
  if (myPlayerNumber === "1") {
    myUsername       = p1;
    opponentUsername = p2;
    playerHead.textContent   = myUsername + "'s Board";
    oppHead.textContent      = opponentUsername + "'s Board";
  } else {
    myUsername       = p2;
    opponentUsername = p1;
    playerHead.textContent   = opponentUsername + "'s Board";
    oppHead.textContent      = myUsername + "'s Board";
  }
});

// Wait for both players "Ready"
socket.on("bothPlayersReady", () => {
  addMessage("Both players ready. Place your 3 ships!");
  canPlaceShips = true;
  enemyShipCount = 3;

  if (myPlayerNumber === "1") {
    playerBoard.style.pointerEvents = "auto";
  } else {
    opponentBoard.style.pointerEvents = "auto";
  }
});

// Both done placing
socket.on("bothPlayersDone", () => {
  addMessage("Both players placed ships! Let the battle begin.");
  playerBoard.style.pointerEvents = "none";
  opponentBoard.style.pointerEvents = "none";
});

// "turn" => who fires
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
    addMessage(opponentUsername + "'s turn. Please wait.");
  }
});

// Opponent fired => see if it's a hit
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

// We see the result of our shot
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

// Chat
socket.on("chatMessage", ({ from, username, text }) => {
  if (from === socket.id) return; 
  addChatMessage(username, text);
});

// ========== REMATCH ==========
// If both players requested => "rematchStart"
socket.on("rematchStart", () => {
  // Reset local states
  gameEnded = false;
  isMyTurn  = false;
  firedThisTurn = false;
  shipsPlaced   = 0;
  isDonePlacing = false;
  myShipCount   = 0;
  enemyShipCount= 3;
  myShipCells.clear();

  // Clear boards: remove 'hit', 'miss', 'ship'
  for (let i = 0; i < 100; i++) {
    const pCell = document.getElementById("player-"+ i);
    const oCell = document.getElementById("opponent-"+ i);
    pCell.className = ""; // remove all classes
    oCell.className = "";
  }

  // Re-enable the "Ready" button if you want them to re-place ships
  readyBtn.disabled   = false;
  doneBtn.disabled    = true;
  rematchBtn.disabled = true; // can't re-rematch until next game ends

  addMessage("Rematch started! Click Ready to place ships again.");
});

//------------------------------------------
// DOM events
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

// ========== Rematch button (NEW) ==========
rematchBtn.addEventListener("click", () => {
  // I want a rematch => tell the server
  socket.emit("requestRematch");
  // disable so I can't spam
  rematchBtn.disabled = true;
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
  const chosenName = usernameInput.value.trim();
  if (!chosenName) return;

  socket.emit("setUsername", chosenName);
  usernameOverlay.classList.add("hidden");
});

//------------------------------------------
// Helper Functions
//------------------------------------------

function getOpponentBoard() {
  return (myPlayerNumber === "1") ? opponentBoard : playerBoard;
}

// Called when user wins or loses
function endGame() {
  gameEnded = true;
  isMyTurn  = false;
  playerBoard.style.pointerEvents   = "none";
  opponentBoard.style.pointerEvents = "none";

  // Let me click Rematch if I want
  rematchBtn.disabled = false;
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

  const correctBoard =
    (myPlayerNumber === "1" && prefix === "player") ||
    (myPlayerNumber === "2" && prefix === "opponent");
  if (!correctBoard) {
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
  playerBoard.style.pointerEvents   = "none";
  opponentBoard.style.pointerEvents= "none";

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

const rulesToggle = document.getElementById("rules-toggle");
const rulesBox    = document.getElementById("rules-box");

// On click, toggle "hidden"
rulesToggle.addEventListener("click", () => {
  rulesBox.classList.toggle("hidden");
});
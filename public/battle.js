const socket = io();

const messages = document.getElementById("messages");
const readyBtn = document.getElementById("readyBtn");
const doneBtn = document.getElementById("doneBtn");

const playerBoard = document.getElementById("player-board");
const opponentBoard = document.getElementById("opponent-board");

let myPlayerNumber = null;

let shipsPlaced = 0;
const maxShips = 3;
let canPlaceShips = false;
let isDonePlacing = false;

/**
 * We'll store the coordinates (or cell IDs) of our placed ships
 * so we can distinguish hits from misses.
 */
const myShipCells = new Set(); // e.g. "player-32", "opponent-47", etc.

let isMyTurn = false;  // Are we allowed to fire?
let currentRoom = null; // The room assigned by server

// ----- Socket Listeners -----

// 1) Server says "You are player #1 or #2"
socket.on("playerNumber", (num) => {
  myPlayerNumber = num;
});

// 2) Basic text messages from server
socket.on("message", (msg) => {
  addMessage(msg);
});

// 3) Both players clicked "Ready" => we can place ships
socket.on("bothPlayersReady", () => {
  addMessage("Both players ready. Place your 3 ships!");
  canPlaceShips = true;
});

// 4) Both players clicked "Done" => start the battle
socket.on("bothPlayersDone", () => {
  addMessage("Both players have placed ships! Let the battle begin!");
});

// 5) The server notifies us whose turn it is
socket.on("turn", (playerId) => {
  if (playerId === socket.id) {
    isMyTurn = true;
    addMessage("It's your turn to fire!");
  } else {
    isMyTurn = false;
    addMessage("Opponent's turn. Please wait.");
  }
});

// 6) The opponent fires on us
socket.on("fired", ({ x, y }) => {
  const cellId = (myPlayerNumber === "1") 
    ? `player-${x + y * 10}` 
    : `opponent-${x + y * 10}`;

  const cell = document.getElementById(cellId);
  if (!cell) return; // safety check

  if (myShipCells.has(cellId)) {
    // HIT
    cell.classList.add("hit");
    socket.emit("fireResult", { room: currentRoom, x, y, result: "hit" });
  } else {
    // MISS
    cell.classList.add("miss");
    socket.emit("fireResult", { room: currentRoom, x, y, result: "miss" });
  }
});

// 7) We see the result of OUR shot
socket.on("fireResultForShooter", ({ x, y, result }) => {
  // For player 1, the opponent's board is "opponent-..."
  // For player 2, the opponent's board is "player-..."
  // Because whichever side is "not us" is the enemy board
  let cellId;
  if (myPlayerNumber === "1") {
    // we fire onto the "opponent" board
    cellId = `opponent-${x + y * 10}`;
  } else {
    // we are player 2, so we fire onto the "player" board
    cellId = `player-${x + y * 10}`;
  }

  const cell = document.getElementById(cellId);
  if (!cell) return;

  if (result === "hit") {
    cell.classList.add("hit");
    addMessage(`Your shot at (${x}, ${y}) was a HIT!`);
  } else {
    cell.classList.add("miss");
    addMessage(`Your shot at (${x}, ${y}) was a miss.`);
  }
});

// 8) If the server assigns a "room"
socket.on("assignRoom", (roomName) => {
  currentRoom = roomName;
});

// ----- DOM Setup & Event Handlers -----

readyBtn.addEventListener("click", () => {
  socket.emit("playerReady");
  readyBtn.disabled = true; 
});

doneBtn.addEventListener("click", () => {
  if (shipsPlaced === maxShips) {
    isDonePlacing = true;
    doneBtn.disabled = true;
    socket.emit("playerDone");
  }
});

// Build the two boards side-by-side
// By naming them "player" and "opponent", we let player1 place ships on "player"
// and player2 place ships on "opponent"
createBoard(playerBoard,  "player");
createBoard(opponentBoard,"opponent");

/**
 * Creates a 10×10 grid. 
 * If boardIdPrefix === "player", Player1 places ships, 
 * If boardIdPrefix === "opponent", Player2 places ships,
 * and vice versa for firing logic.
 */
function createBoard(board, boardIdPrefix) {
  for (let i = 0; i < 100; i++) {
    const cell = document.createElement("div");
    cell.id = `${boardIdPrefix}-${i}`;
    board.appendChild(cell);

    cell.addEventListener("click", () => {
      // Are we placing ships or firing?
      if (!isDonePlacing && canPlaceShips) {
        handlePlacement(boardIdPrefix, cell);
      } else if (isDonePlacing && isMyTurn) {
        handleFiring(boardIdPrefix, i);
      } else if (!isMyTurn) {
        addMessage("It's not your turn!");
      } else {
        addMessage("You must place all ships first!");
      }
    });
  }
}

/**
 * Handle placing a ship on the correct side if it's "my" board
 */
function handlePlacement(boardIdPrefix, cell) {
  // If we've placed all ships, do nothing
  if (shipsPlaced >= maxShips) return;

  // Check if this board belongs to me
  // Player 1 => "player" board
  // Player 2 => "opponent" board
  if ((myPlayerNumber === "1" && boardIdPrefix === "player") ||
      (myPlayerNumber === "2" && boardIdPrefix === "opponent")) {

    if (!cell.classList.contains("ship")) {
      cell.classList.add("ship");
      myShipCells.add(cell.id);
      shipsPlaced++;
      if (shipsPlaced === maxShips) {
        addMessage("All your ships placed!");
        doneBtn.disabled = false;
      }
    }
  } else {
    // This board does not belong to you
    addMessage("You can only place ships on your own board.");
  }
}

/**
 * Handle firing on the opponent's board
 */
function handleFiring(boardIdPrefix, index) {
  // Only allow firing if the board is indeed the opponent's
  // For Player 1, the "opponent" board is labeled "opponent"
  // For Player 2, the "opponent" board is labeled "player"
  if ((myPlayerNumber === "1" && boardIdPrefix === "opponent") ||
      (myPlayerNumber === "2" && boardIdPrefix === "player")) {

    const x = index % 10;
    const y = Math.floor(index / 10);
    fireAt(x, y);
  } else {
    addMessage("That's your own board, you can't fire there.");
  }
}

/**
 * Actually fire at (x, y) on the opponent's board.
 */
function fireAt(x, y) {
  if (!currentRoom) {
    // fallback if server never assigned a room
    currentRoom = socket.id;
  }
  socket.emit("fire", { room: currentRoom, x, y });
}

/** Logging messages */
function addMessage(text) {
  const div = document.createElement("div");
  div.textContent = text;
  messages.appendChild(div);
}

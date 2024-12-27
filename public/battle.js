const socket = io();

// Just for debugging, see if we connect
socket.on("connect", () => {
  console.log("Client connected! My ID is:", socket.id);
});

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

// Where we track which cells on "my" board have ships
const myShipCells = new Set();

let isMyTurn = false;
let currentRoom = null; // assigned by server or fallback

// ===== Socket Listeners =====

// 1) We are "1" or "2"
socket.on("playerNumber", (num) => {
  myPlayerNumber = num;
  console.log("I am Player", myPlayerNumber);
});

// 2) Show messages from server
socket.on("message", (msg) => {
  addMessage(msg);
});

// 3) bothPlayersReady => place ships
socket.on("bothPlayersReady", () => {
  addMessage("Both players ready. Place your 3 ships!");
  canPlaceShips = true;
});

// 4) bothPlayersDone => time to battle
socket.on("bothPlayersDone", () => {
  addMessage("Both players have placed ships! Let the battle begin!");
});

// 5) "turn" => set isMyTurn = (playerId === socket.id)
socket.on("turn", (playerId) => {
  console.log("Received turn event. playerId =", playerId, "myId =", socket.id);
  if (playerId === socket.id) {
    isMyTurn = true;
    addMessage("It's your turn to fire!");
  } else {
    isMyTurn = false;
    addMessage("Opponent's turn. Please wait.");
  }
});

// 6) "fired" => opponent shot at (x,y). We see if it's a hit or miss.
socket.on("fired", ({ x, y }) => {
  console.log("Opponent fired on us at", x, y);
  // If I'm player1, my board is "player-...", else "opponent-..."
  const cellId = (myPlayerNumber === "1")
    ? `player-${x + y * 10}`
    : `opponent-${x + y * 10}`;

  const cell = document.getElementById(cellId);
  if (!cell) return;

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

// 7) "fireResultForShooter" => the result of our shot
socket.on("fireResultForShooter", ({ x, y, result }) => {
  console.log("We got fireResultForShooter", x, y, result);
  let cellId;
  if (myPlayerNumber === "1") {
    // we attack the "opponent-..." board
    cellId = `opponent-${x + y * 10}`;
  } else {
    // we are player2 => we attack the "player-..." board
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

// 8) If server assigns a "room"
socket.on("assignRoom", (roomName) => {
  console.log("Assigned to room:", roomName);
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
createBoard(playerBoard, "player");
createBoard(opponentBoard, "opponent");

/**
 * Creates a 10×10 grid
 * If "player", Player1 places ships
 * If "opponent", Player2 places ships
 */
function createBoard(board, boardIdPrefix) {
  for (let i = 0; i < 100; i++) {
    const cell = document.createElement("div");
    cell.id = `${boardIdPrefix}-${i}`;
    board.appendChild(cell);

    cell.addEventListener("click", () => {
      if (!isDonePlacing && canPlaceShips) {
        // Place ships
        handlePlacement(boardIdPrefix, cell);
      } else if (isDonePlacing && isMyTurn) {
        // Fire if it's the correct board to attack
        handleFiring(boardIdPrefix, i);
      } else if (!isMyTurn) {
        addMessage("It's not your turn!");
      } else {
        addMessage("You must place all ships first!");
      }
    });
  }
}

// Place a ship on *my* board
function handlePlacement(boardIdPrefix, cell) {
  if (shipsPlaced >= maxShips) return;

  // Player1 => "player-..."
  // Player2 => "opponent-..."
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
    addMessage("That's your own board, you can't fire there.");
  }
}

// Fire at the *opponent’s* board
function handleFiring(boardIdPrefix, index) {
  // For P1, the opponent is "opponent-..."
  // For P2, the opponent is "player-..."
  if ((myPlayerNumber === "1" && boardIdPrefix === "opponent") ||
      (myPlayerNumber === "2" && boardIdPrefix === "player")) {

    const x = index % 10;
    const y = Math.floor(index / 10);
    fireAt(x, y);
  } else {
    addMessage("That's your own board, you can't fire there.");
  }
}

function fireAt(x, y) {
  if (!currentRoom) {
    // fallback if server never assigned
    currentRoom = socket.id;
  }
  socket.emit("fire", { room: currentRoom, x, y });
}

// Utility to log messages
function addMessage(text) {
  const div = document.createElement("div");
  div.textContent = text;
  messages.appendChild(div);
}

// battle.js

const socket = io();

// DOM elements
const messages = document.getElementById("messages");
const readyBtn = document.getElementById("readyBtn");
const doneBtn = document.getElementById("doneBtn");
const playerBoard = document.getElementById("player-board");
const opponentBoard = document.getElementById("opponent-board");

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

// ========== NEW: For Win Condition ==========
let myShipCount = 0;     // how many ships I have left
let enemyShipCount = 3;  // how many ships the opponent has left
// We'll set myShipCount=3 once we place all 3 ships

//--------------------------------------------------
//  Socket Listeners
//--------------------------------------------------

socket.on("connect", () => {
  console.log("// DEBUG: Client connected, ID =", socket.id);
});

socket.on("playerNumber", (num) => {
  myPlayerNumber = num;
  console.log("// DEBUG: I am Player", num);

  // Initially disable both boards
  playerBoard.style.pointerEvents = "none";
  opponentBoard.style.pointerEvents = "none";
});

socket.on("message", (msg) => {
  addMessage(msg);
  console.log("// DEBUG: [message] =>", msg);
});

// Both players ready => place ships
socket.on("bothPlayersReady", () => {
  addMessage("Both players ready. Place your 3 ships!");
  console.log("// DEBUG: bothPlayersReady => canPlaceShips=true");
  canPlaceShips = true;

  // Because the opponent is also placing exactly 3 ships
  enemyShipCount = 3; 

  // Enable pointer events on your own board only
  if (myPlayerNumber === "1") {
    playerBoard.style.pointerEvents = "auto";
  } else {
    opponentBoard.style.pointerEvents = "auto";
  }
});

// Both players done => disable boards, wait for turn
socket.on("bothPlayersDone", () => {
  addMessage("Both players placed ships! Let the battle begin.");
  console.log("// DEBUG: bothPlayersDone => disabling both boards, waiting for 'turn'");
  playerBoard.style.pointerEvents = "none";
  opponentBoard.style.pointerEvents = "none";
});

// "turn" => who fires next
socket.on("turn", (playerId) => {
  console.log("// DEBUG: 'turn' => belongs to", playerId, " (I am=", socket.id, ")");
  isMyTurn = false;
  firedThisTurn = false;
  playerBoard.style.pointerEvents = "none";
  opponentBoard.style.pointerEvents = "none";

  if (playerId === socket.id) {
    isMyTurn = true;
    addMessage("It's your turn to fire!");
    if (!gameEnded) {
      getOpponentBoardElement().style.pointerEvents = "auto";
    }
  } else {
    addMessage("Opponent's turn. Please wait.");
  }
});

// Opponent fired => see if it's hit or miss
socket.on("fired", ({ x, y }) => {
  console.log(`// DEBUG: 'fired' => Opponent shot at x=${x}, y=${y}`);
  const cellId = (myPlayerNumber === "1")
    ? `player-${x + y * 10}`
    : `opponent-${x + y * 10}`;

  const cell = document.getElementById(cellId);
  if (!cell) {
    console.log(`// DEBUG: can't find cellId=${cellId}, ignoring`);
    return;
  }

  if (myShipCells.has(cellId)) {
    console.log(`// DEBUG: Opponent HIT on ${cellId}`);
    cell.classList.add("hit");

    // Decrement myShipCount
    myShipCount--;
    if (myShipCount === 0) {
      addMessage("You Lost!");
      endGame();
    }

    socket.emit("fireResult", { room: currentRoom, x, y, result: "hit" });
  } else {
    console.log(`// DEBUG: Opponent MISS on ${cellId}`);
    cell.classList.add("miss");
    socket.emit("fireResult", { room: currentRoom, x, y, result: "miss" });
  }
});

// We get the outcome of our shot
socket.on("fireResultForShooter", ({ x, y, result }) => {
  let cellId;
  if (myPlayerNumber === "1") {
    cellId = `opponent-${x + y * 10}`;
  } else {
    cellId = `player-${x + y * 10}`;
  }

  console.log(`// DEBUG: 'fireResultForShooter' => x=${x}, y=${y}, result=${result}, cellId=${cellId}`);

  const cell = document.getElementById(cellId);
  if (!cell) {
    console.log(`// DEBUG: can't find cell=${cellId}`);
    return;
  }

  if (result === "hit") {
    cell.classList.add("hit");
    addMessage(`Shot at (${x}, ${y}) was a HIT!`);

    // Decrement enemyShipCount
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

// The server assigns a room
socket.on("assignRoom", (roomName) => {
  currentRoom = roomName;
  console.log("// DEBUG: assignRoom =>", roomName);
});

// If the server sends an "error" event
socket.on("error", (msg) => {
  addMessage("Error: " + msg);
  console.warn("// DEBUG [server error]:", msg);
});

//--------------------------------------------------
//  DOM Setup & Handlers
//--------------------------------------------------

//const readyBtn = document.getElementById("readyBtn");
//const doneBtn = document.getElementById("doneBtn");

readyBtn.addEventListener("click", () => {
  console.log("// DEBUG: readyBtn => clicked => playerReady");
  socket.emit("playerReady");
  readyBtn.disabled = true;
});

doneBtn.addEventListener("click", () => {
  console.log(`// DEBUG: doneBtn => clicked => shipsPlaced=${shipsPlaced}, maxShips=${maxShips}`);
  if (shipsPlaced === maxShips) {
    isDonePlacing = true;
    doneBtn.disabled = true;
    console.log("// DEBUG: Emitting playerDone => isDonePlacing=true");
    socket.emit("playerDone");

    // We have 3 ships placed => track them
    myShipCount = 3;  // Now we know how many ships WE have

    if (myPlayerNumber === "1") {
      playerBoard.style.pointerEvents = "none";
    } else {
      opponentBoard.style.pointerEvents = "none";
    }
  }
});

// Build boards
createBoard(playerBoard, "player");
createBoard(opponentBoard, "opponent");

/** 
 * If I'm Player1 => #opponent-board is where I fire
 * If I'm Player2 => #player-board is where I fire
 */
function getOpponentBoardElement() {
  if (myPlayerNumber === "1") {
    return opponentBoard;
  } else {
    return playerBoard;
  }
}

/** Just a helper to track if the game ended. */
let gameEnded = false;
function endGame() {
  gameEnded = true;
  isMyTurn = false;
  // disable boards
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
      console.log(`// DEBUG: CLICK cell=${cell.id}, isMyTurn=${isMyTurn}, canPlaceShips=${canPlaceShips}, isDonePlacing=${isDonePlacing}, firedThisTurn=${firedThisTurn}`);
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

//let firedThisTurn = false;
function handleFiring(prefix, index) {
  if (firedThisTurn) {
    console.log("// DEBUG: handleFiring => firedThisTurn=true => ignoring second shot");
    return;
  }

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

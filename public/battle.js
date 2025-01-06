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
let firedThisTurn = false; // local boolean to block repeated shots

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
  console.log("// DEBUG: bothPlayersReady => canPlaceShips=true for me");
  canPlaceShips = true;
  // Enable pointer events on your own board only
  if (myPlayerNumber === "1") {
    console.log("// DEBUG: I am P1 => enabling #player-board for ship placement");
    playerBoard.style.pointerEvents = "auto";
  } else {
    console.log("// DEBUG: I am P2 => enabling #opponent-board for ship placement");
    opponentBoard.style.pointerEvents = "auto";
  }
});

// Both players done => wait for turn
socket.on("bothPlayersDone", () => {
  addMessage("Both players placed ships! Let the battle begin.");
  console.log("// DEBUG: bothPlayersDone => disabling both boards, waiting for 'turn'");
  playerBoard.style.pointerEvents = "none";
  opponentBoard.style.pointerEvents = "none";
});

// Turn event => who fires next
socket.on("turn", (playerId) => {
  console.log("// DEBUG: 'turn' => belongs to", playerId, ", me=", socket.id);
  // Reset
  isMyTurn = false;
  firedThisTurn = false;
  // disable both boards by default
  playerBoard.style.pointerEvents = "none";
  opponentBoard.style.pointerEvents = "none";

  if (playerId === socket.id) {
    isMyTurn = true;
    addMessage("It's your turn to fire!");
    console.log("// DEBUG: It's my turn => enabling pointerEvents on opponent board");
    getOpponentBoardElement().style.pointerEvents = "auto";
  } else {
    addMessage("Opponent's turn. Please wait.");
    console.log("// DEBUG: It's the other player's turn");
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
    console.log(`// DEBUG: 'fired' => cannot find cellId=${cellId}, ignoring`);
    return;
  }

  if (myShipCells.has(cellId)) {
    console.log(`// DEBUG: That's a HIT on cellId=${cellId}`);
    cell.classList.add("hit");
    socket.emit("fireResult", { room: currentRoom, x, y, result: "hit" });
  } else {
    console.log(`// DEBUG: That's a MISS on cellId=${cellId}`);
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
  console.log(`// DEBUG: 'fireResultForShooter' => (x=${x}, y=${y}), result=${result}, cellId=${cellId}`);

  const cell = document.getElementById(cellId);
  if (!cell) {
    console.log(`// DEBUG: 'fireResultForShooter' => cannot find cell=${cellId}`);
    return;
  }

  if (result === "hit") {
    cell.classList.add("hit");
    addMessage(`Shot at (${x}, ${y}) was a HIT!`);
  } else {
    cell.classList.add("miss");
    addMessage(`Shot at (${x}, ${y}) was a miss.`);
  }
});

// Server assigns a room
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
    if (myPlayerNumber === "1") {
      console.log("// DEBUG: P1 => disabling #player-board after done placing");
      playerBoard.style.pointerEvents = "none";
    } else {
      console.log("// DEBUG: P2 => disabling #opponent-board after done placing");
      opponentBoard.style.pointerEvents = "none";
    }
  }
});

// Build boards
createBoard(playerBoard, "player");
createBoard(opponentBoard, "opponent");

/** 
 * If I'm Player1 => the opponent board is #opponent-board
 * If I'm Player2 => the opponent board is #player-board
 */
function getOpponentBoardElement() {
  if (myPlayerNumber === "1") {
    console.log("// DEBUG: getOpponentBoardElement => returning opponentBoard");
    return opponentBoard;
  } else {
    console.log("// DEBUG: getOpponentBoardElement => returning playerBoard");
    return playerBoard;
  }
}

function createBoard(board, prefix) {
  console.log("// DEBUG: createBoard => prefix=", prefix);
  board.style.pointerEvents = "none";

  for (let i = 0; i < 100; i++) {
    const cell = document.createElement("div");
    cell.id = `${prefix}-${i}`;
    board.appendChild(cell);

    cell.addEventListener("click", () => {
      console.log(`// DEBUG: CLICK => cell=${cell.id}, isMyTurn=${isMyTurn}, canPlaceShips=${canPlaceShips}, isDonePlacing=${isDonePlacing}, firedThisTurn=${firedThisTurn}`);

      if (!isDonePlacing && canPlaceShips) {
        handlePlacement(prefix, cell);
      } else if (isDonePlacing && isMyTurn) {
        handleFiring(prefix, i);
      } else if (!isMyTurn) {
        addMessage("It's not your turn!");
        console.log("// DEBUG: ignoring click => not my turn");
      } else {
        addMessage("You must place your ships first!");
        console.log("// DEBUG: ignoring click => haven't placed ships");
      }
    });
  }
}

function handlePlacement(prefix, cell) {
  if (shipsPlaced >= maxShips) {
    console.log("// DEBUG: handlePlacement => already have 3 ships");
    return;
  }

  const isCorrectBoard =
    (myPlayerNumber === "1" && prefix === "player") ||
    (myPlayerNumber === "2" && prefix === "opponent");

  if (!isCorrectBoard) {
    addMessage("That's your own board, you can't fire there.");
    console.log("// DEBUG: handlePlacement => tried placing on the wrong board for my role");
    return;
  }

  if (!cell.classList.contains("ship")) {
    cell.classList.add("ship");
    myShipCells.add(cell.id);
    shipsPlaced++;
    console.log(`// DEBUG: handlePlacement => placed ship at cell=${cell.id}, totalShips=${shipsPlaced}`);
    if (shipsPlaced === maxShips) {
      addMessage("All your ships placed!");
      doneBtn.disabled = false;
      console.log("// DEBUG: handlePlacement => done placing => enabling doneBtn");
    }
  } else {
    console.log("// DEBUG: handlePlacement => cell already has a 'ship'");
  }
}

/**
 * Fire at the opponent’s board, using the "firedThisTurn" guard
 */
function handleFiring(prefix, index) {
  // If we already fired, do nothing
  if (firedThisTurn) {
    console.log("// DEBUG: handleFiring => firedThisTurn=true => ignoring second shot");
    return;
  }

  const isOpponentBoard =
    (myPlayerNumber === "1" && prefix === "opponent") ||
    (myPlayerNumber === "2" && prefix === "player");

  if (!isOpponentBoard) {
    addMessage("That's your own board, can't fire there.");
    console.log("// DEBUG: handleFiring => tried to fire on the wrong board");
    return;
  }

  // Mark that we have fired
  firedThisTurn = true;
  console.log("// DEBUG: handleFiring => set firedThisTurn=true => no more shots this turn");

  // Immediately disable pointer events
  isMyTurn = false;
  playerBoard.style.pointerEvents = "none";
  opponentBoard.style.pointerEvents = "none";

  const x = index % 10;
  const y = Math.floor(index / 10);
  console.log(`// DEBUG: handleFiring => sending 'fire' => (x=${x}, y=${y}), room=${currentRoom}`);
  socket.emit("fire", { room: currentRoom, x, y });
}

function addMessage(text) {
  const div = document.createElement("div");
  div.textContent = text;
  messages.appendChild(div);
}

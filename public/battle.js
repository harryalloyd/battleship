const socket = io();

// ===== DEBUG: Connection check =====
socket.on("connect", () => {
  console.log("Client connected! My ID is:", socket.id);
});

// DOM elements
const messages = document.getElementById("messages");
const readyBtn = document.getElementById("readyBtn");
const doneBtn = document.getElementById("doneBtn");
const playerBoard = document.getElementById("player-board");
const opponentBoard = document.getElementById("opponent-board");

// State
let myPlayerNumber = null;
let shipsPlaced = 0;
const maxShips = 3;
let canPlaceShips = false;
let isDonePlacing = false;
const myShipCells = new Set();  // which cells on "my" board have ships
let isMyTurn = false;
let currentRoom = null;         // assigned by server

// ===== Socket Listeners =====

// 1) We are "1" or "2"
socket.on("playerNumber", (num) => {
  myPlayerNumber = num;
  console.log("// DEBUG: Received playerNumber =", num);
});

// 2) Show messages from server
socket.on("message", (msg) => {
  addMessage(msg);
  console.log("// DEBUG: message from server =>", msg);
});

// 3) bothPlayersReady => place ships
socket.on("bothPlayersReady", () => {
  addMessage("Both players ready. Place your 3 ships!");
  canPlaceShips = true;
  console.log("// DEBUG: bothPlayersReady => canPlaceShips = true");
});

// 4) bothPlayersDone => time to battle
socket.on("bothPlayersDone", () => {
  addMessage("Both players have placed ships! Let the battle begin!");
  console.log("// DEBUG: bothPlayersDone => waiting for 'turn' event from server");
});

// 5) "turn" => set isMyTurn = (playerId === socket.id)
socket.on("turn", (playerId) => {
  console.log("// DEBUG: Received 'turn' event => turn belongs to", playerId, "(myId =", socket.id, ")");
  if (playerId === socket.id) {
    isMyTurn = true;
    addMessage("It's your turn to fire!");
  } else {
    isMyTurn = false;
    addMessage("Opponent's turn. Please wait.");
  }
  console.log("// DEBUG: isMyTurn =", isMyTurn);
});

// 6) "fired" => opponent shot at (x,y). We see if it's a hit or miss.
socket.on("fired", ({ x, y }) => {
  console.log("// DEBUG: 'fired' event => Opponent fired on us at", x, y);

  // If I'm player1, my board is "player-...", else "opponent-..."
  const cellId = (myPlayerNumber === "1")
    ? `player-${x + y * 10}`
    : `opponent-${x + y * 10}`;

  const cell = document.getElementById(cellId);
  if (!cell) {
    console.warn("// DEBUG: 'fired' => can't find cellId", cellId);
    return;
  }

  if (myShipCells.has(cellId)) {
    // HIT
    console.log("// DEBUG: They hit one of our ships at", cellId);
    cell.classList.add("hit");
    socket.emit("fireResult", { room: currentRoom, x, y, result: "hit" });
  } else {
    // MISS
    console.log("// DEBUG: They missed at", cellId);
    cell.classList.add("miss");
    socket.emit("fireResult", { room: currentRoom, x, y, result: "miss" });
  }
});

// 7) "fireResultForShooter" => the result of our shot
socket.on("fireResultForShooter", ({ x, y, result }) => {
  console.log("// DEBUG: 'fireResultForShooter' => we shot at", x, y, "and got", result);
  let cellId;
  if (myPlayerNumber === "1") {
    // We attack the "opponent-..." board
    cellId = `opponent-${x + y * 10}`;
  } else {
    // We are player2 => we attack the "player-..." board
    cellId = `player-${x + y * 10}`;
  }

  const cell = document.getElementById(cellId);
  if (!cell) {
    console.warn("// DEBUG: 'fireResultForShooter' => can't find cellId", cellId);
    return;
  }

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
  console.log("// DEBUG: 'assignRoom' =>", roomName);
  currentRoom = roomName;
});

// ----- DOM Setup & Event Handlers -----

readyBtn.addEventListener("click", () => {
  console.log("// DEBUG: readyBtn clicked => emitting playerReady");
  socket.emit("playerReady");
  readyBtn.disabled = true;
});

doneBtn.addEventListener("click", () => {
  console.log("// DEBUG: doneBtn clicked => shipsPlaced =", shipsPlaced, "maxShips =", maxShips);
  if (shipsPlaced === maxShips) {
    isDonePlacing = true;
    doneBtn.disabled = true;
    console.log("// DEBUG: Emitting playerDone => isDonePlacing =", isDonePlacing);
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
      console.log(`// DEBUG: Clicked cell.id = ${cell.id} => isMyTurn = ${isMyTurn}, isDonePlacing = ${isDonePlacing}, canPlaceShips = ${canPlaceShips}`);
      if (!isDonePlacing && canPlaceShips) {
        // Place ships
        handlePlacement(boardIdPrefix, cell);
      } else if (isDonePlacing && isMyTurn) {
        // Fire if it's the correct board to attack
        handleFiring(boardIdPrefix, i);
      } else if (!isMyTurn) {
        addMessage("It's not your turn!");
        console.log("// DEBUG: Not my turn => ignoring click");
      } else {
        addMessage("You must place all ships first!");
        console.log("// DEBUG: Must place ships => ignoring click");
      }
    });
  }
}

// Place a ship on *my* board
function handlePlacement(boardIdPrefix, cell) {
  if (shipsPlaced >= maxShips) {
    console.log("// DEBUG: Already placed all ships => ignoring");
    return;
  }

  // Player1 => "player-..."
  // Player2 => "opponent-..."
  const isCorrectBoard =
    (myPlayerNumber === "1" && boardIdPrefix === "player") ||
    (myPlayerNumber === "2" && boardIdPrefix === "opponent");

  if (isCorrectBoard) {
    if (!cell.classList.contains("ship")) {
      cell.classList.add("ship");
      myShipCells.add(cell.id);
      shipsPlaced++;
      console.log(`// DEBUG: Ship placed at ${cell.id}. shipsPlaced = ${shipsPlaced}/${maxShips}`);
      if (shipsPlaced === maxShips) {
        addMessage("All your ships placed!");
        doneBtn.disabled = false;
        console.log("// DEBUG: Enable doneBtn => user can click Done now");
      }
    } else {
      console.log("// DEBUG: Already a ship there => ignoring second placement");
    }
  } else {
    addMessage("That's your own board, you can't fire there.");
    console.log("// DEBUG: Attempted to place ship on wrong board for your role");
  }
}

// Fire at the *opponent’s* board
function handleFiring(boardIdPrefix, index) {
  // For P1, the opponent is "opponent-..."
  // For P2, the opponent is "player-..."
  const isCorrectOppBoard =
    (myPlayerNumber === "1" && boardIdPrefix === "opponent") ||
    (myPlayerNumber === "2" && boardIdPrefix === "player");

  if (isCorrectOppBoard) {
    const x = index % 10;
    const y = Math.floor(index / 10);
    console.log("// DEBUG: handleFiring => firing at x=", x, "y=", y);
    // We no longer default to `socket.id`, because we always have `currentRoom`
    socket.emit("fire", { room: currentRoom, x, y });
  } else {
    addMessage("That's your own board, you can't fire there.");
    console.log("// DEBUG: Attempted to fire on the wrong board => ignoring");
  }
}

// Utility to log messages
function addMessage(text) {
  const div = document.createElement("div");
  div.textContent = text;
  messages.appendChild(div);
}

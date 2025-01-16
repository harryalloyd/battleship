const socket = io();

// DOM
const messages        = document.getElementById("messages");
const readyBtn        = document.getElementById("readyBtn");
const doneBtn         = document.getElementById("doneBtn");
const rematchBtn      = document.getElementById("rematchBtn");
const playerHead      = document.getElementById("player-heading");
const oppHead         = document.getElementById("opponent-heading");
const playerBoard     = document.getElementById("player-board");
const opponentBoard   = document.getElementById("opponent-board");

// Chat
const chatMessages = document.getElementById("chat-messages");
const chatInput    = document.getElementById("chat-input");
const chatSend     = document.getElementById("chat-send");

// Overlays
const spinner         = document.getElementById("spinner");
const usernameOverlay = document.getElementById("username-overlay");
const usernameInput   = document.getElementById("username-input");
const usernameBtn     = document.getElementById("username-btn");

// Inventories
const playerInventory   = document.getElementById("player-inventory");
const opponentInventory = document.getElementById("opponent-inventory");

const originalPlayerInventoryHTML   = playerInventory.innerHTML;
const originalOpponentInventoryHTML = opponentInventory.innerHTML;

// Show spinner at start
spinner.classList.remove("hidden");

// Game state
let myPlayerNumber = null;
// We'll place a total of 9 squares (ships are lengths 4+2+3).
let shipsPlaced   = 0;        // how many ships we've placed (3 ships)
const maxShips    = 3;
let canPlaceShips = false;
let isDonePlacing = false;
const myShipCells = new Set();

let isMyTurn     = false;
let currentRoom  = null;
let firedThisTurn= false;
let gameEnded    = false;

// We want 9 squares total => for each "hit", we do myShipCount--, 
// if it hits 0 => all ships sunk.
let myShipCount   = 0;  
let enemyShipCount= 9; // The opponent also has 9 squares total

// Usernames
let myUsername       = "Me";
let opponentUsername = "Opponent";

//----------------------------------
// Socket events
//----------------------------------

socket.on("connect", () => {
  console.log("Connected =>", socket.id);
});

socket.on("assignRoom", (roomName) => {
  currentRoom = roomName;
  console.log("assignRoom =>", roomName);
});

socket.on("bothPlayersConnected", () => {
  spinner.classList.add("hidden");
  usernameOverlay.classList.remove("hidden");
});

socket.on("playerNumber", (num) => {
  myPlayerNumber = num;
  console.log("I am playerNumber =", num);

  // Hide the other player's inventory
  if (myPlayerNumber === "1") {
    // I'm P1 => hide p2’s inventory
    opponentInventory.style.display = "none";
  } else {
    // I'm P2 => hide p1’s inventory
    playerInventory.style.display = "none";
  }

  // Activate drag events only on my side's inventory
  if (myPlayerNumber === "1") {
    activateDragEvents(playerInventory);
  } else {
    activateDragEvents(opponentInventory);
  }
});

socket.on("message", (msg) => {
  addMessage(msg);
});

// Update usernames
socket.on("updateUsernames", ({ p1, p2 }) => {
  if (myPlayerNumber === "1") {
    myUsername       = p1;
    opponentUsername = p2;
    playerHead.textContent = myUsername + "'s Board";
    oppHead.textContent    = opponentUsername + "'s Board";
  } else {
    myUsername       = p2;
    opponentUsername = p1;
    playerHead.textContent = opponentUsername + "'s Board";
    oppHead.textContent    = myUsername + "'s Board";
  }
});

socket.on("bothPlayersReady", () => {
  addMessage("Both players ready. Drag your ships onto your board!");
  canPlaceShips = true;

  // Each side has 4+2+3 = 9 squares total => needed hits
  enemyShipCount = 9;

  if (myPlayerNumber === "1") {
    playerBoard.style.pointerEvents   = "auto";
  } else {
    opponentBoard.style.pointerEvents = "auto";
  }
});

socket.on("bothPlayersDone", () => {
  addMessage("Both players placed ships! Let the battle begin.");
  playerBoard.style.pointerEvents   = "none";
  opponentBoard.style.pointerEvents = "none";
});

// Turn
socket.on("turn", (playerId) => {
  isMyTurn       = false;
  firedThisTurn  = false;
  playerBoard.style.pointerEvents   = "none";
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
    console.log("myShipCount =>", myShipCount);
    if (myShipCount === 0) {
      addMessage("You Lost (all 3 ships were sunk)!");
      endGame();
    }
    // respond
    socket.emit("fireResult", { room: currentRoom, x, y, result: "hit" });
  } else {
    cell.classList.add("miss");
    socket.emit("fireResult", { room: currentRoom, x, y, result: "miss" });
  }
});

// Fire result for me => applying hits to the opponent's squares
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
    addMessage(`Shot at (${x}, ${y}) => HIT!`);
    enemyShipCount--;
    console.log("enemyShipCount =>", enemyShipCount);
    if (enemyShipCount === 0) {
      cell.classList.add("hit");  // visually show last hit
      setTimeout(() => {
        addMessage("You Won!");
        endGame();
      }, 50);
    }
  } else {
    cell.classList.add("miss");
    addMessage(`Shot at (${x}, ${y}) => miss.`);
  }
});

// Chat
socket.on("chatMessage", ({ from, username, text }) => {
  if (from === socket.id) return;
  addChatMessage(username, text);
});

// Rematch
socket.on("rematchStart", () => {
  // Reset core flags and counts
  gameEnded         = false;
  isMyTurn          = false;
  firedThisTurn     = false;
  shipsPlaced       = 0;
  isDonePlacing     = false;
  myShipCount       = 0; // We have to place 9 squares of ships
  enemyShipCount    = 9; // Opponent also has 9
  myShipCells.clear();

  // Re-enable the Ready button
  // (so that each player can "Ready" themselves again)
  readyBtn.disabled = false;

  // Also re-disable the Done and Rematch buttons at first
  doneBtn.disabled    = true;
  rematchBtn.disabled = true;

  // Re-inject the original inventory HTML for the correct player
  if (myPlayerNumber === "1") {
    playerInventory.innerHTML   = originalPlayerInventoryHTML;
    opponentInventory.innerHTML = "";  // Hide P2's ships if you want
    activateDragEvents(playerInventory);
  } else {
    opponentInventory.innerHTML = originalOpponentInventoryHTML;
    playerInventory.innerHTML   = "";  // Hide P1's ships if you want
    activateDragEvents(opponentInventory);
  }

  // Clear the visual states on every board cell
  for (let i = 0; i < 100; i++) {
    document.getElementById("player-" + i).className   = "";
    document.getElementById("opponent-" + i).className = "";
  }

  // Tell the user what to do next
  addMessage("Rematch started! Click 'Ready' to place ships again.");
});


//------------------------------------------
// DOM events
//------------------------------------------

readyBtn.addEventListener("click", () => {
  socket.emit("playerReady");
  readyBtn.disabled = true;
});

doneBtn.addEventListener("click", () => {
  // We have 3 ships => total squares = 9
  // so once we've placed all 3 ships, we can do:
  if (shipsPlaced === 3) {
    isDonePlacing = true;
    doneBtn.disabled = true;
    socket.emit("playerDone");

    // we have 9 squares total
    myShipCount = 9;

    // disable board
    if (myPlayerNumber === "1") {
      playerBoard.style.pointerEvents = "none";
    } else {
      opponentBoard.style.pointerEvents = "none";
    }
  }
});

rematchBtn.addEventListener("click", () => {
  socket.emit("requestRematch");
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
// DRAG & DROP logic
//------------------------------------------

function activateDragEvents(shipInventory) {
  if (!shipInventory) return;
  const ships = shipInventory.querySelectorAll(".ship-block");
  ships.forEach((shipEl) => {
    shipEl.addEventListener("dragstart", (e) => {
      const length = shipEl.getAttribute("data-length");
      e.dataTransfer.setData("ship-length", length);
      e.dataTransfer.setData("ship-id",   shipEl.id);
    });
  });
}

//------------------------------------------
// Board creation + drop logic
//------------------------------------------

function createBoard(board, prefix) {
  board.style.pointerEvents = "none";
  for (let i = 0; i < 100; i++) {
    const cell = document.createElement("div");
    cell.id = `${prefix}-${i}`;
    board.appendChild(cell);

    cell.addEventListener("dragenter", (evt) => {
      if (!isDonePlacing && canPlaceShips) evt.preventDefault();
    });
    cell.addEventListener("dragover", (evt) => {
      if (!isDonePlacing && canPlaceShips) evt.preventDefault();
    });
    cell.addEventListener("drop", (evt) => {
      evt.preventDefault();
      if (!canPlaceShips || isDonePlacing) return;

      // parse data
      const length = parseInt(evt.dataTransfer.getData("ship-length"), 10);
      const shipId = evt.dataTransfer.getData("ship-id");

      const cellIndex = parseInt(cell.id.split("-")[1], 10);
      const row = Math.floor(cellIndex / 10);
      const col = cellIndex % 10;

      // If I'm P1 => can only place on prefix="player"
      // If I'm P2 => can only place on prefix="opponent"
      if (myPlayerNumber === "1" && prefix !== "player") {
        console.log("You can only place on your own board => 'player-' prefix.");
        return;
      }
      if (myPlayerNumber === "2" && prefix !== "opponent") {
        console.log("You can only place on your own board => 'opponent-' prefix.");
        return;
      }

      // check vertical space
      if (row + length - 1 > 9) {
        console.log("Out of bounds => can't place ship.");
        return;
      }
      // check overlap
      for (let r = 0; r < length; r++) {
        const checkRow = row + r;
        const checkIdx = checkRow * 10 + col;
        const checkCellId = `${prefix}-${checkIdx}`;
        const checkCell   = document.getElementById(checkCellId);
        if (!checkCell || checkCell.classList.contains("ship")) {
          console.log("Can't place => overlap or invalid cell");
          return;
        }
      }

      // place
      for (let r = 0; r < length; r++) {
        const placeRow = row + r;
        const placeIdx = placeRow * 10 + col;
        document.getElementById(`${prefix}-${placeIdx}`).classList.add("ship");
        myShipCells.add(`${prefix}-${placeIdx}`);
      }

      // remove from inventory
      const draggedShipEl = document.getElementById(shipId);
      if (draggedShipEl) {
        draggedShipEl.remove();
      }

      // increment # of ships placed
      shipsPlaced++;
      console.log(`Placed ship of length=${length}, shipsPlaced=${shipsPlaced}`);
      if (shipsPlaced === maxShips) {
        addMessage("All 3 of your ships have been placed (9 squares)!");
        doneBtn.disabled = false;
      }
    });

    // normal clicks
    cell.addEventListener("click", () => {
      if (!isDonePlacing && canPlaceShips) {
        console.log("Use drag-and-drop to place ships!");
      } else if (isDonePlacing && isMyTurn) {
        handleFiring(prefix, i);
      } else if (!isMyTurn) {
        addMessage("Not your turn!");
      } else {
        addMessage("Place all ships first!");
      }
    });
  }
}

//------------------------------------------
// Firing logic
//------------------------------------------

function handleFiring(prefix, index) {
  if (firedThisTurn) return;

  // For P1 => they fire on "opponent-" 
  // For P2 => they fire on "player-"
  const isOppBoard =
    (myPlayerNumber === "1" && prefix === "opponent") ||
    (myPlayerNumber === "2" && prefix === "player");
  if (!isOppBoard) {
    addMessage("That's your own board => can't fire there.");
    return;
  }

  firedThisTurn = true;
  isMyTurn = false;
  playerBoard.style.pointerEvents   = "none";
  opponentBoard.style.pointerEvents = "none";

  const x = index % 10;
  const y = Math.floor(index / 10);
  socket.emit("fire", { room: currentRoom, x, y });
}

//------------------------------------------
// Utility
//------------------------------------------

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

function getOpponentBoard() {
  return (myPlayerNumber === "1") ? opponentBoard : playerBoard;
}

function endGame() {
  gameEnded = true;
  playerBoard.style.pointerEvents = "none";
  opponentBoard.style.pointerEvents = "none";
  rematchBtn.disabled = false;
}

//------------------------------------------
// Build boards
//------------------------------------------
createBoard(playerBoard,   "player");
createBoard(opponentBoard, "opponent");

// RULES toggle
const rulesToggle = document.getElementById("rules-toggle");
const rulesBox    = document.getElementById("rules-box");
rulesToggle.addEventListener("click", () => {
  rulesBox.classList.toggle("hidden");
});

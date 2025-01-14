// server.js

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public"));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/battle.html");
});

/**
 * The structure of each game:
 * games[roomId] = {
 *   players: [socketIdP1, socketIdP2],
 *   turn: <socketId of the attacker>,
 *   readyCount: 0,
 *   doneCount: 0,
 *   shotsTaken: 0,
 *   usernames: { socket1Id: "Alice", socket2Id: "Bob" },
 *   rematchCount: 0,
 *   firedPositions: {    // each player's set of squares they've fired
 *       socketIdP1: new Set(),
 *       socketIdP2: new Set()
 *   }
 * }
 */
const games = {};
let waitingPlayer = null;

io.on("connection", (socket) => {
  console.log("// DEBUG: Player connected:", socket.id);

  let playerNumber = "";
  let roomId = null;

  // If we have no waiting player, mark this new connection as Player1
  if (!waitingPlayer) {
    waitingPlayer = socket;
    playerNumber = "1";
    console.log("// DEBUG: Marking this as P1 =>", socket.id);
    socket.emit("message", "Waiting for another player...");
  } else {
    // This is Player2
    playerNumber = "2";
    roomId = `${waitingPlayer.id}-${socket.id}`;

    // Join both sockets to the same room
    waitingPlayer.join(roomId);
    socket.join(roomId);

    // Create the game object
    games[roomId] = {
      players: [waitingPlayer.id, socket.id],
      turn: waitingPlayer.id, // P1 starts
      readyCount: 0,
      doneCount: 0,
      shotsTaken: 0,
      usernames: {},
      rematchCount: 0,

      // IMPORTANT: separate firedPositions for each player
      firedPositions: {
        [waitingPlayer.id]: new Set(),
        [socket.id]: new Set()
      }
    };

    console.log(`// DEBUG: Created room=${roomId} with players:`, games[roomId].players);

    // Let each client know which room they're in
    waitingPlayer.emit("assignRoom", roomId);
    socket.emit("assignRoom", roomId);

    // Tell each client if they're "1" or "2"
    waitingPlayer.emit("playerNumber", "1");
    socket.emit("playerNumber", "2");

    // Inform them the game is starting
    waitingPlayer.emit("message", "Game started! Your turn. (You are Player 1)");
    socket.emit("message", "Game started! Opponent's turn. (You are Player 2)");

    // Tell P1 to start
    io.to(games[roomId].turn).emit("turn", games[roomId].turn);

    // Both players are connected => remove the spinner
    io.to(roomId).emit("bothPlayersConnected");

    // Clear waiting so next connection will be a new P1
    waitingPlayer = null;
  }

  // If we’re still in the P1 scenario (no second player yet)
  if (!roomId && waitingPlayer === socket) {
    socket.emit("playerNumber", playerNumber); // "1"
  }

  // ========== setUsername ==========
  socket.on("setUsername", (username) => {
    const foundRoom = findRoomForPlayer(socket.id);
    if (!foundRoom) return;
    const game = games[foundRoom];

    game.usernames[socket.id] = username;

    const [p1, p2] = game.players;
    const p1Name = game.usernames[p1] || "Player 1";
    const p2Name = game.usernames[p2] || "Player 2";

    io.to(foundRoom).emit("updateUsernames", { p1: p1Name, p2: p2Name });
  });

  // ========== playerReady ==========
  socket.on("playerReady", () => {
    const rId = findRoomForPlayer(socket.id);
    if (!rId) return;
    const g = games[rId];

    g.readyCount++;
    if (g.readyCount === 2) {
      io.to(rId).emit("bothPlayersReady");
    }
  });

  // ========== playerDone ==========
  socket.on("playerDone", () => {
    const rId = findRoomForPlayer(socket.id);
    if (!rId) return;
    const g = games[rId];

    g.doneCount++;
    // Once both done placing ships, start the battle
    if (g.doneCount === 2) {
      io.to(rId).emit("bothPlayersDone");
      io.to(g.turn).emit("turn", g.turn);
    }
  });

  // ========== fire ==========
  socket.on("fire", ({ room, x, y }) => {
    const g = games[room];
    if (!g) {
      socket.emit("error", "Game not found!");
      return;
    }

    // Check if it's your turn
    if (g.turn !== socket.id) {
      socket.emit("error", "Not your turn!");
      return;
    }

    // Access the current player's set of previously fired squares
    const myFiredSet = g.firedPositions[socket.id];
    const posKey     = `${x},${y}`;

    // If you already fired at that location, do not switch turn
    if (myFiredSet.has(posKey)) {
      socket.emit("error", "You already fired that location. Try again!");
      io.to(g.turn).emit("turn", g.turn);
      return;
    }

    // Mark this location as fired
    myFiredSet.add(posKey);

    // Check if they already took a shot this turn
    if (g.shotsTaken >= 1) {
      socket.emit("error", "You already fired this turn!");
      return;
    }

    // This is a valid shot
    g.shotsTaken++;
    socket.to(room).emit("fired", { x, y });
  });

  // ========== fireResult ==========
  socket.on("fireResult", ({ room, x, y, result }) => {
    const g = games[room];
    if (!g) return;

    // Let the shooting client see if it was a hit/miss
    socket.to(room).emit("fireResultForShooter", { x, y, result });

    // Switch turns
    const oldAttacker = g.turn;
    g.turn = g.players.find((id) => id !== oldAttacker);
    g.shotsTaken = 0;
    io.to(g.turn).emit("turn", g.turn);
  });

  // ========== chatMessage ==========
  socket.on("chatMessage", (text) => {
    const rId = findRoomForPlayer(socket.id);
    if (!rId) return;

    const g = games[rId];
    const username = g.usernames[socket.id] || "???";

    io.to(rId).emit("chatMessage", {
      from: socket.id,
      username,
      text
    });
  });

  // ========== requestRematch ==========
  socket.on("requestRematch", () => {
    const rId = findRoomForPlayer(socket.id);
    if (!rId) return;
    const g = games[rId];

    g.rematchCount++;
    console.log(`// DEBUG: Player ${socket.id} requested rematch. Now rematchCount = ${g.rematchCount}`);

    // If both players requested
    if (g.rematchCount === 2) {
      console.log(`// DEBUG: Both requested rematch => resetting game in room=${rId}`);

      // reset the game state
      g.shotsTaken    = 0;
      g.readyCount    = 0;
      g.doneCount     = 0;
      g.rematchCount  = 0;
      g.turn          = g.players[0]; // P1 starts again

      // Reset per-player firedPositions
      g.firedPositions = {
        [g.players[0]]: new Set(),
        [g.players[1]]: new Set()
      };

      // Let them know
      io.to(rId).emit("rematchStart");
      // Re-emit "turn" event to P1
      io.to(g.turn).emit("turn", g.turn);
    }
  });

  // ========== disconnect ==========
  socket.on("disconnect", () => {
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      // The waiting player (P1) left before a second player arrived
      waitingPlayer = null;
    }
    // If a player leaves in mid-game
    for (const [rId, g] of Object.entries(games)) {
      if (g.players.includes(socket.id)) {
        io.to(rId).emit("message", "Opponent disconnected. Game over.");
        delete games[rId];
      }
    }
  });
});

//=================================
// Helper function
//=================================
function findRoomForPlayer(playerId) {
  for (const [rId, game] of Object.entries(games)) {
    if (game.players.includes(playerId)) {
      return rId;
    }
  }
  return null;
}

//=================================
// Start the server
//=================================
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

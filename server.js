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
 * games[roomId] = {
 *   players: [socketIdP1, socketIdP2],
 *   turn: <socketId of the attacker>,
 *   readyCount: 0,
 *   doneCount: 0,
 *   shotsTaken: 0,
 *   usernames: { socket1Id: "Alice", socket2Id: "Bob" },
 *   rematchCount: 0   // <--- NEW: track how many players requested rematch
 */
const games = {};
let waitingPlayer = null;

io.on("connection", (socket) => {
  console.log("// DEBUG: Player connected:", socket.id);

  let playerNumber = "";
  let roomId = null;

  if (!waitingPlayer) {
    // This is Player1
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
      turn: waitingPlayer.id,
      readyCount: 0,
      doneCount: 0,
      shotsTaken: 0,
      usernames: {},
      rematchCount: 0  // <--- track how many players requested rematch
    };

    console.log(`// DEBUG: Created room=${roomId} with players:`, games[roomId].players);

    waitingPlayer.emit("assignRoom", roomId);
    socket.emit("assignRoom", roomId);

    // Tell each client if they're "1" or "2"
    waitingPlayer.emit("playerNumber", "1");
    socket.emit("playerNumber", "2");

    waitingPlayer.emit("message", "Game started! Your turn. (You are Player 1)");
    socket.emit("message", "Game started! Opponent's turn. (You are Player 2)");

    // Let Player1 know to start
    io.to(games[roomId].turn).emit("turn", games[roomId].turn);

    // Let both know that we have 2 players => hide spinner
    io.to(roomId).emit("bothPlayersConnected");

    // Clear waiting
    waitingPlayer = null;
  }

  // If we’re still "P1" scenario, no second player yet
  if (!roomId && waitingPlayer === socket) {
    socket.emit("playerNumber", playerNumber); // "1"
  }

  // ========== setUsername ==========
  socket.on("setUsername", (username) => {
    const foundRoom = findRoomForPlayer(socket.id);
    if (!foundRoom) return;
    const game = games[foundRoom];

    game.usernames[socket.id] = username;

    // Broadcast BOTH updated usernames to each client
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
    if (g.doneCount === 2) {
      io.to(rId).emit("bothPlayersDone");
      io.to(g.turn).emit("turn", g.turn);
    }
  });

  // ========== fire ==========
  socket.on("fire", ({ room, x, y }) => {
    const g = games[room];
    if (!g) return socket.emit("error", "Game not found!");
  
    // If it's not your turn, or you already fired, return:
    if (g.turn !== socket.id) {
      socket.emit("error", "Not your turn!");
      return;
    }
    if (!g.firedPositions) g.firedPositions = new Set();
  
    const posKey = `${x},${y}`;
    if (g.firedPositions.has(posKey)) {
      // Already fired => do not flip the turn
      socket.emit("error", "You already fired that location. Try again!");
      // Re‐emit turn to the same attacker so they can pick another spot:
      io.to(g.turn).emit("turn", g.turn);
      return;
    }
  
    // Otherwise mark it used, increment shots
    g.firedPositions.add(posKey);
    if (g.shotsTaken >= 1) {
      socket.emit("error", "You already fired this turn!");
      return;
    }
  
    g.shotsTaken++;
    socket.to(room).emit("fired", { x, y });
  });



  // ========== fireResult ==========
  socket.on("fireResult", ({ room, x, y, result }) => {
    const g = games[room];
    if (!g) return;

    socket.to(room).emit("fireResultForShooter", { x, y, result });

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

  // ========== requestRematch (NEW) ==========
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
      g.shotsTaken = 0;
      g.readyCount = 0;
      g.doneCount  = 0;
      g.rematchCount = 0;

      // The same players and usernames remain. We can also pick who starts (P1).
      g.turn = g.players[0]; // default: P1 starts again
      // IMPORTANT: Reset firedPositions so old shots don't block new ones:
      g.firedPositions = new Set();
      // let them know
      io.to(rId).emit("rematchStart");
      // re-emit a "turn" event to P1
      io.to(g.turn).emit("turn", g.turn);
    }
  });

  // ========== disconnect ==========
  socket.on("disconnect", () => {
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
    }
    for (const [rId, g] of Object.entries(games)) {
      if (g.players.includes(socket.id)) {
        io.to(rId).emit("message", "Opponent disconnected. Game over.");
        delete games[rId];
      }
    }
  });
});

// Helper
function findRoomForPlayer(playerId) {
  for (const [rId, game] of Object.entries(games)) {
    if (game.players.includes(playerId)) {
      return rId;
    }
  }
  return null;
}

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

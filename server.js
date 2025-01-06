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
 *   usernames: { socket1Id: "Alice", socket2Id: "Bob" }
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
      usernames: {}
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

  // If we’re still in the "P1" scenario (no second player yet),
  // we can at least send "playerNumber=1" to P1
  if (!roomId && waitingPlayer === socket) {
    socket.emit("playerNumber", playerNumber); // "1"
  }

  // ========== setUsername ==========
  socket.on("setUsername", (username) => {
    const foundRoom = findRoomForPlayer(socket.id);
    if (!foundRoom) return;
    const game = games[foundRoom];

    if (!game.usernames) game.usernames = {};
    game.usernames[socket.id] = username;

    // Broadcast BOTH updated usernames to each client
    const [p1, p2] = game.players;
    const p1Name = game.usernames[p1] || "???";
    const p2Name = game.usernames[p2] || "???";

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
    if (!g) {
      socket.emit("error", "Game not found!");
      return;
    }
    if (g.turn !== socket.id) {
      socket.emit("error", "Not your turn!");
      return;
    }
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

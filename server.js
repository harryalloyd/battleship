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
 *   turn: <socketId of the current attacker>,
 *   readyCount: 0,
 *   doneCount: 0,
 *   shotsTaken: 0,
 *   usernames: { socketIdP1: "Alice", socketIdP2: "Bob" } // NEW: store usernames
 */
const games = {};
let waitingPlayer = null;

io.on("connection", (socket) => {
  console.log("// DEBUG: Player connected:", socket.id);

  let playerNumber = "";
  let roomId = null;

  if (!waitingPlayer) {
    // === Player 1 ===
    waitingPlayer = socket;
    playerNumber = "1";
    console.log("// DEBUG: Assigning this socket as P1 =>", socket.id);
    socket.emit("message", "Waiting for another player...");
  } else {
    // === Player 2 ===
    playerNumber = "2";
    roomId = `${waitingPlayer.id}-${socket.id}`;

    waitingPlayer.join(roomId);
    socket.join(roomId);

    // Create a new game object
    games[roomId] = {
      players: [waitingPlayer.id, socket.id],
      turn: waitingPlayer.id, // P1’s turn first
      readyCount: 0,
      doneCount: 0,
      shotsTaken: 0,
      usernames: {} // Will fill in once we get them
    };

    console.log(`// DEBUG: Created room = ${roomId} with players:`, games[roomId].players);

    waitingPlayer.emit("assignRoom", roomId);
    socket.emit("assignRoom", roomId);

    // Let the clients know they’re “1” or “2”
    waitingPlayer.emit("playerNumber", "1");
    socket.emit("playerNumber", "2");

    waitingPlayer.emit("message", "Game started! Your turn. (You are Player 1)");
    socket.emit("message", "Game started! Opponent's turn. (You are Player 2)");

    // Let P1 know it’s their turn
    io.to(games[roomId].turn).emit("turn", games[roomId].turn);

    // Let both clients know: we now have 2 players => stop spinner
    io.to(roomId).emit("bothPlayersConnected"); 

    waitingPlayer = null;
  }

  // If we never created a room yet, we’re P1
  if (!roomId && waitingPlayer === socket) {
    // P1 doesn't have a room until P2 arrives, but let's at least do:
    socket.emit("playerNumber", playerNumber); // "1"
  }

  // ========== handle "setUsername" ==========
  socket.on("setUsername", (username) => {
    const foundRoom = findRoomForPlayer(socket.id);
    if (!foundRoom) return;

    const game = games[foundRoom];
    if (!game.usernames) {
      game.usernames = {};
    }
    // Store the username under socket.id
    game.usernames[socket.id] = username;

    // Let the other client know the new username
    socket.to(foundRoom).emit("opponentUsername", username);
  });

  // ========== playerReady ==========
  socket.on("playerReady", () => {
    const foundRoom = findRoomForPlayer(socket.id);
    if (!foundRoom) return;
    const game = games[foundRoom];

    game.readyCount++;
    if (game.readyCount === 2) {
      io.to(foundRoom).emit("bothPlayersReady");
    }
  });

  // ========== playerDone ==========
  socket.on("playerDone", () => {
    const foundRoom = findRoomForPlayer(socket.id);
    if (!foundRoom) return;
    const game = games[foundRoom];

    game.doneCount++;
    if (game.doneCount === 2) {
      io.to(foundRoom).emit("bothPlayersDone");
      io.to(game.turn).emit("turn", game.turn);
    }
  });

  // ========== fire ==========
  socket.on("fire", ({ room, x, y }) => {
    const game = games[room];
    if (!game) {
      socket.emit("error", "Game not found!");
      return;
    }
    if (game.turn !== socket.id) {
      socket.emit("error", "Not your turn!");
      return;
    }
    if (game.shotsTaken >= 1) {
      socket.emit("error", "You already fired this turn!");
      return;
    }

    game.shotsTaken++;
    socket.to(room).emit("fired", { x, y });
  });

  // ========== fireResult ==========
  socket.on("fireResult", ({ room, x, y, result }) => {
    const game = games[room];
    if (!game) return;

    socket.to(room).emit("fireResultForShooter", { x, y, result });

    const oldAttacker = game.turn;
    game.turn = game.players.find((id) => id !== oldAttacker);
    game.shotsTaken = 0;
    io.to(game.turn).emit("turn", game.turn);
  });

  // ========== chatMessage ==========
  socket.on("chatMessage", (text) => {
    const foundRoom = findRoomForPlayer(socket.id);
    if (!foundRoom) return;

    const game = games[foundRoom];
    const username = (game.usernames && game.usernames[socket.id]) || "???";

    io.to(foundRoom).emit("chatMessage", {
      from: socket.id,
      username, // pass along the actual username
      text
    });
  });

  // ========== disconnect ==========
  socket.on("disconnect", () => {
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
    }
    for (const [rId, game] of Object.entries(games)) {
      if (game.players.includes(socket.id)) {
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

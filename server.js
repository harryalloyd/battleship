const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public")); // Serve static files

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/battle.html");
});

/**
 * games[roomId] = {
 *   players: [socketIdP1, socketIdP2],
 *   turn: <socketId of whomever’s turn>,
 *   readyCount: 0,
 *   doneCount: 0
 * }
 */
const games = {};
let waitingPlayer = null; // store the first connected player

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  let playerNumber = "";
  let roomId = null;

  if (!waitingPlayer) {
    // ========== This is Player 1 ==========
    waitingPlayer = socket;
    playerNumber = "1";
    socket.emit("message", "Waiting for another player...");
    console.log("// DEBUG: Assigned new waitingPlayer =", socket.id);
  } else {
    // ========== This is Player 2 ==========
    playerNumber = "2";

    // Create a room for them
    roomId = `${waitingPlayer.id}-${socket.id}`;
    waitingPlayer.join(roomId);
    socket.join(roomId);

    // Initialize the game object
    games[roomId] = {
      players: [waitingPlayer.id, socket.id],
      turn: waitingPlayer.id, // P1’s turn by default
      readyCount: 0,
      doneCount: 0
    };

    console.log("// DEBUG: Created room", roomId, "with players:", games[roomId].players);

    // Tell both players which room they’re in
    waitingPlayer.emit("assignRoom", roomId);
    socket.emit("assignRoom", roomId);

    waitingPlayer.emit("message", "Game started! Your turn. (You are Player 1)");
    socket.emit("message", "Game started! Opponent's turn. (You are Player 2)");

    // Let P1 know it’s their turn
    io.to(games[roomId].turn).emit("turn", games[roomId].turn);

    // Clear out the waiting player
    waitingPlayer = null;
  }

  // Tell the client if they are "1" or "2"
  socket.emit("playerNumber", playerNumber);

  // ========== playerReady ==========
  socket.on("playerReady", () => {
    const foundRoom = findRoomForPlayer(socket.id);
    if (!foundRoom) return;

    const game = games[foundRoom];
    game.readyCount++;
    console.log("// DEBUG: playerReady from", socket.id, " => readyCount =", game.readyCount);

    if (game.readyCount === 2) {
      console.log("// DEBUG: Both players ready in room", foundRoom);
      io.to(foundRoom).emit("bothPlayersReady");
    }
  });

  // ========== playerDone (placed ships) ==========
  socket.on("playerDone", () => {
    const foundRoom = findRoomForPlayer(socket.id);
    if (!foundRoom) return;

    const game = games[foundRoom];
    game.doneCount++;
    console.log(`Player ${socket.id} done placing. doneCount = ${game.doneCount} in room ${foundRoom}`);

    if (game.doneCount === 2) {
      io.to(foundRoom).emit("bothPlayersDone");
      console.log(`// DEBUG: Both players done in room ${foundRoom}, turn is ${game.turn}`);
      io.to(game.turn).emit("turn", game.turn);
    }
  });

  // ========== fire (the attacker fires at x,y) ==========
  socket.on("fire", ({ room, x, y }) => {
    console.log("// DEBUG: Received 'fire' from", socket.id, " => (x,y) =", x,y, "in room =", room);
    const game = games[room];
    if (!game) {
      socket.emit("error", "Game not found!");
      console.log("// DEBUG: No game found for room", room);
      return;
    }
    if (game.turn !== socket.id) {
      socket.emit("error", "Not your turn!");
      console.log("// DEBUG: Not your turn for", socket.id, " => turn belongs to", game.turn);
      return;
    }
    // Send 'fired' to the other player
    socket.to(room).emit("fired", { x, y });
  });

  // ========== fireResult (defender says hit or miss) ==========
  socket.on("fireResult", ({ room, x, y, result }) => {
    console.log("// DEBUG: Received 'fireResult' from defender", socket.id, " =>", result, " at (x,y) =", x, y);
    const game = games[room];
    if (!game) {
      console.log("// DEBUG: No game found for room", room);
      return;
    }

    // Relay to the attacker
    socket.to(room).emit("fireResultForShooter", { x, y, result });

    // Swap turn
    game.turn = game.players.find((id) => id !== socket.id);
    console.log(`Swapping turn to: ${game.turn}`);
    io.to(game.turn).emit("turn", game.turn);
  });

  // ========== disconnect ==========
  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
    }

    for (const [rId, game] of Object.entries(games)) {
      if (game.players.includes(socket.id)) {
        io.to(rId).emit("message", "Opponent disconnected. Game over.");
        console.log("// DEBUG: Deleting game room", rId, "because", socket.id, "disconnected.");
        delete games[rId];
      }
    }
  });
});

// Helper: find which room a given player belongs to
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

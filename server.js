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

  // If no one waiting, this is P1
  if (!waitingPlayer) {
    waitingPlayer = socket;
    playerNumber = "1";
    socket.emit("message", "Waiting for another player...");
  } else {
    // We have a waiting player => this is P2
    playerNumber = "2";

    // Create a room for them
    roomId = `${waitingPlayer.id}-${socket.id}`;
    waitingPlayer.join(roomId);
    socket.join(roomId);

    // Init the game object
    games[roomId] = {
      players: [waitingPlayer.id, socket.id],
      turn: waitingPlayer.id, // P1’s turn by default
      readyCount: 0,
      doneCount: 0
    };

    waitingPlayer.emit(
      "message",
      "Game started! Your turn. (You are Player 1)"
    );
    socket.emit("message", "Game started! Opponent's turn. (You are Player 2)");
    
    // Let P1 know it’s their turn
    io.to(games[roomId].turn).emit("turn", games[roomId].turn);

    waitingPlayer = null;
  }

  // Tell the client if they are "1" or "2"
  socket.emit("playerNumber", playerNumber);

  // If a room was just created, tell both players
  if (roomId) {
    socket.emit("assignRoom", roomId);
  } else if (waitingPlayer) {
    // for P1, we might do similarly once the second player arrives, but it’s optional
    waitingPlayer.emit("assignRoom", roomId);
  }

  // ---------- playerReady ----------
  socket.on("playerReady", () => {
    const foundRoom = findRoomForPlayer(socket.id);
    if (!foundRoom) return;

    const game = games[foundRoom];
    game.readyCount++;

    if (game.readyCount === 2) {
      io.to(foundRoom).emit("bothPlayersReady");
    }
  });

  // ---------- playerDone (placed ships) ----------
  socket.on("playerDone", () => {
    const foundRoom = findRoomForPlayer(socket.id);
    if (!foundRoom) return;

    const game = games[foundRoom];
    game.doneCount++;
    console.log(
      `Player ${socket.id} done placing. Now ${game.doneCount} in room ${foundRoom} done.`
    );

    if (game.doneCount === 2) {
      io.to(foundRoom).emit("bothPlayersDone");
      console.log(
        `Both players done in room ${foundRoom}, now it's turn of ${game.turn}`
      );
      // Re-emit turn to P1 (or whoever `game.turn` is currently set to)
      io.to(game.turn).emit("turn", game.turn);
    }
  });

  // ---------- fire (the attacker fires at x,y) ----------
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
    socket.to(room).emit("fired", { x, y });
  });

  // ---------- fireResult (defender says hit or miss) ----------
  socket.on("fireResult", ({ room, x, y, result }) => {
    const game = games[room];
    if (!game) return;

    // This ‘socket’ is the defender, so we relay the outcome to the attacker
    socket.to(room).emit("fireResultForShooter", { x, y, result });

    // Swap turn
    game.turn = game.players.find((id) => id !== socket.id);
    console.log(`Swapping turn to: ${game.turn}`);
    io.to(game.turn).emit("turn", game.turn);
  });

  // ---------- disconnect ----------
  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
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

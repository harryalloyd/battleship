const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve the "public" folder for your HTML/CSS/JS
app.use(express.static(__dirname + "/public"));

// On GET "/", serve battle.html
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/battle.html");
});

/**
 * We'll store all active games in an object:
 *   games[roomId] = {
 *     players: [player1SocketId, player2SocketId],
 *     turn: playerSocketIdCurrentlyFiring,
 *     readyCount: 0, // how many players have clicked "Ready"
 *     doneCount: 0   // how many have placed all ships
 *   }
 */
const games = {};

// If there's a waiting player, the next connection becomes their opponent
let waitingPlayer = null;

// Socket.io main
io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Determine if this user is Player 1 or Player 2
  let playerNumber = "";
  let roomId = null;

  if (!waitingPlayer) {
    // We have no waiting player, so this is Player 1
    waitingPlayer = socket;
    playerNumber = "1";
    socket.emit("message", "Waiting for another player...");
  } else {
    // We do have a waiting player, so this new connection is Player 2
    playerNumber = "2";

    // Create a unique room name (e.g. "socketId-socketId")
    roomId = `${waitingPlayer.id}-${socket.id}`;

    // Join both players to this room
    waitingPlayer.join(roomId);
    socket.join(roomId);

    // Initialize the game data
    games[roomId] = {
      players: [waitingPlayer.id, socket.id],
      turn: waitingPlayer.id, // By default, Player1 starts
      readyCount: 0,
      doneCount: 0
    };

    // Overwrite the "waiting" message for Player 1
    waitingPlayer.emit("message", "Game started! Your turn. (You are Player 1)");
    socket.emit("message", "Game started! Opponent's turn. (You are Player 2)");

    // Tell Player1 it's their turn
    io.to(games[roomId].turn).emit("turn", games[roomId].turn);

    // No longer waiting for a player
    waitingPlayer = null;
  }

  // Let the client know if they are P1 or P2
  socket.emit("playerNumber", playerNumber);

  // If we do have a room now, store it in a variable
  // (Player 1 won't have a room until the second player arrives,
  //  so handle that in "playerReady"/"playerDone" logic)
  if (roomId) {
    socket.emit("assignRoom", roomId);
    waitingPlayer?.emit("assignRoom", roomId); // in case waitingPlayer is null, do ?. 
  }

  // ================ EVENT: playerReady ================
  socket.on("playerReady", () => {
    let foundRoom = findRoomForPlayer(socket.id);
    if (!foundRoom) return;

    const game = games[foundRoom];
    game.readyCount++;

    if (game.readyCount === 2) {
      // Both are ready => broadcast to the room
      io.to(foundRoom).emit("bothPlayersReady");
    }
  });

  // ================ EVENT: playerDone (placed ships) ================
  socket.on("playerDone", () => {
    let foundRoom = findRoomForPlayer(socket.id);
    if (!foundRoom) return;

    const game = games[foundRoom];
    game.doneCount++;
    console.log(`Player ${socket.id} done placing. Now ${game.doneCount} in room ${foundRoom} done.`);

    if (game.doneCount === 2) {
      io.to(foundRoom).emit("bothPlayersDone");
      // The turn is already set to Player1 by default,
      // so we can keep that or re-emit turn if needed
      io.to(game.turn).emit("turn", game.turn);
    }
  });

  // ================ EVENT: fire (the attacker fires at x,y) ================
  socket.on("fire", ({ room, x, y }) => {
    const game = games[room];
    if (!game) {
      socket.emit("error", "Game not found!");
      return;
    }
    // Check turn
    if (game.turn !== socket.id) {
      socket.emit("error", "Not your turn!");
      return;
    }
    // Let the defender know they've been fired upon
    // "fired" event => the defender will check hit/miss
    socket.to(room).emit("fired", { x, y });
  });

  // ================ EVENT: fireResult (defender tells server: hit or miss) ================
  socket.on("fireResult", ({ room, x, y, result }) => {
    const game = games[room];
    if (!game) return;

    // 'socket' here is the defender. We want to relay the result to the attacker
    socket.to(room).emit("fireResultForShooter", { x, y, result });

    // Now we swap the turn to the other player
    game.turn = game.players.find((id) => id !== socket.id);
    io.to(game.turn).emit("turn", game.turn);
  });

  // ================ EVENT: disconnect ================
  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);

    // If someone was waiting, clear that
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
    }

    // If they were in a game, end that game
    for (const [rId, game] of Object.entries(games)) {
      if (game.players.includes(socket.id)) {
        io.to(rId).emit("message", "Opponent disconnected. Game over.");
        delete games[rId];
      }
    }
  });
});

// Helper function to find which room a given player is in
function findRoomForPlayer(playerId) {
  for (let [rId, game] of Object.entries(games)) {
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

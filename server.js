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
 *   shotsTaken: 0  // 1 shot max per turn
 */
const games = {};
let waitingPlayer = null;

io.on("connection", (socket) => {
  console.log("// DEBUG: Player connected:", socket.id);

  let playerNumber = "";
  let roomId = null;

  if (!waitingPlayer) {
    // ========== This is Player 1 ==========
    waitingPlayer = socket;
    playerNumber = "1";
    console.log("// DEBUG: Assigning this socket as P1 =>", socket.id);
    socket.emit("message", "Waiting for another player...");
  } else {
    // ========== This is Player 2 ==========
    playerNumber = "2";
    roomId = `${waitingPlayer.id}-${socket.id}`;

    waitingPlayer.join(roomId);
    socket.join(roomId);

    // Initialize the game
    games[roomId] = {
      players: [waitingPlayer.id, socket.id],
      turn: waitingPlayer.id, // P1’s turn first
      readyCount: 0,
      doneCount: 0,
      shotsTaken: 0
    };

    console.log(`// DEBUG: Created room = ${roomId}`);
    console.log("// DEBUG:   => players:", games[roomId].players);

    waitingPlayer.emit("assignRoom", roomId);
    socket.emit("assignRoom", roomId);

    waitingPlayer.emit("message", "Game started! Your turn. (You are Player 1)");
    socket.emit("message", "Game started! Opponent's turn. (You are Player 2)");

    // Let P1 know it's their turn
    console.log(`// DEBUG: Telling P1 (ID=${games[roomId].turn}) to start`);
    io.to(games[roomId].turn).emit("turn", games[roomId].turn);

    waitingPlayer = null;
  }

  // Let client know if they're "1" or "2"
  socket.emit("playerNumber", playerNumber);

  // ========== playerReady ==========
  socket.on("playerReady", () => {
    const foundRoom = findRoomForPlayer(socket.id);
    if (!foundRoom) return;
    const game = games[foundRoom];

    game.readyCount++;
    console.log(`// DEBUG: PlayerReady from ${socket.id}, readyCount = ${game.readyCount} in room ${foundRoom}`);
    if (game.readyCount === 2) {
      console.log(`// DEBUG: Both players ready => room=${foundRoom}`);
      io.to(foundRoom).emit("bothPlayersReady");
    }
  });

  // ========== playerDone ==========
  socket.on("playerDone", () => {
    const foundRoom = findRoomForPlayer(socket.id);
    if (!foundRoom) return;
    const game = games[foundRoom];

    game.doneCount++;
    console.log(`// DEBUG: PlayerDone from ${socket.id}, doneCount = ${game.doneCount} in room ${foundRoom}`);
    if (game.doneCount === 2) {
      console.log(`// DEBUG: bothPlayersDone => re-emitting turn to ${game.turn}`);
      io.to(foundRoom).emit("bothPlayersDone");
      io.to(game.turn).emit("turn", game.turn);
    }
  });

  // ========== fire (the attacker fires at x,y) ==========
  socket.on("fire", ({ room, x, y }) => {
    console.log(`// DEBUG: 'fire' => from ${socket.id} => (x=${x}, y=${y}), room=${room}`);
    const game = games[room];
    if (!game) {
      socket.emit("error", "Game not found!");
      console.log("// DEBUG: No game for room =", room);
      return;
    }

    // Must match the current attacker
    if (game.turn !== socket.id) {
      socket.emit("error", "Not your turn!");
      console.log(`// DEBUG: 'fire' => but it's not your turn => turn=${game.turn}`);
      return;
    }

    // Only 1 shot per turn
    if (game.shotsTaken >= 1) {
      socket.emit("error", "You already fired this turn!");
      console.log(`// DEBUG: Rejected second shot from ${socket.id}`);
      return;
    }

    game.shotsTaken++;
    console.log(`// DEBUG: Accepting shot => shotsTaken now = ${game.shotsTaken}`);

    // Relay the shot to the other player
    socket.to(room).emit("fired", { x, y });
  });

  // ========== fireResult (the defender says hit or miss) ==========
  socket.on("fireResult", ({ room, x, y, result }) => {
    console.log(`// DEBUG: 'fireResult' => from ${socket.id} => result=${result}, (x=${x}, y=${y}), room=${room}`);
    const game = games[room];
    if (!game) {
      console.log("// DEBUG: 'fireResult' => no game found =>", room);
      return;
    }

    // Relay to the attacker
    socket.to(room).emit("fireResultForShooter", { x, y, result });

    // Now swap turn from vantage of the old attacker
    const oldAttacker = game.turn;
    const nextTurn = game.players.find((id) => id !== oldAttacker);

    console.log(`// DEBUG: Turn was = ${oldAttacker}, switching to ${nextTurn}`);
    game.turn = nextTurn;

    // Reset shots for the new turn
    game.shotsTaken = 0;
    console.log(`// DEBUG: shotsTaken reset to 0 in room=${room}`);
    io.to(game.turn).emit("turn", game.turn);
  });

  // ========== chatMessage ==========
  socket.on("chatMessage", (text) => {
    const foundRoom = findRoomForPlayer(socket.id);
    if (!foundRoom) return;

    // Relay the message to *all* players in the room
    io.to(foundRoom).emit("chatMessage", {
      from: socket.id,
      text
    });
  });

  // ========== disconnect ==========
  socket.on("disconnect", () => {
    console.log(`// DEBUG: Player disconnected => ${socket.id}`);
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
      console.log("// DEBUG: This disconnected socket was waitingPlayer => reset waitingPlayer=null");
    }
    for (const [rId, game] of Object.entries(games)) {
      if (game.players.includes(socket.id)) {
        console.log(`// DEBUG: Deleting game in room=${rId}, because ${socket.id} disconnected`);
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
  console.log(`// DEBUG: Server running on http://localhost:${PORT}`);
});

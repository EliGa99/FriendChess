const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const QRCode = require("qrcode");
const { Chess } = require("chess.js");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

let games = {};

// -----------------------------
// Hilfsfunktionen
// -----------------------------
function xy_to_uci(pos) {
    const x = parseInt(pos[0]);
    const y = parseInt(pos[1]);
    return String.fromCharCode("a".charCodeAt(0) + x) + (y + 1);
}

async function generate_qr_base64(url) {
    return await QRCode.toDataURL(url);
}

function mode_time(mode) {
    if (mode === "blitz") return 5 * 60;
    if (mode === "rapid") return 10 * 60;
    if (mode === "stopwatch") return 0;
    return null;
}

// -----------------------------
// Routes
// -----------------------------
app.get("/", (req, res) => {
    res.render("index", {
        qr_code: null,
        game_id: null,
        game_link: null
    });
});


app.get("/create/:mode", async (req, res) => {
    const mode = req.params.mode;
    const room_id = uuidv4().slice(0, 8);
    const start_time = mode_time(mode);

    games[room_id] = {
        board: new Chess(),
        players: {},
        mode: mode,
        time: start_time
            ? { white: start_time, black: start_time }
            : null,
        last_move_time: Date.now(),
        move_list: []
    };

    const game_link = `${req.protocol}://${req.get("host")}/game/${room_id}`;
    const qr_code = await generate_qr_base64(game_link);

    res.render("index", {
        game_link,
        qr_code,
        game_id: room_id
    });
});

app.get("/game/:room_id", (req, res) => {
    const room_id = req.params.room_id;

    if (!games[room_id]) return res.send("Spiel existiert nicht!");

    const mode = games[room_id].mode;

    const templates = {
        normal: "game",
        blitz: "game_blitz",
        rapid: "game_rapid",
        stopwatch: "game_stopwatch",
        analyse: "game_analyse"
    };

    res.render(templates[mode] || "game", { room_id });
});

app.get("/game", (req, res) => {
    const room_id = req.query.room;

    if (!room_id) return res.redirect("/");
    if (!games[room_id]) return res.render("game_not_found", { room_id });

    const mode = games[room_id].mode;

    const templates = {
        normal: "game",
        blitz: "game_blitz",
        rapid: "game_rapid",
        bullet: "game_bullet",
        stopwatch: "game_stopwatch",
        analyse: "game_analyse"
    };

    res.render(templates[mode] || "game", {
        room_id,
        game_id: room_id
    });
});

app.get("/analyse/:room_id", (req, res) => {
    const room_id = req.params.room_id;

    if (!games[room_id]) return res.send("Spiel existiert nicht!");

    res.render("analyse", {
        moves: JSON.stringify(games[room_id].move_list),
        room_id
    });
});

// -----------------------------
// Socket.IO Events
// -----------------------------
io.on("connection", (socket) => {

    socket.on("join", (data) => {
        const room_id = data.room;
        const game = games[room_id];

        socket.join(room_id);

        if (!game) {
            socket.emit("full", true);
            return;
        }

        if (Object.keys(game.players).length < 2) {
            const color = Object.values(game.players).includes("white")
                ? "black"
                : "white";

            game.players[socket.id] = color;

            socket.emit("player", {
                color,
                mode: game.mode,
                time: game.time
            });

            io.to(room_id).emit("chat", `<i>${color} ist beigetreten</i>`);
        } else {
            socket.emit("full", true);
        }
    });

    socket.on("chat", (data) => {
        const room_id = data.room;
        const game = games[room_id];
        if (!game) return;

        const color = game.players[socket.id];
        io.to(room_id).emit("chat", `<b>${color}:</b> ${data.msg}`);
    });

    socket.on("move", (data) => {
        const room_id = data.room;
        const game = games[room_id];
        if (!game) return;

        const board = game.board;
        const color = game.players[socket.id];

        if ((board.turn() === "w" && color !== "white") ||
            (board.turn() === "b" && color !== "black")) {
            return;
        }

        // Zeit aktualisieren
        if (game.time) {
            const now = Date.now();
            const elapsed = Math.floor((now - game.last_move_time) / 1000);
            game.time[color] -= elapsed;
            game.last_move_time = now;
        }

        const uci_from = xy_to_uci(data.from);
        const uci_to = xy_to_uci(data.to);

        let promo = "";
        const piece = board.get(uci_from);

        if (piece && piece.type === "p") {
            if ((piece.color === "w" && uci_to[1] === "8") ||
                (piece.color === "b" && uci_to[1] === "1")) {
                promo = "q";
            }
        }

        const move = board.move({
            from: uci_from,
            to: uci_to,
            promotion: promo || undefined
        });

        if (move) {
            game.move_list.push(move.san);

            const next_turn = board.turn() === "w" ? "white" : "black";

            io.to(room_id).emit("move", {
                from: data.from,
                to: data.to,
                next_turn,
                last_move: { from: data.from, to: data.to },
                time: game.time
            });
        }
    });

    socket.on("disconnect", () => {
        for (const [room_id, game] of Object.entries(games)) {
            if (game.players[socket.id]) {
                io.to(room_id).emit(
                    "chat",
                    `<i>${game.players[socket.id]} hat verlassen</i>`
                );
                delete game.players[socket.id];
            }
        }
    });
});

// -----------------------------
// Server Start
// -----------------------------
server.listen(5000, "0.0.0.0", () => {
    console.log("Server läuft auf Port 5000");
});

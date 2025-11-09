// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const multer = require("multer");
const session = require("express-session");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ==== Middleware ====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "super_secret_key",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }, // 1 day
  })
);

// ==== Avatar Uploads ====
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "public", "avatars");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, req.session.userId + ext);
  },
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 } }); // 2MB limit

app.post("/upload-avatar", upload.single("avatar"), (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded");
  req.session.avatar = "/avatars/" + req.file.filename;
  res.send({ avatarUrl: req.session.avatar });
});

// ==== In-memory data ====
let users = {}; // { userId: { username, avatar, socketId } }
let friendCodes = {}; // { friendCode: userId }
let groups = {}; // { groupId: [userIds] }
let roomCounts = {}; // for tracking connected sockets

// ==== Auth routes (temporary simplified) ====
app.post("/login", (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).send("Username required");
  const userId = username + "_" + Math.floor(Math.random() * 10000);
  const friendCode = Math.random().toString(36).substring(2, 8).toUpperCase();

  req.session.userId = userId;
  req.session.username = username;
  friendCodes[friendCode] = userId;

  users[userId] = { username, avatar: req.session.avatar || null, socketId: null };
  res.send({ userId, friendCode });
});

app.get("/session", (req, res) => {
  if (!req.session.userId) return res.status(401).send("No active session");
  res.send({
    userId: req.session.userId,
    username: req.session.username,
    avatar: req.session.avatar || null,
  });
});

// ==== Socket.IO Chat + Calls ====
io.on("connection", (socket) => {
  console.log("socket connected", socket.id);

  // Associate socket with user
  socket.on("registerUser", (data) => {
    if (data.userId && users[data.userId]) {
      users[data.userId].socketId = socket.id;
    }
  });

  // Direct messages
  socket.on("privateMessage", ({ to, from, text }) => {
    if (users[to] && users[to].socketId) {
      io.to(users[to].socketId).emit("privateMessage", { from, text });
    }
  });

  // Group chat messages
  socket.on("groupMessage", ({ groupId, from, text }) => {
    if (groups[groupId]) {
      groups[groupId].forEach((uid) => {
        if (users[uid] && users[uid].socketId && uid !== from) {
          io.to(users[uid].socketId).emit("groupMessage", { from, text, groupId });
        }
      });
    }
  });

  // Call signaling (WebRTC)
  socket.on("callUser", ({ to, offer }) => {
    if (users[to] && users[to].socketId) {
      io.to(users[to].socketId).emit("incomingCall", { from: socket.id, offer });
    }
  });

  socket.on("answerCall", ({ to, answer }) => {
    io.to(to).emit("callAccepted", { answer });
  });

  socket.on("iceCandidate", ({ to, candidate }) => {
    io.to(to).emit("iceCandidate", { candidate });
  });

  // Disconnect cleanup
  socket.on("disconnect", () => {
    Object.keys(users).forEach((uid) => {
      if (users[uid].socketId === socket.id) users[uid].socketId = null;
    });

    Object.keys(roomCounts).forEach((k) => {
      if (Array.isArray(roomCounts[k]) && roomCounts[k].includes(socket.id)) {
        roomCounts[k] = roomCounts[k].filter((id) => id !== socket.id);
        if (roomCounts[k].length === 0) delete roomCounts[k];
      }
    });
  });
});

// ==== Start server ====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on", PORT));

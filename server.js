const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ---- Configuración del juego ----
const MAP_SIZE = 4000;
const FOOD_COUNT = 400;
const START_MASS = 20;
const TICK_RATE = 30; // ticks por segundo
const BASE_SPEED = 6;

const players = {}; // id -> { id, name, x, y, mass, color, target:{x,y} }
let food = [];

const rand = (min, max) => Math.random() * (max - min) + min;
const randomColor = () => `hsl(${Math.floor(rand(0, 360))}, 80%, 55%)`;
const radius = (mass) => Math.sqrt(mass) * 4;

function spawnFood() {
  return { id: Math.random().toString(36).slice(2), x: rand(0, MAP_SIZE), y: rand(0, MAP_SIZE), color: randomColor() };
}
for (let i = 0; i < FOOD_COUNT; i++) food.push(spawnFood());

io.on('connection', (socket) => {
  console.log('Conectado:', socket.id);

  socket.on('join', (name) => {
    players[socket.id] = {
      id: socket.id,
      name: String(name || 'Anónimo').slice(0, 15),
      x: rand(0, MAP_SIZE),
      y: rand(0, MAP_SIZE),
      mass: START_MASS,
      color: randomColor(),
      target: { x: 0, y: 0 },
    };
    socket.emit('joined', { id: socket.id, mapSize: MAP_SIZE });
  });

  // El cliente manda la dirección del mouse (relativa al centro de la pantalla)
  socket.on('move', (target) => {
    const p = players[socket.id];
    if (p && typeof target.x === 'number' && typeof target.y === 'number') p.target = target;
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
  });
});

// ---- Bucle principal del juego ----
setInterval(() => {
  const list = Object.values(players);

  for (const p of list) {
    // Movimiento: más masa = más lento
    const speed = BASE_SPEED * Math.pow(p.mass, -0.1) * 2;
    const dist = Math.hypot(p.target.x, p.target.y);
    if (dist > 5) {
      const factor = Math.min(dist / 100, 1);
      p.x += (p.target.x / dist) * speed * factor;
      p.y += (p.target.y / dist) * speed * factor;
    }
    p.x = Math.max(0, Math.min(MAP_SIZE, p.x));
    p.y = Math.max(0, Math.min(MAP_SIZE, p.y));

    // Comer comida
    for (let i = food.length - 1; i >= 0; i--) {
      const f = food[i];
      if (Math.hypot(p.x - f.x, p.y - f.y) < radius(p.mass)) {
        p.mass += 1;
        food[i] = spawnFood();
      }
    }
  }

  // Comer jugadores (hay que ser 25% más grande)
  for (const a of list) {
    for (const b of list) {
      if (a.id === b.id || !players[a.id] || !players[b.id]) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (a.mass > b.mass * 1.25 && d < radius(a.mass) - radius(b.mass) * 0.5) {
        a.mass += b.mass;
        io.to(b.id).emit('dead');
        delete players[b.id];
      }
    }
  }

  io.emit('state', {
    players: Object.values(players).map(({ id, name, x, y, mass, color }) => ({ id, name, x, y, mass, color })),
    food,
  });
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Servidor corriendo en el puerto ${PORT}`));

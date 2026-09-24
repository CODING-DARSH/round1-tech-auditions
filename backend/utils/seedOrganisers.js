// One-time helper: regenerate data/organisers.json with freshly hashed
// passwords. Run with `npm run seed` from backend/ if you want to change
// the default demo credentials.
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const OUT_PATH = path.join(__dirname, "..", "..", "data", "organisers.json");

const DEMO_USERS = [
  { username: "organiser", password: "Organiser@123", role: "organiser" },
  { username: "volunteer", password: "Volunteer@123", role: "volunteer" },
];

const seeded = DEMO_USERS.map((u) => ({
  username: u.username,
  passwordHash: bcrypt.hashSync(u.password, 10),
  role: u.role,
}));

fs.writeFileSync(OUT_PATH, JSON.stringify(seeded, null, 2), "utf-8");
console.log(`Seeded ${seeded.length} organiser accounts -> ${OUT_PATH}`);
DEMO_USERS.forEach((u) => console.log(`  ${u.username} / ${u.password} (${u.role})`));

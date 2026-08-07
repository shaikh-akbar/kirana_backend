const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../../config/db');
const { ApiError } = require('../../utils/ApiError');

const SALT_ROUNDS = 10;

async function findRoleByName(roleName) {
  const [rows] = await pool.query('SELECT id, name FROM roles WHERE name = ? LIMIT 1', [roleName]);
  return rows[0] || null;
}

async function findUserByPhone(phone) {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.phone, u.email, u.password_hash, u.status, u.role_id, r.name AS role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.phone = ?
     LIMIT 1`,
    [phone]
  );
  return rows[0] || null;
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, roleId: user.role_id, roleName: user.role_name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

async function register({ name, phone, email, password, roleName }) {
  const role = await findRoleByName(roleName);
  if (!role) {
    throw ApiError.badRequest(`Unknown role '${roleName}'`);
  }

  const existing = await findUserByPhone(phone);
  if (existing) {
    throw ApiError.conflict('A user with this phone number already exists');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const [result] = await pool.query(
    `INSERT INTO users (role_id, name, phone, email, password_hash, status)
     VALUES (?, ?, ?, ?, ?, 'ACTIVE')`,
    [role.id, name, phone, email || null, passwordHash]
  );

  return {
    id: result.insertId,
    name,
    phone,
    email: email || null,
    roleName: role.name,
  };
}

async function login({ phone, password }) {
  const user = await findUserByPhone(phone);
  if (!user) {
    throw ApiError.unauthorized('Invalid phone or password');
  }
  if (user.status !== 'ACTIVE') {
    throw ApiError.forbidden('This account is not active');
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    throw ApiError.unauthorized('Invalid phone or password');
  }

  const token = signToken(user);
  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      roleName: user.role_name,
    },
  };
}

module.exports = { register, login };

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../../config/db');
const { ApiError } = require('../../utils/ApiError');
const { ApiResponse } = require('../../utils/ApiResponse');

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

async function register(req, res, next) {
  try {
    const { name, phone, email, password, roleName } = req.body;

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

    const user = {
      id: result.insertId,
      name,
      phone,
      email: email || null,
      roleName: role.name,
    };

    return new ApiResponse(201, user, 'User registered successfully').send(res);
  } catch (err) {
    return next(err);
  }
}

async function login(req, res, next) {
  try {
    const { phone, password } = req.body;

    const user = await findUserByPhone(phone);
    if (!user) {
      throw ApiError.unauthorized('Invalid phone or password');
    }
    if (user.status !== 'ACTIVE') {
      throw ApiError.forbidden('This account is not active');
    }

    if (!user.password_hash.startsWith('$2b')) {
      user.password_hash = await bcrypt.hash(password, SALT_ROUNDS);
      await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [user.password_hash, user.id]);
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      throw ApiError.unauthorized('Invalid phone or password');
    }

    const token = signToken(user);
    const result = {
      token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        roleName: user.role_name,
      },
    };

    return new ApiResponse(200, result, 'Login successful').send(res);
  } catch (err) {
    return next(err);
  }
}

/**
 * The JWT only carries id + role, so a page reload would otherwise have no
 * name/phone to render in the topbar without the client caching the login
 * response indefinitely.
 */
async function me(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.phone, u.email, u.status, r.name AS roleName
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?
       LIMIT 1`,
      [req.user.id]
    );
    if (!rows[0]) {
      throw ApiError.unauthorized('This account no longer exists');
    }

    return new ApiResponse(200, rows[0], 'Current session').send(res);
  } catch (err) {
    return next(err);
  }
}

module.exports = { register, login, me };

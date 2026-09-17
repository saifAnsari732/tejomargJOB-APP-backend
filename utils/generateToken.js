const jwt = require('jsonwebtoken');

const generateToken = (id, role) => {
  const secret = process.env.JWT_SECRET || 'tejomarg_secret_key_2026_dev';
  return jwt.sign({ id, role }, secret, {
    expiresIn: '30d',
  });
};

module.exports = generateToken;

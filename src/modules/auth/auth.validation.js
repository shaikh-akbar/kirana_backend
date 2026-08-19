const { body } = require('express-validator');

const registerValidation = [
  body('name').isString().trim().notEmpty().withMessage('name is required'),
  body('phone').isMobilePhone('any').withMessage('valid phone is required'),
  body('email').optional({ values: 'falsy' }).isEmail().withMessage('email must be valid'),
  body('password').isLength({ min: 6 }).withMessage('password must be at least 6 characters'),
  body('roleName').isIn(['ADMIN', 'WHOLESALER', 'RETAILER']).withMessage('invalid roleName'),
];

const loginValidation = [
  body('phone').isString().trim().notEmpty().withMessage('phone is required'),
  body('password').isString().notEmpty().withMessage('password is required'),
];

module.exports = { registerValidation, loginValidation };

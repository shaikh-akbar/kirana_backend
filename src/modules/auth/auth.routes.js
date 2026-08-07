const { Router } = require('express');
const controller = require('./auth.controller');
const { registerValidation, loginValidation } = require('./auth.validation');
const { validate } = require('../../middlewares/validate.middleware');
const { authenticate } = require('../../middlewares/auth.middleware');

const router = Router();

router.post('/register', registerValidation, validate, controller.register);
router.post('/login', loginValidation, validate, controller.login);
router.get('/me', authenticate, controller.me);

module.exports = router;

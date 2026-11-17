const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { prisma } = require('../db')

async function login(req, res, next) {
  try {
    const { loginLabel, password } = req.body
    const user = await prisma.user.findUnique({ where: { loginLabel }, include: { role: true } })
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid sign-in details' } })
    }
    const token = jwt.sign({ sub: user.id, role: user.role.name }, process.env.JWT_SECRET, { expiresIn: '1h' })
    return res.json({ token, user: { id: user.id, loginLabel: user.loginLabel, role: user.role.name } })
  } catch (error) { next(error) }
}

module.exports = { login }

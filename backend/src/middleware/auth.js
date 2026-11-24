const jwt = require('jsonwebtoken')

function requireAuth(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign-in is required' } })
  try {
    req.actor = jwt.verify(token, process.env.JWT_SECRET)
    return next()
  } catch {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired token' } })
  }
}

function allowRoles(...roles) {
  return (req, res, next) => roles.includes(req.actor.role)
    ? next()
    : res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Role is not permitted' } })
}

module.exports = { allowRoles, requireAuth }

require('dotenv').config();
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.findFirst({ where: { role: 'DRIVER' } }).then(u => {
  if (!u) { console.log('NO DRIVER FOUND'); process.exit(1); }
  const token = jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
  console.log(token);
  p.$disconnect();
}).catch(e => { console.error(e); process.exit(1); });

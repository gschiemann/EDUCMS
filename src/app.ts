import express from 'express';
import helmet from 'helmet';
import cors from 'cors';

import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import cmsRouter from './routes/cms';
import deviceRouter from './routes/device';

import { createServer } from 'http';
import { initializeWebSockets } from './websockets';

export const app = express();
const server = createServer(app);
const io = initializeWebSockets(server);

// Security Baselines
app.use(helmet()); 
app.use(cors());
app.use(express.json());

// API Layer mapped directly to OPENAPI_SPEC.yaml
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/cms', cmsRouter);
app.use('/api/v1/device', deviceRouter);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', component: 'Core Backend Platform' });
});

async function boot() {
  try {
    const PORT = process.env.PORT || 3000;
    
    // 1. Warm up Redis connection
    await initRedis();
    
    // 2. Validate Postgres connection synchronously on boot
    await db.query('SELECT NOW()');
    console.log('Successfully connected to Postgres database.');

    // We start `server.listen` instead of `app.listen` to handle HTTP + WS
    server.listen(PORT, () => {
      console.log(`EduCMS Core API & WSS booted successfully on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Fatal failure matching backend connections:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  boot();
}

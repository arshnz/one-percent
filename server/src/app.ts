import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { errorHandler, notFound } from './middleware/errorHandler.js'
import authRoutes from './routes/auth.js'
import workstationRoutes from './routes/workstations.js'
import habitRoutes from './routes/habits.js'
import logRoutes from './routes/logs.js'
import momentumRoutes from './routes/momentum.js'
import canvasRoutes from './routes/canvas.js'
import goalRoutes from './routes/goals.js'
import checkinRoutes from './routes/checkins.js'
import compassRoutes from './routes/compass.js'
import automaticityRoutes from './routes/automaticity.js'
import coachRoutes from './routes/coach.js'
import aiRoutes from './routes/ai.js'
import notificationRoutes from './routes/notifications.js'

const app = express()

app.set('trust proxy', 1)

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? false
    : ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
}))

// Raised from the 100kb default so drag-dropped images (stored as compressed
// data: URLs on canvas nodes) fit in the request body.
app.use(express.json({ limit: '10mb' }))
app.use(cookieParser())

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.use('/api/auth', authRoutes)
app.use('/api/workstations', workstationRoutes)
app.use('/api/workstations/:wsId/habits', habitRoutes)
app.use('/api/workstations/:wsId/habits/:habitId/logs', logRoutes)
app.use('/api/workstations/:wsId/habits/:habitId/automaticity', automaticityRoutes)
app.use('/api/workstations/:wsId/momentum', momentumRoutes)
app.use('/api/workstations/:wsId/canvas', canvasRoutes)
app.use('/api/workstations/:wsId/goals', goalRoutes)
app.use('/api/workstations/:wsId/checkins', checkinRoutes)
app.use('/api/workstations/:wsId/compass', compassRoutes)
app.use('/api/workstations/:wsId/coach', coachRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/notifications', notificationRoutes)

app.use(notFound)
app.use(errorHandler)

export default app

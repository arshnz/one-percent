import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' }) // local dev secrets (not deployed)
dotenv.config()                        // non-secret config (.env)
import app from './app.js'

const PORT = parseInt(process.env.PORT || '3001', 10)

app.listen(PORT, () => {
  console.log(`One Percent server running on http://localhost:${PORT}`)
})

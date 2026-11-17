import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const api = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api'

function App() {
  return <main>
    <h1>Construction Workforce System</h1>
    <p>Shared foundation is ready for planning, allocation, site updates and reporting.</p>
    <a href={`${api}/health`} target="_blank" rel="noreferrer">Check API health</a>
  </main>
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)

import { useEffect, useState } from 'react'
import './App.css'

type HealthResponse = {
  status: string
}

function App() {
  const [backendStatus, setBackendStatus] = useState('Checking...')

  useEffect(() => {
    async function checkBackend() {
      try {
        const response = await fetch('http://127.0.0.1:8000/health')

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`)
        }

        const data: HealthResponse = await response.json()
        setBackendStatus(data.status)
      } catch {
        setBackendStatus('unavailable')
      }
    }

    void checkBackend()
  }, [])

  return (
    <main>
      <h1>AI Image Classifier Game</h1>
      <p>Frontend: running</p>
      <p>Backend status: {backendStatus}</p>
    </main>
  )
}

export default App
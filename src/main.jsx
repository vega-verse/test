import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import HorseForecastSplash from './HorseForecastSplash.jsx'
import './App.css'

// The app mounts right away underneath the splash, so any ?lat/lon forecast
// fetch runs during the animation instead of after it.
function Root() {
  const [splash, setSplash] = useState(true)
  return (
    <>
      <App />
      {splash && <HorseForecastSplash appName="Horse Forecast" onFinish={() => setSplash(false)} />}
    </>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

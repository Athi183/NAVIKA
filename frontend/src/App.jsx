import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import Header from './components/layout/Header'
import Home from './pages/Home'
import Assistant from './pages/Assistant'
import NavigationPage from './pages/Navigation'
import MobileRoute from './pages/MobileRoute'

function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const [activeTab, setActiveTab] = useState('Home')

  useEffect(() => {
    if (location.pathname === '/') setActiveTab('Home')
    if (location.pathname === '/assistant') setActiveTab('Ask NAVIKA')
    if (location.pathname === '/navigation') setActiveTab('Navigation')
    if (location.pathname === '/about') setActiveTab('About')
  }, [location.pathname])

  const handleSelect = (label) => {
    if (label === 'Home') navigate('/')
    if (label === 'Ask NAVIKA') navigate('/assistant')
    if (label === 'Navigation') navigate('/navigation')
    if (label === 'About') navigate('/about')
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header activeTab={activeTab} onSelect={handleSelect} />
      <main className="mx-auto max-w-7xl px-4 py-8 md:px-8">
        <Routes>
          <Route path="/" element={<Home onNavigate={handleSelect} />} />
          <Route path="/assistant" element={<Assistant />} />
          <Route path="/navigation" element={<NavigationPage />} />
          <Route path="/mobile-route" element={<MobileRoute />} />
          <Route
            path="/about"
            element={
              <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-8 text-slate-200">
                <h2 className="text-3xl font-bold text-white">About NAVIKA</h2>
                <p className="mt-4 max-w-2xl text-slate-300">
                  NAVIKA is a smart campus assistance and indoor navigation prototype built for a demo-ready college project. The current version uses a Phase-I demo map while keeping the data architecture ready for future campus-wide spatial datasets.
                </p>
              </div>
            }
          />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}

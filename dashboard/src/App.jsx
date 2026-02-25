import { Routes, Route, NavLink } from 'react-router-dom';
import Home from './pages/Home';
import AthleteDetail from './pages/AthleteDetail';

export default function App() {
  return (
    <div className="app">
      <header className="header">
        <h1>Blue & Lintell</h1>
        <nav>
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            Dashboards
          </NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/athlete/:athleteId" element={<AthleteDetail />} />
        </Routes>
      </main>
    </div>
  );
}

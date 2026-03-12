import { Routes, Route } from 'react-router-dom';
import Layout from './Layout';
import Home from './pages/Home';
import AthleteDetail from './pages/AthleteDetail';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/athlete/:athleteId" element={<AthleteDetail />} />
      </Routes>
    </Layout>
  );
}
